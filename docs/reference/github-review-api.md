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

```graphql
query PullRequestReview($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title bodyHTML state isDraft merged
      baseRefName headRefName headRefOid
      permalink
      author { login avatarUrl }
      reviewDecision
      viewerLatestReview { id state commit { oid } }
      latestReviews(first: 20) {
        nodes { author { login avatarUrl } state commit { oid } }
      }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { __typename ... on User { login avatarUrl } } }
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
        nodes { path additions deletions changeType viewerViewedState }
      }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated isCollapsed
          path line startLine originalLine originalStartLine
          diffSide startDiffSide subjectType
          viewerCanReply viewerCanResolve viewerCanUnresolve
          resolvedBy { login }
          comments(first: 50) {
            nodes { id author { login avatarUrl } body createdAt url }
          }
        }
      }
    }
  }
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
exclusive in practice. This is precisely what the two-state review machine needs:
**Browse** passes `pullRequestId`, **Pending review** passes
`pullRequestReviewId`.

For a multi-line comment set `startLine` + `startSide` alongside `line` + `side`.
For single-line, omit the `start*` fields.

### Reply — `addPullRequestReviewThreadReply`

```
pullRequestReviewThreadId: ID!
body: String!
pullRequestReviewId: ID     # optional; attaches the reply to a pending review
```

### Resolve — `resolveReviewThread` / `unresolveReviewThread`

```
threadId: ID!
resolutionReason: PullRequestReviewThreadResolutionReason   # optional
```

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

### Submit — `submitPullRequestReview`

```
pullRequestReviewId: ID
pullRequestId: ID
event: PullRequestReviewEvent!     # COMMENT | APPROVE | REQUEST_CHANGES | DISMISS
body: String
```

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
exceptionally large diffs; on failure fall back to:

```
GET /repos/{owner}/{repo}/pulls/{number}/files?per_page=100
```

which caps at 3000 files total and omits `patch` on very large individual files.

---

## 6. Rate limits

REST: 5000 requests/hour. GraphQL: 5000 points/hour. The batched query above
costs a single point. For one person this is not a practical constraint, but the
remaining quota should be surfaced on the options page so an accidental polling
loop is visible rather than mysterious.
