# The Find Panel — Design

**Date:** 2026-09-17
**Status:** Implemented
**Register:** product

## Goal

Replace the modal search that `Ctrl+F` and `/` open with a persistent panel in
the left rail, in the shape a reviewer already knows from VS Code: a query box,
a result tree nested the way the file tree is nested, and a line of preview text
under each file showing what matched.

The current panel is a jump list. It ranks candidates, sends the reviewer to one
and closes. That is the right shape for "I know what I want, take me there" —
which is what `Mod+K` is for — and the wrong shape for the other question a
reviewer asks a diff, which is **"where does this appear, and let me walk all of
them."** A list that closes on the first answer cannot answer the second.

---

## Part 0: The shell already has the right bones

`ui/ViewSwitcher.tsx` is a vertical rail of icons that swaps what fills the
window. `ui/FileTree.tsx` is a resizable column beside the diff. `DiffColumn` is
the thing being read. That is an activity bar, a sidebar and an editor, which is
the layout this feature is being asked to imitate — so the work is not inventing
a place to put a panel, it is swapping one sidebar for another.

Three existing pieces carry most of the weight:

- `lib/review/search.ts` already walks patch text, tracks hunk positions, and
  reports *where* inside a string it matched so the caller can highlight.
- `ui/treeRows.ts` already turns a list of paths into flat, ordered, nestable
  rows — and CLAUDE.md is explicit that it is the single authority on that
  order, because the column and the rail disagreed about it once.
- `ui/DiffColumn.tsx`'s `goToLine` scrolls the viewer and **does not touch
  focus**. That one fact is what makes the whole feature worth building: the
  reviewer can hold the arrow keys in the result tree and watch the diff move
  underneath, which a modal over the top of the diff could never do.

---

## Part 1: Decisions taken

Recorded because two of them went against the recommendation, and the next
person to read this should know they were chosen rather than defaulted into.

| Decision | Choice |
|---|---|
| Where the panel lives | **Swaps with the file tree in the left rail.** Diff column never moves or resizes. |
| `Mod+K` file jump | **Stays modal.** VS Code keeps both `Ctrl+P` and `Ctrl+Shift+F`; they are different jobs. |
| The tree's own `Filter files…` box | **Stays.** It narrows a checklist; this finds. |
| Which lines content matches can hit | **Changed lines *and* context.** *Against recommendation.* |
| Case / whole-word / regex toggles | **All three.** *Against recommendation.* |

The two overridden recommendations both argued from "do less, completely". The
counter-argument that won is that a reviewer arriving from VS Code has a
concrete expectation of what a find panel does, and a find panel that silently
declines to match half the lines on screen — or that cannot be told to respect
case — reads as broken rather than as focused. The scope of the change is
larger as a result; Part 2 is where that shows up.

**Not doing: highlighting matches inside the diff itself.** `docs/reference/`
records that Pierre drops an annotation outside a rendered hunk silently, so
marks would blink in and out as context expands. A result tree that is honest
beats an in-diff highlight that is not.

---

## Part 2: The search engine

`lib/review/search.ts` stays pure and gains one idea: **compile the query to a
`RegExp` once, then sweep.** Three toggles and a plain substring are four
spellings of the same operation, and one compiled matcher is cheaper to reason
about than four code paths.

```ts
export interface MatchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface Span { start: number; end: number; }

export type Matcher =
  | { ok: true; spans(text: string): Span[] }
  | { ok: false; error: string };

export function compileMatcher(query: string, options: MatchOptions): Matcher;
```

- A plain query is escaped before it becomes a pattern.
- `wholeWord` wraps it in `\b(?:…)\b` — which composes with `regex`, the way
  VS Code composes them.
- `caseSensitive` off is the `i` flag. Off is the default, which is today's
  behaviour.
- The `g` flag is always set, because a line with three hits has to report
  three. A zero-length match — `a*` under `regex` — advances `lastIndex` by one
  by hand, or the sweep never terminates.
- An invalid pattern returns `{ ok: false, error }` rather than throwing. The
  panel prints it. PRODUCT.md principle 4 is that nothing fails silently, and a
  box that goes blank when you type `(` is the failure it names.

`searchParsed` and `searchDiff` match through this and nothing else.
`pathMatches` and `filterPaths` keep the private `locate` — a lowercased
`indexOf`, which is what the tree filter wants when it re-runs over every path
on every keystroke. With all three toggles off the two agree exactly, so a
query that finds a file in one finds it in the others; the toggles are the find
panel's alone.

### Context lines

`changedLines(patch)` becomes `patchLines(patch)`, which reports context lines
too, as `kind: 'context'`. `changedLines` survives as a filter over it so its
existing test stands unchanged.

A context line exists on both sides and needs one number. It gets the
**additions** side — the new-file numbering, which is what a reviewer means when
they say "line 42". `goToLine` only scrolls, so nothing here has to satisfy
`AnchorableSides`; that constraint is about *anchoring a comment*, not about
scrolling to a line.

`DiffMatchKind` gains `'context'` so a result row can be drawn without a `+` or
`−` in front of it. A reviewer has to be able to tell at a glance which hits are
in code the author touched.

### Every occurrence, and one parse

Two consequences of the choices in Part 1, both load-bearing:

**One row per match, not per line.** Today `locate` finds the first hit in a
line and stops. With a browsable panel that makes the summary count lie and
makes "step through every match" impossible. Rows are per occurrence, each
drawing the line with its own span marked.

**The patch is parsed once.** `searchDiff` currently calls `changedLines` per
file per search. Context lines roughly quadruple the corpus, and the panel now
re-searches on every keystroke with a regex, so parsing per keystroke would
spend the speed budget PRODUCT.md principle 3 sets. The parse is split from the
sweep — `patchLines` memoised against the file list, `searchParsed` over the
result — so a keystroke costs a regex pass and nothing else.

### Cap

2000 matches, up from the current 100. The old number was sized for a list
nobody scrolls; a tree the reviewer walks deserves more. When the cap is hit the
summary says so, rather than quietly presenting a prefix as the whole answer.

---

## Part 3: The result tree

Three modules, small and separately testable.

**`ui/searchRows.ts`** (pure) builds `SearchRow[]`:

```ts
export type SearchRow =
  | { kind: 'directory'; path: string; name: string; depth: number; expanded: boolean; matches: number }
  | { kind: 'file';      path: string; name: string; depth: number; expanded: boolean; matches: number }
  | { kind: 'match';     path: string; depth: number; key: string; match: DiffMatch };
```

It calls `treeRows(matchedPaths, collapsed)` for the structure and splices match
rows under each expanded file row. **Order therefore still comes from
`treeRows`**, which is the rule CLAUDE.md sets and the reason a root-level
`README.md` cannot sort differently here than it does in the column.

**`ui/treeKeys.ts`** (pure) is the arrow-key resolver — Up, Down, Home, End,
Left-collapses-or-walks-to-parent, Right-expands-or-descends — lifted out of
`FileTree` and shared with the new tree. Around twenty-five lines of identical
fiddly logic that would drift if copied. `Enter` and `Space` stay in each
component, because they mean different things in a checklist and in a result
list.

**`ui/SearchTree.tsx`** renders the rows, reusing `.tree-row`, `.tree-chevron`,
`.tree-icon-slot` and `.tree-name` from the stylesheet and `useFileIcons` for
the drawings, so a file looks the same in both trees.

### Why not extend `FileTree`

`FileTree` is a checklist: tick boxes, viewed state, comment marks, `+`/`−`
counts, a status letter. None of that belongs on a result row, and a component
that drew both would carry a mode flag through every branch of its render. What
is genuinely shared — the order, the icons, the row anatomy, the keyboard — is
shared above, by the three modules that have one job each.

---

## Part 4: The rail swap

`FilesView` grows a two-tab rail header, **Files | Search**, so the panel is
reachable by pointer and not only by a shortcut the reviewer has to already know
about.

Both trees stay mounted, stacked in one grid cell and swapped with
`visibility` — the pattern `.views` already uses in the stylesheet, and for the
same reason. Unmounting would cost the file tree its folds and its filter, and
the find panel its results and its scroll position, every time the reviewer
looked at the other one.

`Shell` loses `{ kind: 'search'; mode: SearchMode }` from its `Overlay` union.
`search-in-diff` calls `openFind()` on a `FilesViewHandle`, mirroring the
existing `columnRef` — the precedent for an imperative handle is already in this
file. `SearchPanel` shrinks to the `Mod+K` file jump and loses its `mode` prop.

`Mod+F` stays `releasable`. A reviewer who has handed that key back to the
browser still has `/`.

---

## Part 5: Behaviour

| Input | Result |
|---|---|
| Typing | filters live |
| `↓` from the box | focus moves to the first row |
| `↑` `↓` on rows | **the diff scrolls to the match; focus stays in the panel** |
| `Enter` on a match | scrolls, and hands focus to the diff column |
| Click a match | scrolls; focus stays |
| `Esc` in the box | clears the query; on an already-empty query, back to the tree |
| `Ctrl+F` / `/` while open | refocuses the box and selects its text |

The third row is the feature. Everything else is in service of it.

`Esc` clearing before closing follows the tree filter's established behaviour,
so the two boxes in this rail answer the same key the same way.

### The summary line

A `role="status"` line under the box, in the shape `.filetree-count` already
uses:

- `312 results in 27 files`
- `First 2000 results in 148 files` when capped
- `No results`
- `Invalid pattern: <message>` when `regex` is on and the query will not compile

It exists for the reason `FileTree`'s `narrowed` line exists: a panel that is
quietly showing a prefix of the truth is worse than one that says so.

### The toggles

Three `aria-pressed` buttons inside the box's trailing edge — match case, whole
word, use regular expression — with drawn 16px glyphs rather than a new
dependency, `aria-label` and `title` on each. They are designed against the
rail's **180px minimum width**, which is the tightest they ever have to fit.

Their state lives with the query in `FilesView`, so it survives a swap to the
file tree and back. It is not persisted to storage; that is a separate argument
and a separate setting.

---

## Testing

**Node (`lib`):** matcher compilation across the eight toggle combinations;
invalid regex; the zero-length-match guard; context lines and their numbering;
multiple matches on one line; the cap.

**Node (`ui`, no DOM):** `searchRows` assembly, that its order matches
`treeRows`, and collapse behaviour; the `treeKeys` resolver.

**jsdom:** `FindPanel` — typing, each toggle, the four summary states, and that
arrowing a result scrolls without moving focus.

**Updated:** `ui/keyboardNav.test.tsx` — `/` and `Mod+F` now open the rail panel
rather than a modal; `Mod+K` still opens a modal.

**e2e:** one case in `review.spec.ts` — open the panel, type, arrow onto a
result, assert the diff moved. The production build is the only honest check
that the built CSS lays the rail out correctly.

---

## Files

New: `ui/searchRows.ts`, `ui/treeKeys.ts`, `ui/SearchTree.tsx`,
`ui/FindPanel.tsx`, plus their tests.

Changed: `lib/review/search.ts`, `ui/FileTree.tsx` (adopts `treeKeys`),
`ui/FilesView.tsx`, `ui/Shell.tsx`, `ui/SearchPanel.tsx` (shrinks),
`entrypoints/review/style.css`.

Docs: a note in CLAUDE.md that `treeRows` now has a second consumer and why
`searchRows` defers to it.

---

## What the implementation changed

Three things the design did not anticipate, recorded because each was decided
against a real alternative.

**Clicking a file row goes to the file; the chevron folds it.** The design left
this unsaid and the obvious reading — click folds, like a directory — turned out
to contradict the checklist standing beside it, where clicking a file *selects*
it and only directories fold. A result file is a destination first and a
container second, so the row navigates and the chevron became a target as well
as a drawing. It is the one place the two trees' chevrons differ, and the
comment beside it says why.

**The showing rail panel must inherit its visibility, not declare it.** Setting
`visibility: visible` on the active panel overrides a hidden *ancestor*, and this
rail sits inside the Files view, which is hidden the same way while the reviewer
is on Conversations or Overview. The result was an invisible but fully
hit-testable file tree lying over the Conversations view, eating clicks. Only
`npm run test:e2e` caught it — jsdom does no hit-testing — which is the argument
CLAUDE.md already makes for that suite, now with a scar to point at.

**A zero-length match is dropped, not just stepped over.** The design only
required that `a*` terminate. Terminating is not enough: every position in every
line matches it, so the panel would report thousands of results whose highlight
is zero pixels wide. They are discarded, and the count is honest as a result.

`SearchPanel` kept its own name rather than being renamed to something like
`FileJump`. It is reachable only from `Mod+K` now and its doc comment says so; a
rename would have been a larger diff than the change deserved.
