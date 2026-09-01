# Fast GitHub Review — Chrome Extension Design

**Date:** 2026-09-01
**Status:** Approved, ready for implementation planning

## 1. Problem

Reviewing a pull request on github.com is slow. The PR page is heavy, navigation
between files costs a round trip, and diff rendering degrades on large changes.
The review actions themselves — comment, reply, resolve, approve — are a small,
well-defined set we perform constantly, but they are buried in a page that does a
hundred other things.

## 2. Goal

A Chrome extension that injects a **Fast review** button on GitHub PR pages.
Clicking it navigates to a standalone review application built on Pierre's
open-source rendering components, covering the review actions we use every day
and nothing else.

Success means the diff is on screen in under 400ms from click on a warm cache,
and a normal review — read the diff, leave comments, resolve threads, approve —
never requires returning to github.com.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the UI lives | Standalone SPA in an extension page | Overlaying github.com keeps GitHub's page weight, which is the thing we are escaping |
| Escape hatch | "Open in GitHub" for anything unsupported | Bounds the surface we must build and maintain |
| Auth | Fine-grained PAT now, behind an interface that admits OAuth device flow later | Zero infrastructure, works day one, no rework to upgrade |
| Entry point | Button injected on the PR page, plus a keyboard shortcut | Opt in per PR; no hijacking of links where native GitHub is wanted |
| Hosts | github.com only | GitHub Enterprise is a base-URL abstraction we can add later |
| Surface | Files changed, plus a PR overview panel | The four core features live here; description and check state are needed context |
| Audience | Personal tool, loaded unpacked | No store review, no onboarding polish, no support burden |
| Stack | WXT + React + TypeScript | Purpose-built MV3 framework: generated manifest, real HMR, least boilerplate |
| Layout | Mirrors GitHub's Files-changed tab | Minimize learning and teaching load |

### Prior art considered

[`clemg/pierre-github`](https://github.com/clemg/pierre-github) already swaps
GitHub's diff and file tree for Pierre components in place. We are deliberately
not taking that approach: it improves rendering but still loads GitHub's PR page
first, so it cannot be fast. It remains a useful reference for how to drive
`@pierre/diffs` and `@pierre/trees` against real GitHub data.

### Dependencies

Both from `pierrecomputer/pierre`, Apache-2.0:

- `@pierre/diffs` (v1.3.6) — Shiki-based diff rendering. React entry point at
  `@pierre/diffs/react`, off-main-thread highlighting at `@pierre/diffs/worker`,
  and an annotation framework designed for injecting inline comments.
- `@pierre/trees` — path-first file tree. `<FileTree model={...} />` from
  `@pierre/trees/react`, with built-in search, `setGitStatus`, and
  `scrollToPath`.

Both ship agent skills (`npx skills add pierrecomputer/pierre --skill diffs`,
and `--skill trees`). Install these before implementation so the exact API is
available rather than guessed.

## 4. Architecture

Three MV3 contexts. The governing rule: **all network traffic goes through the
service worker.**

### Content script — `github.com/*/pull/*`

Injects the Fast review button into the PR header and sends a prefetch message to
the service worker on page load. It does not otherwise modify GitHub's DOM.
Keeping it this thin means GitHub markup changes can break the button but can
never break the review app.

### Background service worker

Owns the GitHub client, the token, the response cache, prefetching, and
rate-limit handling. It must own the data for two reasons: prefetch begins while
the user is still on github.com and has to survive into a page that does not yet
exist, and keeping the token here means no page context ever holds it.

### Extension page SPA — `review.html`

React 19 application. Communicates with the service worker over a long-lived
`chrome.runtime` port so streamed results (diff first, threads second) can paint
progressively. Route: `review.html#/{owner}/{repo}/{number}`.

### Options page

Token entry, ignored-path globs, and rate-limit status.

## 5. Layout

Mirrors GitHub's Files-changed tab.

- **Sticky top bar** — PR title and number, state badge, `base ← head`, checks
  rollup chip, reviewer avatars, `Open in GitHub`, `Review changes`
- **Left rail**, resizable — a collapsible **Overview** disclosure on top
  carrying the PR description, per-check statuses, reviewer states, and a
  jump-list of unresolved threads; the **file tree** below it
- **Main column** — stacked per-file diff cards, each with path, added and
  removed counts, viewed checkbox, and collapse toggle

Theming follows whatever `@pierre/diffs` and `@pierre/trees` do natively,
including light and dark mode. We add nothing custom.

## 6. Data layer

### Reads

One batched GraphQL query covers PR metadata, `reviewThreads`, `reviews`, the
checks rollup, reviewer states, and per-file viewed state.

The diff comes from a single REST call: `GET /repos/{owner}/{repo}/pulls/{n}`
with `Accept: application/vnd.github.diff`, returning the entire unified diff in
one round trip. If GitHub refuses to generate it, which it does for exceptionally
large diffs, fall back to paginated `GET /repos/{owner}/{repo}/pulls/{n}/files`,
which caps at 3000 files and omits `patch` for very large individual files. In
that case, render what is available behind a banner offering the escape hatch.

Blob contents are fetched lazily, only when the user expands unchanged context.

### Writes

All mutations are GraphQL, verified present in the live schema:

- `addPullRequestReviewThread` — new thread, single or multi-line
- `addPullRequestReviewThreadReply` — reply
- `resolveReviewThread` and `unresolveReviewThread` — resolve toggle
- `submitPullRequestReview` — submit with `COMMENT`, `APPROVE`, or
  `REQUEST_CHANGES`
- `markFileAsViewed` and `unmarkFileAsViewed` — viewed state

`PullRequestReviewThread` exposes `isResolved`, `isOutdated`, `path`, `line`,
`startLine`, `diffSide`, `startDiffSide`, `viewerCanReply`, `viewerCanResolve`,
and `viewerCanUnresolve` — everything the UI needs, with permission flags so
controls can be disabled rather than failing on submit.

### Caching

Keyed on `headSha`. The diff for a given head SHA is immutable, so it is cached
in `chrome.storage.local` and revisits are instant. Threads and checks are
mutable: short TTL, revalidated on window focus.

Rate limits are 5000 requests per hour for REST and 5000 points per hour for
GraphQL, which is ample for one person. Remaining quota is surfaced on the
options page.

## 7. Speed budget

Target: diff painted **under 400ms** from click on a warm cache, **under 1.5s**
cold on a typical PR.

- Prefetch fires when the content script loads, so by the time the button is
  clicked the data is usually already in the service worker
- `@pierre/diffs/worker` moves Shiki highlighting off the main thread
- The file list is virtualized; diffs render as they scroll into view
- Immutable diff caching makes second visits effectively free

The dominant win is structural: we never load GitHub's PR page.

## 8. Review model

A state machine with two states.

**Browse** — no pending review exists. A new comment posts immediately as a
standalone review comment.

**Pending review** — entered by "Start a review", or by choosing "Start review"
on the first comment. Creates a `PENDING` review; subsequent line comments attach
to it. A footer bar shows the pending comment count and the submit control.

**Submit** offers Comment, Approve, or Request changes, with an optional summary
body, via `submitPullRequestReview`.

Replies and resolve/unresolve are optimistic with rollback on failure.

### Threads

Rendered as Pierre annotations anchored to `(path, line, side)`. Multi-line
comments come from Pierre's line-range selection, mapped to `startLine` and
`line` with matching `startDiffSide` and `diffSide`.

Threads with `isOutdated: true` reference lines that no longer exist in the
current diff. They are grouped into a collapsed **Outdated** section at the foot
of the relevant file rather than being anchored to a wrong line.

### Suggestions

Authoring suggestion blocks is supported: the composer has a button that wraps
the selected lines in a fenced `suggestion` block, and suggestion blocks render
with their proposed result.

Applying a suggestion is not supported in v1. GitHub exposes no public endpoint
for it; implementing it would mean constructing a commit through the Git Data API
with push access to the head branch. Since this is a reviewer's tool and applying
is the author's action, "Apply" opens the thread on GitHub.

## 9. Feature specifications

### Viewed state and incremental review

Viewed state uses GitHub's own `markFileAsViewed`, so marks made here appear on
GitHub and vice versa. There is no parallel state to reconcile.

**Changes since my last review** reads `commit.oid` from the viewer's most recent
review on the PR and re-renders the diff as `thatSha...headSha`. It is exposed as
a toggle in the top bar, disabled when the viewer has no prior review.

### Draft persistence

Drafts are keyed by `{prId, path, line, side}` and written to
`chrome.storage.local` on a debounce. They are restored on load and cleared only
after a successful post. A failed mutation never discards a draft.

### Noise suppression

Files matching a configurable glob list are collapsed by default. Ships with
lockfiles (`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `go.sum`), `vendor/`,
`dist/`, `node_modules/`, and common generated paths. The file tree's built-in
search handles ad-hoc filtering.

### Search within the diff

Client-side search over the parsed patch, matching paths and changed lines, with
a results jump-list. Bound to `/`, overriding the browser's find within the app.

### Keyboard map

| Key | Action |
|---|---|
| `j` / `k` | Next / previous file |
| `J` / `K` | Next / previous hunk |
| `n` / `p` | Next / previous thread |
| `N` / `P` | Next / previous **unresolved** thread |
| `v` | Toggle viewed |
| `c` | Comment on selected line |
| `r` | Reply to focused thread |
| `e` | Resolve or unresolve focused thread |
| `Mod+K` | File jump |
| `Mod+Enter` | Submit comment |
| `Shift+Mod+Enter` | Submit review |
| `g h` | Open in GitHub |
| `/` | Search in diff |
| `?` | Shortcut help overlay |

`Mod` is `Ctrl` on Windows and Linux, `Cmd` on macOS. The primary development and
usage target is Windows, so `Ctrl` is the binding that must be verified; the
platform check lives in the keymap module and nowhere else.

The map lives in a single module so it stays consistent and is trivially
testable. It is not user-configurable in v1.

## 10. Auth

A fine-grained personal access token entered on the options page. Required
permissions: Pull requests read and write, Contents read, Checks read, Metadata
read.

Stored in `chrome.storage.local`, accessed only through a `TokenProvider`
interface so an OAuth device flow can replace it without touching call sites.

`chrome.storage.local` is not encrypted, and any code running in the extension
can read it. For a personal, unpacked tool this is an acceptable trade, but it is
a real property of the design and should be revisited before the extension is
shared or published.

The token is stored in `local`, not `sync`, so it is not replicated across
machines.

## 11. Error handling

| Condition | Behaviour |
|---|---|
| No token, or token rejected | Full-page setup state linking to options |
| Rate limited (403) | Show reset time, serve stale cache if present |
| Repo inaccessible (404) | Explain, offer Open in GitHub |
| Mutation fails | Optimistic rollback, retry toast, draft preserved |
| Diff too large to generate | Fall back to `/files`, banner, escape hatch |
| Unexpected render failure | Per-file error boundary; one bad file cannot blank the page |

## 12. Testing

Pure modules under `lib/` are tested with Vitest and no browser: diff parsing,
thread anchoring, the pending-review state machine, the draft store, filter
globs, and the keyboard map.

GitHub interactions are tested against an MSW-mocked client covering the full
review flow — start review, comment, reply, resolve, submit with each event type
— including failure and rollback paths.

Fixtures deliberately include the awkward cases: a 5000-file PR, a force-pushed
PR with outdated threads, renamed files, binary files, and submodule changes.

One Playwright smoke test drives the built extension end to end: click the
button, confirm the diff renders, leave a comment, submit the review.

CI does not talk to real GitHub.

## 13. Module layout

```
src/
  entrypoints/
    content.ts          # button injection + prefetch ping
    background.ts       # service worker: client, cache, prefetch, router
    review/             # the SPA
      main.tsx  App.tsx  routes.ts
    options/
  lib/
    github/
      client.ts         # transport: token, GraphQL + REST, rate limits
      queries.ts        # typed GraphQL documents
      mutations.ts
      diff.ts           # unified diff -> per-file patches
      types.ts
    review/
      threads.ts        # anchoring, outdated grouping
      pending-review.ts # state machine
      drafts.ts
      viewed.ts
      filters.ts
    cache.ts
    keymap.ts
  ui/
    Shell.tsx  Header.tsx  Sidebar.tsx  Overview.tsx
    FileTree.tsx         # wraps @pierre/trees
    DiffFile.tsx         # wraps @pierre/diffs, mounts annotations
    Thread.tsx  Composer.tsx  SubmitReview.tsx
```

Nothing in `lib/` touches the DOM or the `chrome.*` APIs, so it tests without a
browser and can be reasoned about in isolation. `ui/` consumes `lib/` and owns no
data-fetching logic of its own.

## 14. Out of scope for v1

Conversation timeline, commits tab, merging, emoji reactions, mention
autocomplete, inline CI logs and job re-runs, line permalinks, whitespace and
word-wrap toggles, a PR inbox, GitHub Enterprise, and Firefox.

Applying suggestions is out of scope; authoring them is in.

## 15. Known risks

**GitHub markup changes break button injection.** Mitigated by keeping the
content script trivially small, and by making the extension reachable through a
keyboard shortcut and a direct URL even if the button fails to mount.

**Pierre's annotation API may not cleanly express every thread state** —
outdated, pending, resolved, multi-line. This is the largest unknown in the
design and should be spiked first, before any other implementation work.

**Token storage in `chrome.storage.local`** is acceptable for personal use only,
as described in section 10.

---

## 16. Amendments from API verification (2026-09-01)

Sections 1-15 were written before the Pierre and WXT APIs had been read. Three
research passes against real source, published tarballs, and a scaffolded WXT
build invalidated several assumptions. Full detail is in
`docs/reference/pierre-diffs-api.md`, `pierre-trees-api.md`, and `wxt-setup.md`.
The changes that alter the design:

### 16.1 Annotations cannot span a line range — §8 changes

`DiffLineAnnotation` is `{ side: 'deletions' | 'additions', lineNumber, metadata }`.
There is exactly one `lineNumber`; ranges are not representable.

`side` maps 1:1 onto GitHub's `DiffSide` (`deletions` = `LEFT`, `additions` =
`RIGHT`), so anchoring is otherwise clean. Multi-line threads are still *created*
with `startLine`/`line` as §8 describes, but when *rendering* an existing
multi-line thread we anchor the annotation to its end line and carry the range in
our own `metadata` for the thread header to display.

### 16.2 Annotations on collapsed lines silently do not render

If a thread's line falls outside a rendered hunk, its annotation is dropped with
no error. Combined with the fact that outdated threads have `line: null` at all
(section 1 of the API reference), the rule is: **any thread that cannot be
anchored to a visible line must render in the per-file collapsed section**, not
just outdated ones. That section is now load-bearing rather than a nicety —
without it, comments disappear.

### 16.3 Expanding context requires a blob loader — new dependency

A diff parsed from a GitHub patch is `isPartial: true`, and in that state Pierre
shows **no expand affordance at all** and `revealLine()` returns `false`. Expand
only appears once a `loadDiffFiles` callback is supplied that returns the full
contents of **both** sides of the file.

This is a real dependency §6 understated. Expanding one file costs two blob
fetches, base and head.

### 16.4 No syntax-highlighting worker in v1 — §7 changes

§7 called for `@pierre/diffs/worker`. Dropping it, for four converging reasons:

- The default `preferredHighlighter` is already `'shiki-js'`, using Shiki's
  JavaScript regex engine — there is no WebAssembly on the default path
- Grammar resolution must happen on the main thread regardless; it throws in a
  worker
- Vite resolves workers to `http://localhost:3000/...` in dev, which is
  cross-origin from a `chrome-extension://` page, and Chrome 148+ crashes the
  render process rather than throwing
- Pierre's own docs banner-flag the worker pool as experimental

Performance is instead carried by `VirtualizedFileDiff`, which is a first-class
export. Revisit only if profiling shows main-thread stalls.

**Never set `preferredHighlighter: 'shiki-wasm'`.** WXT emits no
`content_security_policy` key in production builds, so the WASM path works in dev
and dies silently in prod. This is guarded by a test rather than a comment.

### 16.5 The file tree's built-in search breaks the keyboard map — §9 changes

`isSearchOpenSeedKey` matches any single letter or digit without a modifier, then
calls `stopPropagation()`. Every single-letter shortcut in §9 would be swallowed
whenever the tree holds focus.

The tree is constructed with `search: false` and we own the file filter on
`Mod+K`. §7's claim that "the file tree's built-in search handles ad-hoc
filtering" is withdrawn.

### 16.6 One decoration per tree row — §5 changes

`FileTreeRowDecoration` is a union of *either* a text cell *or* a single icon,
never both, alongside the separate git-status lane. Viewed state, line counts,
and an unresolved-comment badge cannot be three elements.

Resolution: the git lane carries `changeType`; the decoration cell carries
`+12 −3` using `parts` for per-run colour, which is the exact case the library's
own source comment cites. The viewed checkbox lives in the diff card header,
where §5 already put it. Decorations are also inert `<span>`s, so nothing in the
tree can be clickable beyond row selection.

There is no `refresh()`; changing decoration state requires forcing a re-render
via `setIcons(currentIcons)`. That mechanism is inferred from source rather than
documented, and `@pierre/trees` is at `1.0.0-beta.6`, so **both Pierre packages
are pinned to exact versions**.

### 16.7 The background opens the review tab, not the content script — §4 changes

A content-script navigation to `review.html` is a web-origin navigation and would
require listing the page in `web_accessible_resources`, which makes the extension
fingerprintable by github.com. The content script instead messages the background
worker, which calls `chrome.tabs.update` on the active tab. Same-tab behaviour is
preserved and nothing is exposed to the page.

### 16.8 Smaller corrections

- Line selection is only reachable through the line-number gutter, so
  `disableLineNumbers` must never be set. The GitHub-style "+" affordance is
  `enableGutterUtility` + `onGutterUtilityClick`.
- `SelectedLineRange` preserves drag direction, so `start` may exceed `end`, and
  omits `endSide` when it equals `side`. It can also express cross-side ranges,
  which GitHub cannot. Normalize and reject cross-side before building a payload.
- Annotation `metadata` is compared by reference; it must be memoized or every
  render churns annotation DOM.
- In React, never call the tree's `cleanUp()` — `useFileTree` already does.
- The WXT dev command is bare `wxt`; `wxt dev` is parsed as a root directory and
  fails. `vite` is a required peer dependency in 0.21, and Node >= 22 is needed.
- Content scripts get no HMR and are absent from the dev manifest entirely, so
  the injected button must be smoke-tested against a production build.
