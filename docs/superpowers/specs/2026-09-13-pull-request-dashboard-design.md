# The Pull Request Dashboard — Investigation and Design

**Date:** 2026-09-13
**Status:** Designed, not implemented
**Register:** product

## Goal

A list of the pull requests the reviewer is involved in, sorted into buckets by
who the pull request is actually waiting on, reachable without going to
github.com first.

Three asks, in the order they were made:

1. A pull request menu — the ones you have touched, authored, or been asked to
   look at.
2. Automatic organisation: what is waiting on me, what I am waiting on others
   for, what is ready to merge, and what has gone quiet and can be left alone.
3. All the open pull requests in a repository you have opened a pull request in
   before.

The second ask was described as "almost like a tagging system". It is not one,
and most of this document is the argument for why the derived version is better
and where the manual part still earns its place.

---

## Part 1: The audit

Everything in this section was executed against live GitHub on **2026-09-13**
through `gh api graphql`, using a classic OAuth token carrying the `repo`
scope. Where that differs from what the extension actually holds — a
fine-grained personal access token scoped to chosen repositories — it is called
out, because the difference is load-bearing and is the one thing this audit
could not settle.

### It is affordable

The concern that matters most here is PRODUCT.md's third principle: speed is
the budget. GraphQL's quota is 5000 points an hour and the extension's existing
per-pull-request read costs about 2 of them.

| Query | Cost | Nodes |
|---|---|---|
| Four bucket searches as aliases in one document | **1** | — |
| 50 pull requests with the full dashboard selection | **2** | 650 |
| 20 pull requests with all their review threads | **1** | 2020 |
| 3 repositories × 25 open pull requests, aliased | **1** | 75 |
| `repositoriesContributedTo` for the whole account | **1** | 19 returned |

A full dashboard refresh costs roughly what opening one pull request costs.
That was not obvious in advance and it is what makes the rest of this document
worth writing.

### Every bucket is derivable

The signals below all resolved in a single search document. None of them needs a
second round trip, and none of them needs the reviewer to maintain anything.

| Field | What it settles |
|---|---|
| `viewerDidAuthor` | Mine or theirs, without needing the viewer's login |
| `reviewDecision` | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null |
| `viewerLatestReview { state commit { oid } }` | Whether I have reviewed, and at which commit |
| `headRefOid` | Compared against the above: **have they pushed since I looked** |
| `reviewRequests(first: 10)` | Who is being waited on, including teams and bots |
| `mergeStateStatus` | `CLEAN`, `BLOCKED`, `DIRTY`, `UNSTABLE`, `BEHIND` |
| `commits(last: 1) { commit { statusCheckRollup { state } } }` | Checks red, green or running |
| `reviewThreads(first: 100) { nodes { isResolved } }` | Unresolved conversation count |
| `timelineItems(last: 1, itemTypes: [...])` | Who moved last, and when |
| `updatedAt` | Staleness |
| `isDraft` | Not asking anything of anybody yet |
| `isReadByViewer` | Whether this is new since you last looked |

Two of these deserve a note.

**`headRefOid` against `viewerLatestReview.commit.oid` is the best signal in the
list.** It answers "they pushed after I reviewed, so it is my turn again" — a
state GitHub's own pull request list does not surface at all, and the single
most common reason a review stalls. It is free: both fields come back in the
same selection.

**`mergeStateStatus` resolves without push access.** GitHub's documentation has
historically said it requires push, which would have meant designing a
degradation path for every open-source review. It does not: probed against
`facebook/react` at `viewerPermission: READ`, it returned `BLOCKED` normally.
Re-verify this with a fine-grained token before relying on it.

### The repository question has a direct answer

`viewer.repositoriesContributedTo(contributionTypes: [PULL_REQUEST],
includeUserRepositories: true)` returns exactly the third ask: every repository
the account has opened a pull request in. It returned 19 for the developing
account, private repositories included, for 1 point.

`RepositoryContributionType` has five members — `COMMIT`, `ISSUE`,
`PULL_REQUEST`, `REPOSITORY`, `PULL_REQUEST_REVIEW`. Only the last two are
interesting later; `PULL_REQUEST` alone is what the ask names.

### Search stops at 1000 results

Confirmed rather than assumed. A cursor past the thousandth result:

```
search(query: "is:pr sort:updated-desc", type: ISSUE, first: 1,
       after: "Y3Vyc29yOjEwMDA=")
→ { issueCount: 549627628, pageInfo: { hasNextPage: false }, nodes: [] }
```

`hasNextPage` is **false**, not an error. A client that paginates on that flag
will conclude it has the whole list and be wrong by half a billion rows. This
is the same failure shape as the `hasNextPage` handling already in
`lib/github/pagination.ts` and it needs the same treatment the truncation flags
in `lib/cache.ts` get: say the list stopped short rather than imply it ended.

For a personal dashboard 1000 is not a constraint — the developing account has
88 open pull requests it is involved in. For "every open pull request in this
repository" it can be, and that path uses `repository.pullRequests` with real
cursors instead, which has no such cap.

### The one thing this audit could not settle

**Does `search` respect a fine-grained token's repository grant?**

The extension's entire security posture is a fine-grained token scoped to the
repositories the reviewer chose. This audit used a classic `repo`-scoped token,
so it proves the query works and proves nothing about the scoping.

If search *is* scoped, then "pull requests I am involved in" silently means
"pull requests I am involved in, in repositories I remembered to add to this
token" — a list that is incomplete without saying so, which is precisely what
PRODUCT.md's fourth principle forbids. That is not a reason to abandon the
feature; it is a reason the design below names unreachable repositories out
loud.

Run this before writing any code:

```bash
GH_TOKEN=<fine-grained PAT> gh api graphql \
  -f query='{ search(query: "is:pr involves:@me", type: ISSUE, first: 5) {
      issueCount nodes { ... on PullRequest { repository { nameWithOwner } } } } }'
```

Compare `issueCount` against the same query run with a classic token. A number
far below it means scoped, and the notice in §4 below becomes mandatory rather
than merely correct.

Record the answer in `docs/reference/github-review-api.md` either way. It is a
behaviour that breaks the obvious implementation, which is what that document is
for.

---

## Part 2: The product argument

This is the largest expansion of scope available to this product, and PRODUCT.md
names it as an anti-reference by title:

> **A second GitHub with everything in it.** Feature parity is not the goal and
> pursuing it would destroy the reason the thing exists.

DESIGN.md adds a second objection in §5: *"There is no site navigation."* A
pull request menu is navigation.

So the feature has to be argued for rather than assumed, which is PRODUCT.md's
own rule. The argument:

**It is the missing half of the stated job.** PRODUCT.md describes the reviewer
arriving "from a Slack message or a notification email". That is how a review
starts *when somebody remembers to tell you*. The pull requests that stall are
the ones nobody sends a second message about — the one where they pushed a fix
three days ago and are waiting, the one approved a week ago that nobody merged.
The extension already holds the token and already knows how to render a fast
list of rows; what it lacks is any answer to "what should I be looking at".

**Every row is an entry to the thing the product is already best at.** This is
not a second GitHub because it does not try to *do* anything. It has no merge
button, no comment box, no label editor, no assignee picker. It lists pull
requests and opens them in the review page. Everything it will not do continues
to hand off through Open in GitHub, exactly as the rest of the product does.

**The derivation is a genuine capability GitHub does not offer.** "They pushed
since you reviewed" is not a filter github.com has. Neither is "approved, green
and mergeable, and nobody has pressed the button." A list that only reproduced
GitHub's own filters would not be worth the scope; one that answers a question
GitHub cannot is.

**What it must not become**, recorded here so a later change has something to
fail against:

- No counts in a badge, on an icon, or anywhere else that asks for attention
  the reviewer did not ask to give. PRODUCT.md: *"Never asks for attention it
  has not earned. No badges."*
- No metric tiles, no summary header, no "12 awaiting your review" hero.
  DESIGN.md forbids these by name.
- No writes. Not merge, not close, not label, not assign, not comment. The
  moment this list can change a pull request it is a second GitHub.
- No polling. It refreshes when opened and when asked. A background timer
  turning over a token every five minutes is a different product with a
  different privacy story.

---

## Part 3: Design

### 1. What a bucket is

Six, derived. **Evaluation order and display order are different**, which is the
one thing to get right here, so both are written out.

Evaluated in this order, first match wins:

| # | Bucket | Derivation |
|---|---|---|
| 1 | **Drafts** | `isDraft` |
| 2 | **Waiting on you** | Theirs, and (`review-requested:@me` with no `viewerLatestReview`) **or** `viewerLatestReview.commit.oid ≠ headRefOid` |
| 3 | **Blocked on you** | Yours, and `reviewDecision: CHANGES_REQUESTED`, or unresolved threads whose last comment is not yours, or `mergeStateStatus: DIRTY`, or checks `FAILURE` |
| 4 | **Ready to merge** | Yours, `reviewDecision: APPROVED`, `mergeStateStatus: CLEAN` |
| 5 | **Waiting on others** | Yours, `reviewDecision: REVIEW_REQUIRED` with `reviewRequests` non-empty, or approved but not yet clean |
| 6 | **Quiet** | Everything else |

Then one reclassification, and only one: a pull request that landed in 4 or 5
whose `updatedAt` is older than the staleness horizon moves to **Quiet**. A pull
request in 2 or 3 never does, at any age.

Displayed in this order: Waiting on you, Blocked on you, Ready to merge, Waiting
on others, Quiet, Drafts.

Three deliberate choices in that.

**"Waiting on you" is shown first and mixes authorship.** A reviewer's attention
is the scarce resource, so the top of the list is everything that cannot move
without them, regardless of who wrote it.

**Drafts is evaluated first and shown last.** A draft is not asking anything of
anybody, so it must not be able to reach the top of the list through some other
rule — but it is still yours and still worth seeing at the bottom.

**Ageing never buries work that is yours to do.** A pull request you have to fix
does not become less yours by going quiet, which is why the reclassification
above excludes buckets 2 and 3. The staleness horizon is a setting, defaulting to
**14 days**, because the right number is a property of a team's cadence and not
of this extension.

Every bucket label is a sentence about whose turn it is, not a status noun.
"Waiting on you" rather than "Needs review" — the first tells the reviewer what
to do about it and the second describes a field.

### 2. Overrides that cannot outlive their facts

The manual part. A reviewer can move a row to any bucket, and that override
**lapses when the pull request moves underneath it**.

The mechanism already exists in this codebase. `lib/cache.ts` keys every mutable
slot on the head SHA, so a push invalidates it without anybody having to
remember to. An override is stored the same way:

```ts
interface Override {
  bucket: BucketId;
  /** The head commit the reviewer made this decision against. */
  headRefOid: string;
  /** The pull request's updatedAt at that moment, epoch ms. */
  seenAt: number;
  /** When they set it, for the sentence on the row. */
  setAt: number;
}
```

An override applies only while `headRefOid` matches and `updatedAt` has not
advanced past `seenAt`. When either changes it is retired, the row returns to
its derived bucket, and **the row says so** — "moved back: they pushed" — rather
than quietly relocating overnight. A reviewer who finds a pull request somewhere
other than where they left it is owed the reason.

`updatedAt` is the blunt half of that pair and it is chosen knowingly. It moves
on any change at all, a bot's comment included, so an override will sometimes
lapse for a reason the reviewer does not consider a reason. The alternative is
to lapse on the *derived bucket* changing instead — compute it fresh, compare,
retire only on disagreement — which is more precise and lets an override survive
noise. It is also the rule that quietly keeps a dismissal alive through three
days of real discussion, because discussion alone does not move a bucket.
Lapsing too eagerly costs a reviewer one press to re-dismiss; lapsing too
reluctantly costs them the thing they asked to be told about. The eager rule is
the safe one and is what this design takes. If it proves noisy in use, the
narrower test is a one-line change in `overrides.ts` and the tests for it should
be written to make that swap cheap.

This is the whole of the manual layer. There are no free-form tags:

- They cannot sync. The product refuses `storage.sync` for the token on
  principle, and a tag vocabulary that exists on one laptop and not the other is
  a worse kind of lie than no tags at all.
- They rot without a lapse rule, and a lapse rule for a free-form label has no
  meaning — there is no fact for "spike" to disagree with.
- The buckets are the vocabulary. A tag that duplicated one is noise; a tag that
  did not is a project management feature, and this is not a project management
  tool.

A dismissal — "not now, and stop showing me until something happens" — is the
same object with the same lapse rule, written as an override onto Quiet. One
mechanism, not two.

Overrides are swept when the pull request closes or merges, alongside the
existing cache sweep in `lib/cache.ts`.

### 3. Which repositories

Two lists, both stored, both visible on the options page.

**Discovered.** `repositoriesContributedTo(contributionTypes: [PULL_REQUEST])`,
refreshed on demand and never silently. The reviewer ticks which of them to
watch; nothing is watched without being ticked. This is the answer to "have I
forgotten one" — the list arrives complete and the reviewer subtracts, rather
than starting empty and having to remember.

**Watched.** The ticked subset. Only these are queried for the repository-wide
view; the involvement searches are account-wide and need no repository list at
all.

The distinction matters because the two features have different costs. "Pull
requests I am involved in" is one search whatever the repository count.
"Every open pull request in these repositories" is one aliased field per
repository, and 19 repositories of scratch work is not a list anybody wants to
read.

### 4. Naming what cannot be seen

If a discovered repository is not in the token's grant, the options page marks
it as such and the dashboard carries a single line naming the count, with a link
to the token page.

This follows the shape `ui/DeniedNotice.tsx` and `lib/github/permissions.ts`
already establish: a refusal is translated into the words on GitHub's own token
page, not into a schema path. A repository outside the grant is a `NOT_FOUND`
indistinguishable from one that does not exist (§9 of the API reference), so the
sentence has to be honest about that ambiguity — the same three-cause problem
`lib/github/diagnosis.ts` was written for.

### 5. Surface

The dashboard is a route on the review page: `#/prs`. Reached three ways.

**A toolbar button.** The manifest gains an `action` key with no
`default_popup`, so `action.onClicked` fires in the service worker and the
worker opens `review.html#/prs` through the existing `openTarget` machinery.
This reverses DESIGN.md's "there is no site navigation" and the reversal should
be written into DESIGN.md rather than left as an undocumented exception. The
line was true of a product with one screen; it stops being true here, and a
design system that quietly contradicts itself is worse than one that records
when it changed its mind.

`action` costs no permission and produces no store-listing warning. It does
change the listing's appearance, which is a release consideration, not a
technical one.

**`g p` from inside a review.** `g h` already exists in the "Moving around"
group of `lib/keymap.ts`, so the chord vocabulary is established and `g p` — go
to pull requests — needs no new concept in the help overlay.

**A link on the options page**, beside the repository picker it belongs to.

A review opened *from* the dashboard gets a way back in the top bar. One opened
from the injected card does not, because there is nothing behind it.

### 6. Rendering

Rows. DESIGN.md §6: *"Don't nest cards, and don't reach for a card grid where a
list of rows would do. This interface is rows."*

Each row: repository and number, title, author, the age of the last movement,
and the one fact that put it in its bucket — "they pushed 2 days ago", "approved,
checks green", "3 unresolved". One fact, the deciding one, because a row that
lists every signal is a row nobody reads.

Bucket headings are text with a count, matching the existing `ViewSwitcher`
treatment. No colour-coded left borders — DESIGN.md forbids a coloured side
stripe above 1px, and this is exactly the place somebody would reach for one.
Status uses the existing chip vocabulary from §5, which already carries a word
and not only a colour.

Empty buckets are omitted, not drawn empty. An entirely empty dashboard gets one
plain sentence; PRODUCT.md forbids illustrated empty states.

---

## Module layout

`lib/` stays pure. Nothing below touches `chrome.*`, the DOM, or the network.

```
lib/dashboard/
  buckets.ts        derivation: a PR summary → a bucket, plus the deciding fact
  buckets.test.ts
  overrides.ts      apply, lapse, sweep. Pure over a plain record
  overrides.test.ts
  repos.ts          discovered vs watched, and the reachability split
  repos.test.ts

lib/github/
  queries.ts        + DASHBOARD_QUERY, REPO_PRS_QUERY, CONTRIBUTED_REPOS_QUERY
  types.ts          + PrSummary

lib/messages.ts     + 'get-dashboard', 'get-repo-prs', 'discover-repos'
lib/settings.ts     + stalenessDays, watchedRepos

ui/
  DashboardView.tsx     buckets and rows
  DashboardRow.tsx
  useDashboard.ts       the worker round trip
  RepoPicker.tsx        options page
```

`buckets.ts` is the piece worth isolating hardest: it is a pure function from a
pull request summary to a bucket and a sentence, it is where every rule in §1
lives, and it is the thing most likely to be argued about later. It should be
testable with a plain object and no browser, like the rest of `lib/`.

---

## Failure modes

Each one says what it could not do, per PRODUCT.md's fourth principle.

| Failure | Behaviour |
|---|---|
| Search returned 1000 and stopped | The list says it was capped. Never reports `hasNextPage: false` as "that is all of them" |
| A repository refused (`NOT_FOUND`) | Named, with the grant ambiguity stated, via `lib/github/permissions.ts` |
| `RATE_LIMITED` — an HTTP 200 | Handled by the existing classifier. The dashboard shows the countdown, not an apology |
| Token locked | `LockedState`, as the review page already does |
| An override lapsed | The row says why, on the row |
| Partial GraphQL response | Rows render, missing fields are named. Reads may keep partial data; §8 of the API reference |

---

## Testing

Follows the existing split.

- **`lib/dashboard/*.test.ts`** — Node, milliseconds. Every bucket rule as a
  table of summaries and expected buckets. Every lapse condition. The 1000-cap
  handling.
- **`ui/DashboardView.test.tsx`** — jsdom. Bucket order, the deciding-fact
  sentence, the lapse notice, empty states, keyboard reachability of every row.
- **`e2e/dashboard.spec.ts`** — Playwright against `wxt build`, with the search
  response mocked at the service worker like the existing suite. This is the
  only honest check for the `action` key, since the toolbar button does not
  exist in the dev manifest.
- **`ui/tokens.test.tsx`** already guards the colour rule and will cover the new
  components without changes, provided no literal hex is written.

Before any of it: **execute `DASHBOARD_QUERY` against the live schema and update
`docs/reference/github-review-api.md`**, per CLAUDE.md. The probes in Part 1 are
a start and are not the final document.

---

## Rejected alternatives

**Free-form manual tags.** Asked for, and argued down in §2. No sync, no lapse
rule, and the buckets already are the vocabulary.

**Sticky overrides.** Simpler to build and to explain. A pull request filed
under Quiet stays there after somebody requests your review on it, which is the
failure PRODUCT.md's fourth principle exists to prevent.

**A popup on the toolbar button.** Fastest glance, no tab. A popup closes the
moment focus leaves it, which is wrong for a list you work down, and it cannot
share the review page's components.

**A panel on the injected card.** Zero new surfaces, and forbidden outright:
*"Don't let the injected card grow. It is 248px of someone else's page."*

**Background polling with a badge count.** The obvious next request and the one
to refuse first. PRODUCT.md: *"No badges."* A timer that spends the reviewer's
token while they are not looking is also a different privacy story than the one
the README tells.

**`viewer.pullRequests` instead of search.** Real cursors, no 1000-cap. It only
covers pull requests you authored — no review requests, no involvement — so it
answers a third of the ask and would need the searches anyway.

---

## Not doing

- Writes of any kind from the list.
- Issues. `search(type: ISSUE)` returns both and the filter is one qualifier,
  which is exactly why it needs saying no to on purpose.
- Notifications. The REST notifications endpoint needs a token permission the
  README does not ask for, and a second permission for a second feature is how
  the token grant quietly becomes broad.
- GitHub Enterprise. Still a base-URL abstraction away, and this feature does
  not move it closer or further.
- Cross-machine sync of overrides. See §2.

---

## Open questions

1. **The fine-grained scoping probe in Part 1 has not been run.** Its answer
   does not change the architecture, but it decides whether §4's notice is a
   nicety or the thing that keeps the feature honest. Run it first.
2. **Whether `mergeStateStatus` behaves the same under a fine-grained token.**
   It resolved at `READ` permission under a classic one, against documentation
   that says otherwise. Verify before the Ready to merge bucket depends on it.
3. **The staleness default.** 14 days is a guess made in this document and
   should meet a real backlog before it is written into `DEFAULT_SETTINGS`.
4. **Whether DESIGN.md's navigation line is amended or exempted.** §5 argues
   for amending it. That is a call about the design system, not about this
   feature, and it should be made deliberately rather than by merging this.
   *Resolved during implementation: amended, with the three rules the amendment
   carries written into DESIGN.md §5.*

---

## What changed during implementation

Four things this document got wrong, found by executing rather than reasoning.
They are recorded here rather than edited away, because the reasoning that
produced each of them looked sound at the time.

**The cost figure in Part 1 was wrong by two orders of magnitude.** "A full
dashboard refresh costs roughly what opening one pull request costs" was
extrapolated from probes that never ran the real document. Spreading the thread
fragment into all four searches at `first: 100` with a nested `comments(last: 1)`
measures **155 points and 30,450 nodes**. The fix is in `DASHBOARD_THREAD_FIELDS`:
the counts are read only by the blocked-on-you rule, that rule returns nothing
unless the viewer wrote the pull request, so the fragment goes into the authored
search alone at `first: 25`. That measures **17 points and 3,100 nodes** for the
same information. The lesson is the one CLAUDE.md already states — execute the
document.

**"Ageing never buries work that is yours to do" made a useless list.** §1
exempted `blocked-on-you` from going quiet, on reasoning that still reads well.
Run against a real account it put **47 of 52** pull requests in that one bucket,
because every abandoned branch with red CI or a stale conflict is technically
blocked on its author. A bucket holding nine tenths of the list has stopped
sorting anything. Only `waiting-on-you` and `drafts` are exempt now: the first
is another person waiting and does not expire, the second is already where
nothing is asked. After the change the same data reads 1 and 51 — which is the
truthful shape of that backlog.

**Four searches, not three.** `involves:` covers author, assignee, mentions and
commenter, and does **not** cover a review request — so the most important row
on the page was invisible to the query this document described. `reviewed-by:@me`
was added for the same reason: an approval with no comment leaves no trace
`involves:` can see. Two of the four exclude `author:@me` so the merge has
almost nothing to deduplicate.

**`g p` was not free.** §5 claimed the `g` chord vocabulary was established by
`g h` and that `g p` needed no new concept. True, except `h` is unbound on its
own and `p` is `previous-thread` — so this is the first chord that takes a key
away from a single-key binding, within the sequence timeout. Kept, and written
down in `lib/keymap.ts` where somebody debugging it will find it.

Two smaller corrections came from looking at the rendered page rather than the
markup. The move control is hidden until a row is hovered or focused, because
ten copies of a rarely-used select were louder than the titles. And the Quiet
blurb was rewritten: that bucket holds both what has gone stale and what simply
needs nobody, and "nothing has moved here in a while" was plainly wrong on a
five-day-old pull request the reviewer had already approved.

## Not yet built

The involvement half of this design is complete and covered. The
**repository-watching half is plumbed but has no surface**:

- `lib/dashboard/repos.ts` and `CONTRIBUTED_REPOS_QUERY` exist and are tested,
  and the worker answers `discover-repos`.
- `Settings.watchedRepos` exists, validates and persists.
- Nothing reads any of it. There is no options-page picker, no `REPO_PRS_QUERY`,
  and no path by which a watched repository's pull requests reach the page.

It stopped there against a design question this document did not answer: a
repository-wide list contains pull requests that are *nobody's* business of the
reviewer's, and the six buckets are all phrased as whose turn it is. Every such
row lands in Quiet, which would flood the one bucket that is supposed to mean
"safe to ignore". Either those rows need a bucket of their own, or watching a
repository needs to mean something narrower than "show me everything in it".
That is a product decision, not an implementation detail.
