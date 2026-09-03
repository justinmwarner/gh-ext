# GitHub Review API Reference

**Verified:** 2026-09-01, against the live `api.github.com/graphql` schema and real
PR data. Every query, enum, and input shape below was executed or introspected —
none of it is recalled or inferred.

Validation targets: `pierrecomputer/pierre#1` (query shape),
`microsoft/vscode#333811` (real threads, 40 check contexts, an outdated thread).

---

## 1. Behaviours that will break naive code

These were found by inspecting real payloads, not by reading docs. Each one is a
bug waiting to happen.

### `line` is `null` on outdated threads

```json
{ "isOutdated": true, "line": null, "startLine": null,
  "originalLine": 194, "originalStartLine": null }
```

Any code that types a thread's `line` as `number` and anchors on it will crash or
mis-anchor the moment someone force-pushes. `line` must be typed `number | null`.

`originalLine` **is** populated on outdated threads, so the UI can still say
"was on line 194". Use it for the collapsed Outdated section.

### `startDiffSide` is `null` for single-line threads

```json
{ "line": 248, "startLine": 248, "diffSide": "RIGHT", "startDiffSide": null }
```

Note that `startLine` equals `line` — it is **not** null. So you cannot detect a
single-line thread by testing `startLine === null`. The reliable tests are
`startLine === line` or `startDiffSide === null`.

Multi-line threads populate both: `startLine: 563, line: 568, startDiffSide: "RIGHT"`.

### `viewerViewedState` has three values, not two

`VIEWED`, `UNVIEWED`, and `DISMISSED`. GitHub moves a file to `DISMISSED` when it
changes *after* you marked it viewed. Treating this as a boolean loses the "this
changed since you looked at it" signal, which is the most useful state of the
three during re-review.

### `subjectType` can be `FILE`

Threads are `LINE` or `FILE`. File-level threads have no meaningful line anchor
and must render in a per-file header region, not in the diff body.

---

## 2. Enums

Introspected from the live schema.

| Enum | Values |
|---|---|
| `PullRequestReviewThreadSubjectType` | `LINE` `FILE` |
| `FileViewedState` | `DISMISSED` `VIEWED` `UNVIEWED` |
| `PatchStatus` (file `changeType`) | `ADDED` `DELETED` `RENAMED` `COPIED` `MODIFIED` `CHANGED` |
| `DiffSide` | `LEFT` `RIGHT` |
| `PullRequestReviewState` | `PENDING` `COMMENTED` `APPROVED` `CHANGES_REQUESTED` `DISMISSED` |
| `PullRequestReviewDecision` | `CHANGES_REQUESTED` `APPROVED` `REVIEW_REQUIRED` |
| `PullRequestReviewEvent` | `COMMENT` `APPROVE` `REQUEST_CHANGES` `DISMISS` |
| `PullRequestReviewThreadResolutionReason` | `ADDRESSED` `WONT_FIX` `INVALID` |
| `CheckConclusionState` | `ACTION_REQUIRED` `TIMED_OUT` `CANCELLED` `FAILURE` `SUCCESS` `NEUTRAL` `SKIPPED` `STARTUP_FAILURE` `STALE` |
| `StatusState` | `EXPECTED` `ERROR` `FAILURE` `PENDING` `SUCCESS` |

`changeType` covers `RENAMED` and `COPIED`, which the file tree's git-status
decoration must handle — a rename is not a modify.

---

## 3. The batched read query

Executed successfully as written. This is the single query the service worker
issues on prefetch.

**This block is copied from `lib/github/queries.ts` and re-executed against live
GitHub on 2026-09-01.** It has since gained `baseRefOid` (needed to fetch the
base-side blob when expanding context), `viewerDidAuthor` (to disable Approve on
your own pull request), all five `RequestedReviewer` union members, and shared
fragments. If you change the query, re-copy it here and re-execute it — a stale
reference is worse than none, because this document claims to supersede recall.

```graphql
query PullRequestReview($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title bodyHTML state isDraft merged
      # baseRefOid as well as headRefOid: expanding unchanged context needs the
      # whole file on *both* sides, and a blob is read at a commit. Added
      # 2026-09-01 for Task 26; it is the base-side counterpart of the field
      # beside it and is a non-null GitObjectID on PullRequest.
      baseRefName headRefName baseRefOid headRefOid
      permalink
      author { login avatarUrl }
      # GitHub rejects an approval of your own pull request. Comparing
      # author.login against the viewer would need the viewer's login, which
      # this query does not otherwise want; the schema answers the question
      # directly. Executed against the live schema on 2026-09-01.
      viewerDidAuthor
      reviewDecision
      viewerLatestReview { id state commit { oid } }
      latestReviews(first: 20) {
        nodes { author { login avatarUrl } state commit { oid } }
      }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ...RequestedReviewerFields } }
      }
      commits(last: 1) {
        nodes { commit {
          oid
          statusCheckRollup {
            state
            contexts(first: 100) {
              totalCount
              nodes {
                __typename
                ... on CheckRun {
                  name conclusion status detailsUrl
                  checkSuite { app { name } }
                }
                ... on StatusContext {
                  context state targetUrl description
                }
              }
            }
          }
        } }
      }
      files(first: 100) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...FileFields }
      }
      reviewThreads(first: 100) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...ReviewThreadFields }
      }
    }
  }
}
fragment FileFields on PullRequestChangedFile {
  path additions deletions changeType viewerViewedState
}
fragment ReviewThreadFields on PullRequestReviewThread {
  id isResolved isOutdated isCollapsed
  path line startLine originalLine originalStartLine
  diffSide startDiffSide subjectType
  viewerCanReply viewerCanResolve viewerCanUnresolve
  resolvedBy { login }
  comments(first: 50) {
    totalCount
    nodes { id author { login avatarUrl } body createdAt url }
  }
}
fragment RequestedReviewerFields on RequestedReviewer {
  __typename
  ... on User { login avatarUrl }
  ... on Bot { login avatarUrl }
  ... on Mannequin { login avatarUrl }
  ... on Team { name slug }
  ... on EnterpriseTeam { name slug }
}
```

Notes on real behaviour:

- `statusCheckRollup` is `null` when the head commit has no CI at all. Not an
  error — render "no checks".
- `contexts` is a union of `CheckRun` (GitHub Actions and apps) and
  `StatusContext` (legacy commit statuses). Both appear on real PRs, so both
  fragments are required. vscode#333811 returned 40 contexts.
- `reviewDecision` is `null` when no review has been requested or given.
- Both `files` and `reviewThreads` paginate at 100. Follow `pageInfo` for large
  PRs.

---

## 4. Mutations

Input shapes introspected from the live schema.

### Create a thread — `addPullRequestReviewThread`

```
clientMutationId: String
path: String
body: String!
pullRequestId: ID          # set this for a standalone comment
pullRequestReviewId: ID    # OR set this to attach to a pending review
line: Int
side: DiffSide
startLine: Int
startSide: DiffSide
subjectType: PullRequestReviewThreadSubjectType
```

`pullRequestId` and `pullRequestReviewId` are both optional and mutually
exclusive in practice.

> **Corrected 2026-09-02.** The comment above used to read "set `pullRequestId`
> for a standalone comment". That describes the *input shape* and is wrong about
> the *runtime effect*, and the mistake shipped: the composer told reviewers
> "this will post immediately as a single comment" while doing the opposite.
>
> **`addPullRequestReviewThread` has no standalone mode.** Passing
> `pullRequestId` does not publish a comment — it opens a `PENDING` review to
> hold one. The comment is then invisible to everyone but its author until that
> review is submitted, and because the page never learned the review existed, it
> offered no way to submit it. Observed on a real pull request; the reviewer
> found the review had been "started automatically".
>
> To publish one comment on its own — what GitHub's own **Add single comment**
> button does — takes three round trips:
>
> 1. `addPullRequestReview(pullRequestId:)` with no `event` → a `PENDING` review,
>    and its id.
> 2. `addPullRequestReviewThread(pullRequestReviewId:)` → the comment.
> 3. `submitPullRequestReview(pullRequestReviewId:, event: COMMENT)` → published.
>
> Every one of those documents was already validated against the live schema, so
> composing them needs no field this file has not introspected. See
> `publishThread` in `ui/reviewSession.tsx`.

For a multi-line comment set `startLine` + `startSide` alongside `line` + `side`.
For single-line, omit the `start*` fields.

### Reply — `addPullRequestReviewThreadReply`

```
pullRequestReviewThreadId: ID!
body: String!
pullRequestReviewId: ID     # optional; attaches the reply to a pending review
```

`pullRequestReviewId` must be sent whenever a review is pending. Without it the
reply publishes on the spot while the line comments beside it sit queued, so the
reviewer submits their review and finds their replies went out some time
earlier — out of order and out of context. Fixed 2026-09-02; it had been
documented here and not done.

### Resolve — `resolveReviewThread` / `unresolveReviewThread`

```
threadId: ID!
resolutionReason: PullRequestReviewThreadResolutionReason   # optional
```

### One pending review per pull request

GitHub allows a reviewer **one** `PENDING` review per pull request and refuses a
second with:

```
User can only have one pending review per pull request
```

Both ways this extension writes a comment begin by opening a review — the single
comment path above opens one, and "Start a review" opens one — so a reviewer
already holding an open review could previously do neither. The review may have
been started in another tab, in GitHub's own UI, or left behind by an earlier
build of this extension.

`viewerLatestReview` is documented as "the latest review **given** from the
viewer", and a review still being written has not been given to anyone. It is
not established that it reports a `PENDING` one, and this extension behaved as
though it does — which is why `initialPendingReview` said Browse while GitHub
held an open review. Not verified either way: it could not be executed against
the live schema at the time. `VIEWER_PENDING_REVIEW` therefore asks **both** ways
and takes whichever answers:

```graphql
viewerLatestReview { id state }
reviews(last: 20, states: [PENDING]) { nodes { id state } }
```

A pending review is visible only to its author, so the `reviews` connection can
only ever return the viewer's own.

That lives in its own document, issued alongside `PULL_REQUEST_QUERY` and
settled rather than unwrapped. The `states` argument has **not** been
introspected: on the main read a mistake would fail validation and take the
whole page down, whereas here it costs the lookup and nothing else. Fold it into
`PULL_REQUEST_QUERY` and save the round trip once it has been executed against
the live schema.

Recovery does not match on GitHub's wording. When opening a review is refused,
the page asks whether one is open and joins it if so — a review being open is
the answer whatever the refusal said, so a reworded message cannot strand the
reviewer again.

### Open a pending review — `addPullRequestReview`

```
pullRequestId: ID!
commitOID: GitObjectID
body: String
event: PullRequestReviewEvent      # OMIT to create a PENDING review
comments: DraftPullRequestReviewComment
threads: DraftPullRequestReviewThread
```

Omitting `event` is what creates the `PENDING` review. Passing `event` submits
immediately.

### What the author may submit on their own pull request

Only `COMMENT`. GitHub refuses the other two, each with its own sentence:

```
Can not approve your own pull request
Can not request changes on your own pull request
```

Both arrive as GraphQL errors at `submitPullRequestReview`, after the review has
been written — so a rejected submit is not harmless. The review stays `PENDING`
with every queued comment still invisible to everyone else.

`ReviewFooter` disables both controls when `viewerDidAuthor` is true, and says
that a comment is still available. Self-review is *not* blocked outright:
leaving notes on your own pull request is ordinary, and `COMMENT` works.

Recorded 2026-09-02. `REQUEST_CHANGES` had been left enabled on the belief that
only approval was blocked — untested, and wrong.

### Submit — `submitPullRequestReview`

```
pullRequestReviewId: ID
pullRequestId: ID
event: PullRequestReviewEvent!     # COMMENT | APPROVE | REQUEST_CHANGES | DISMISS
body: String
```

### Discard a pending review — `deletePullRequestReview`

```
pullRequestReviewId: ID!
```

Added 2026-09-01, after the state machine's `discarded` transition turned out to
have no producer. Clearing only local state would leave the `PENDING` review and
every comment queued on it sitting on GitHub, so the next visit would silently
resume a review the reviewer believes they abandoned.

This is the one destructive mutation in the extension. It deletes queued review
comments that exist nowhere else. The UI requires an explicit second
confirmation before calling it.

Validated against the live schema with a fabricated review id: returns
`NOT_FOUND` only, so the document is schema-valid.

### Viewed state — `markFileAsViewed` / `unmarkFileAsViewed`

```
pullRequestId: ID!
path: String!
```

---

## 5. Fetching the diff

GraphQL does not return patch text. Use REST:

```
GET /repos/{owner}/{repo}/pulls/{number}
Accept: application/vnd.github.diff
```

One request, whole unified diff, no pagination. GitHub refuses to generate it for
exceptionally large diffs.

**"On failure" is the wrong rule, and this document used to say it.** Taken
literally — as `lib/github/assembly.ts` did — every failure triggers the fallback,
so a 403 from a token missing Contents, a 404 for a repository the token cannot
see, or a 429 from a throttle each buy up to thirty more requests against an
endpoint that is already refusing, and the reviewer is shown the *fallback's*
error with the original status discarded. Fall back on the statuses that mean
"this diff exists but I will not render it" — 406, and 500 for a diff large enough
to time out server-side — and rethrow everything else. State it as the statuses
worth retrying rather than the ones to skip: the inverted form silently lets
through every status nobody thought of.

Falling back means:

```
GET /repos/{owner}/{repo}/pulls/{number}/files?per_page=100
```

which caps at 3000 files total and omits `patch` on very large individual files.

---

## 6. Rate limits

REST: 5000 requests/hour. GraphQL: 5000 points/hour. The remaining quota is
surfaced on the options page so an accidental polling loop is visible rather than
mysterious.

The batched query does **not** cost a single point, as this document used to
claim. By GitHub's own formula `reviewThreads(first: 100)` with a nested
`comments(first: 50)` counts as 1 + 100, and `files`, `latestReviews`,
`reviewRequests` and `commits` → `contexts` add more — roughly 106 requests, which
rounds to 2 points. Still not a practical constraint for one person; the point is
that the figure was asserted rather than derived.

### The three shapes of "you are being throttled"

The important omission. A client that recognises only one of these reports the
other two as an unclassifiable error, and the reviewer is told "Something went
wrong" about a problem that fixes itself by waiting.

| Shape | How it arrives | What identifies it |
| --- | --- | --- |
| Primary REST limit | HTTP 403 | `x-ratelimit-remaining: 0`, plus `x-ratelimit-reset` as an absolute epoch second |
| Primary GraphQL limit | **HTTP 200** | `errors[].type === "RATE_LIMITED"`, `data: null` |
| Secondary limit | HTTP 403 **or** 429 | `Retry-After`, in seconds, and `x-ratelimit-remaining` left non-zero |

Three consequences for any code reading these:

- **The GraphQL limit is an HTTP 200.** Nothing about the status says what
  happened, and a client that classifies only on status cannot see it at all.
  This is the same lesson as §8, one section later, and the two belong together.
- **Keep `errors[].type`.** It is the only field that separates `RATE_LIMITED`
  from `FORBIDDEN`, and the remedies are opposites: wait, versus get a different
  token. A grouping function that keeps only `message` and `path` throws that
  away — `lib/github/graphql-errors.ts` did.
- **Read `Retry-After` as well as `x-ratelimit-reset`.** A secondary limit sends
  no `x-ratelimit-*` headers at all, so without it there is no countdown to show.

---

## 7. Validating mutation documents without mutating anything

GraphQL validates a document — fields, argument names, argument types, and
payload selections — **before** it resolves any node. So sending a mutation with
a syntactically valid but unresolvable node ID proves the document is correct
while guaranteeing no write occurs.

A valid document returns errors that are all `"type": "NOT_FOUND"`. An invalid
one returns validation errors naming the offending field or argument, and never
reaches execution.

```bash
# body.json = {"query": "<the mutation>", "variables": {...with a fake id...}}
gh api graphql --input body.json
```

Use a well-formed but dead id, for example `MDEyOklzc3VlQ29tbWVudDAwMA==`.

All eight mutation documents in `lib/github/mutations.ts` were verified this way
on 2026-09-01: `ADD_THREAD`, `ADD_REPLY`, `RESOLVE_THREAD`, `UNRESOLVE_THREAD`,
`START_REVIEW`, `SUBMIT_REVIEW`, `MARK_VIEWED`, `UNMARK_VIEWED`. Every one
returned `NOT_FOUND` only.

The payload field names were separately introspected and are confirmed:

| Mutation | Payload field |
|---|---|
| `addPullRequestReviewThread` | `thread` |
| `addPullRequestReviewThreadReply` | `comment` |
| `resolveReviewThread` / `unresolveReviewThread` | `thread` |
| `addPullRequestReview` | `pullRequestReview` (also `reviewEdge`) |
| `submitPullRequestReview` | `pullRequestReview` |
| `markFileAsViewed` / `unmarkFileAsViewed` | `pullRequest` |

Re-run this probe after editing any mutation. It is the only check that catches
a wrong payload field before it reaches a user, because GitHub reports such a
mistake as HTTP 200 with an `errors` array rather than as a failure.

## 8. A GraphQL response is not pass or fail

Observed against a live fine-grained token on 2026-09-02, on
`justinmwarner/the-sous-chef-recipe-viewer#201`.

A token that grants the repository but not one permission inside it does **not**
produce an HTTP error, and does not produce an empty response. GitHub answers:

- **HTTP 200**
- `data` fully populated — the pull request, its files, its threads, all correct
- the denied field nulled out
- an `errors` array alongside it

The errors are raised **per denied object**, not per field and not per query. A
pull request whose head commit has seven check runs, read with a token lacking
the **Checks** permission, returns *seven* copies of:

```json
{
  "type": "FORBIDDEN",
  "path": ["repository","pullRequest","commits","nodes",0,"commit",
           "statusCheckRollup","contexts","nodes", 3],
  "message": "Resource not accessible by personal access token"
}
```

Two consequences, both learned the hard way:

1. **Treating a non-empty `errors` array as fatal throws away a complete pull
   request.** It cost a whole review page over a missing status-check widget.
   `GitHubClient.graphql` now takes an optional `onPartial`; supplying one opts
   into keeping the data. Reads opt in. **Mutations must not** — a mutation
   answering `{ data: { addPullRequestReviewThread: null }, errors: [...] }` has
   not posted the comment, and returning that as a success loses the reviewer's
   writing while telling them it was saved.

2. **`e.message` alone is not a diagnosis.** Joining seven identical sentences
   says nothing about what was refused. `e.path` is the entire diagnosis and
   must survive into whatever the user reads. `lib/github/graphql-errors.ts`
   groups by message *and* path, generalizing list indices (`nodes.3` →
   `nodes.N`) so the seven collapse into one fact with a count.

### Permissions the batched read query actually needs

`statusCheckRollup.contexts` is a union of `CheckRun` and `StatusContext`, and
these are **two separate grants**:

| Union member | Fine-grained permission |
|---|---|
| `CheckRun`, `checkSuite.app` | **Checks**: Read |
| `StatusContext` | **Commit statuses**: Read |

A token with only one of them renders a partial check list; a token with
neither renders none. Neither case is fatal any more, but both are reported.
