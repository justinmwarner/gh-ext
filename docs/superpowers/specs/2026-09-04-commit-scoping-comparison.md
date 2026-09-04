# Scoping the diff to commits — the open questions

**Date:** 2026-09-04
**Status:** Implemented as described in §0. Three decisions below are shipped
provisionally and want a human answer.

Everything here is about a feature that is already working: the reviewer can
show one commit, a range of commits, or "since my last review", and the three
are one mechanism. What follows is the set of choices that were genuine
trade-offs rather than obvious calls, with what was picked, what it costs, and
what the alternatives would buy.

The verified API facts these rest on are in
`docs/reference/github-review-api.md` §5a. Nothing below re-states a fact
without a citation there, and where something is **not** verified it says so.

---

## 0. What was built

- `lib/review/diffScope.ts` resolves a `DiffScope` — `whole`, `since-review`,
  or `{ from, to }` commits — into one pair of commits, plus which sides of the
  resulting diff can be trusted to share the pull request's line numbers.
- `lib/github/commits.ts` + two documents in `queries.ts` read
  `PullRequest.commits`, and report the shortfall when GitHub sends fewer than
  it says exist.
- `ui/ScopeBar.tsx` is a permanent row under the top bar saying what is on
  screen. `ui/CommitPicker.tsx` is the picker.
- `ui/reviewThreads.ts` and `ui/composerAnchor.ts` refuse to place anything on a
  side whose line numbers belong to a different commit.

Three decisions were forced rather than chosen, and are recorded here only so
nobody re-opens them:

**Three-dot, always.** `GET /compare/{a}..{b}` answers 404. There is one range
syntax and it is `{a}...{b}`. (Reference §5a.)

**A single commit is `parent...commit`.** The compare endpoint takes two
commits and `PullRequest.commits` carries `parents(first: 1)`, so this is the
only spelling available. It also makes "one commit" the degenerate case of "a
range", which is why there is one code path and not two.

**Force-pushed commits are checked against the commit list, not against the
response.** A commit pushed off a branch stays fetchable and the compare still
returns 200 — verified on a real force-push six days after the fact — so
"the request failed" is not a signal that arrives.

---

## 1. Should commenting be allowed while a narrowed diff is showing?

### The problem

`addPullRequestReviewThread` takes `path`, `line`, `side`, `startLine`,
`startSide` and **no commit**. A thread's `line` is likewise a position in the
pull request's own diff. So a line selected on a diff between two other commits
is not the line GitHub will attach the comment to — and the number usually
exists in both, so the comment posts, looks fine, and is about different code.

This is not a narrowing-only problem; it is why the existing "since my last
review" was already mis-anchoring **deletion-side** threads before this work.

### What ships today

The composer refuses, per side, with a sentence naming the remedy ("Show all
commits to comment on this line"). Threads on a side that does not line up are
listed in the per-file section with their own reason rather than drawn.

Note the asymmetry this creates and that it is not arbitrary:

| Scope | Additions side | Deletions side |
|---|---|---|
| Whole pull request | comment, anchor | comment, anchor |
| Since my last review | comment, anchor | listed / refused |
| A range ending at the head | comment, anchor | listed / refused unless the range starts at the base |
| Any scope ending elsewhere | listed / refused | listed / refused unless it starts at the base |

So "since my last review" — the common case — keeps commenting on added lines,
which is the overwhelming majority of review comments.

### Options

**A. Refuse, as shipped.** Costs: a reviewer reading one commit closely cannot
comment without leaving that view. Buys: it is impossible to post a comment
against a line nobody read. No new API surface, no new failure modes.

**B. Allow it, via a REST write path.**
`POST /repos/{o}/{r}/pulls/{n}/comments` accepts `commit_id` alongside `line`
and `side`, which is exactly the missing argument, and is what GitHub's own UI
uses when you comment while viewing a single commit. Costs: a second write
transport beside the GraphQL one, in a codebase whose entire mutation story is
GraphQL and whose pending-review machinery (`ui/reviewSession.tsx`) is built on
review ids. Attaching a REST comment to a pending review means
`in_reply_to`/`pull_request_review_id` semantics that have **not** been
verified here at all. Buys: the reviewer can comment where they are reading.

**C. Allow it, mapping the line through both diffs.** Costs: we would be
re-implementing what `commit_id` does server-side, from patches we may not have
(the file may not be in the pull request's diff at the same hunk), and a
mapping that is wrong is worse than a refusal because it is silent. Buys:
nothing B does not.

### Recommendation

**A now, B if the refusal turns out to bite.** The whole extension exists so
one person can review faster; if "read one commit, comment on it" is a normal
motion for them, B is worth the second transport — but it should be a
deliberate decision with the `commit_id` behaviour executed against the live
API first, not inferred. A is not a placeholder that has to be replaced: it is
correct, and it is the only option where a comment cannot silently land on the
wrong line.

---

## 2. What should a selected *range* mean?

### The problem

The reviewer selects commits A (earlier) and B (later). Two readings:

1. **Inclusive of A** — base is A's *parent*. "Show me what these commits did."
2. **Exclusive of A** — base is A itself. "Show me what happened after A."

Both are defensible. Reading 2 is what "since my last review" means; reading 1
is what "I selected these three commits" means.

### What ships today

Reading 1 for the picker, reading 2 for the review preset.

The argument for 1 in the picker: it makes selecting one commit and selecting a
one-commit range **the same request**. Under reading 2, `range(A, A)` is empty,
so the picker would need a separate single-commit mode and the two controls
would disagree about what "selected" means. That internal consistency is worth
more than matching either reading exactly.

The argument for 2 in the preset: the reviewer *has already read* the commit
they last reviewed at. Including it again is not a range, it is a repeat.

### What GitHub does

**Not verified.** GitHub's Files-changed tab has a commit filter that supports
single commits and ranges, and the URL form is `/pull/N/files/{a}..{b}`. Which
commit `{a}` is — the first selected one, or the one before it — was not
established: the docs page could not be fetched from this environment, and the
rendered page is not a reliable way to read the semantics. **Someone should
check this against the real UI before treating the picker's behaviour as
"matching GitHub".** If GitHub uses reading 2, the picker is one commit wider
than GitHub's for the same selection.

### Options

**A. Inclusive for the picker, exclusive for the preset (shipped).** Costs: two
meanings on one screen, if a reviewer thinks about it. Buys: one-commit and
one-commit-range agree; the preset means what its label says.

**B. Inclusive everywhere.** The preset would then show the reviewed commit's
own changes again. Costs: "since my last review" stops being true.

**C. Exclusive everywhere.** Costs: a separate code path for single commits.

### Recommendation

**A**, with the GitHub check above done and this document amended either way.
The two meanings are not a wart: they follow from the two labels, and each is
the honest reading of the words on its own control.

---

## 3. How should the commit picker work?

### What ships today

An overlay listing every commit oldest-first — short oid, headline, author,
date. Clicking a row scopes to that commit. Each row also carries a "Compare
from" button that sets the start of a range; the next row click closes it.

Two properties were deliberate:

- **No modifier gestures.** Shift-click is the obvious range affordance and is
  unreachable from the keyboard, on a list that can run to 250 rows.
- **No mode change.** After "Compare from" the list stays exactly where it was
  with the anchor marked, so the second click is a click on the list already
  being read.

### What it does not do

- **No keyboard shortcut opens it.** §9 of the design fixes the keymap and
  `ShortcutHelp` generates itself from it, so adding a binding is a change to a
  published contract rather than an implementation detail. Deliberately not
  taken unilaterally. If wanted, the natural spelling is a single letter in the
  Navigation group.
- **No search or filter.** At 250 rows this will be wanted. It was left out
  because the file-jump palette already exists (`Mod+K`) and a second search UI
  should probably reuse it rather than grow beside it.
- **No "N commits since your last review" affordance in the list.** The preset
  button covers the case; marking the reviewed commit in the list would be a
  nice orientation cue and is one line of the row's decoration.
- **The picker is not URL-addressable.** The route is
  `review.html#/{owner}/{repo}/{number}` and the scope is page state, so a
  reload returns to the whole diff. GitHub's `/files/{a}..{b}` is shareable; this
  is not. That is a real difference and a small change (`useHashRoute` would
  grow a segment), but it also means a stale link cannot resurrect a scope
  pointing at commits that no longer exist — which is the failure §0 spends
  effort preventing. **Recommend leaving it page state.**

### Options for the range gesture

**A. Anchor button per row (shipped).** Costs: a second control on every row,
and a two-step interaction that has to be explained (it is, in the panel's
hint line). Buys: keyboard-reachable, no hidden gesture.

**B. Shift-click.** Costs: unreachable without a mouse. Buys: familiar, no
extra chrome.

**C. Two `<select>`s, "from" and "to".** Costs: reads nothing like GitHub, and
a `<select>` of 250 commit headlines is unpleasant. Buys: trivially
accessible, no invented interaction.

### Recommendation

**A**, plus B as an accelerator if it is missed. The two are not exclusive —
shift-click can be added as a shortcut for the same state transition without
removing the button.

---

## 4. Smaller things decided without asking

Recorded so they can be reversed knowingly.

**The commit list is fetched eagerly, in parallel with the batched read.** One
extra GraphQL round trip per pull request view, for a feature many views will
not use. It does not delay the diff — it is issued alongside — and it is what
makes the force-push check work on load rather than only after the picker is
opened. The alternative is a `get-commits` message fetched when the picker
opens, which costs a spinner and a fourth loading state.

**The commit list is cached in its own slot, mutable, keyed on the head SHA**,
alongside `threads` and `checks`. A pull request's commit list is `base..head`,
so it can change when the *base* branch moves under an unchanged head — hence
mutable rather than immutable like `diff`.

**A commit list that could not be read is reported as `truncated`, not as an
error.** A pull request has at least one commit, so an empty list is never the
honest answer; and "the commits you can pick from are not all of them" is the
same fact whether GitHub capped the list or the request failed. The review page
still renders — losing the picker must not lose the diff.

**"Since my last review" is not checked against the commit list.** Unlike a
picked commit, the reviewed commit is not a choice the reviewer can correct,
and a three-dot compare against a commit that has left the history still
answers the question from the merge base. This is the one place a diff against
departed history is deliberately shown. If that turns out to mislead, the fix
is a note on the bar rather than disabling the preset.

**Comparisons are not cached, and the reason is weaker than it was.** The
worker's comment used to say the reviewer asks for one comparison by pressing a
toggle; with a picker they may walk a history and come back, and each visit is a
fresh request. A compare between two commits is immutable, so it could be cached
forever — but not in `PrCache` as it stands, whose keys end in a single head SHA
and whose `forgetOtherCommits` sweep would treat every compare entry as
belonging to a superseded commit and delete it on the next assembly. One request
per selection is well inside the hour's quota, so this was left alone rather
than bolted on. If stepping through commits feels slow, the cheap fix is a
bounded in-page cache in `useCompareDiff` — bounded, because 250 file lists is
not a thing to hold in a tab.

**The scope bar is always on screen, including for the whole diff.** It costs
~35px of the column permanently. The alternative — showing it only when
narrowed — makes it a control the reviewer stops looking for, which is the
failure it exists to prevent. (It also, in passing, broke two browser tests
that were unknowingly asserting a viewport-dependent fact; that is fixed in the
tests, not by hiding the bar.)
