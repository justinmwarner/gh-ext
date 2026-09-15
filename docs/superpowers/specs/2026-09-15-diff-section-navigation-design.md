# Diff Section Navigation — Design

**Date:** 2026-09-15
**Status:** Designed, not implemented
**Register:** product

## Goal

Make the changed sections of a diff findable without reading the whole column.
A reviewer on a long file should be able to see that more changes exist below,
see roughly where they are, and step to them with a control rather than a
shortcut they have to already know about.

Three surfaces, one derived number underneath all three: a counter with arrows
in each file's sticky header, a pill at the foot of the scrollport when the
current file still has changes below the fold, and a rail of ticks beside the
diff mapping every section in the review.

---

## Part 0: Most of this already exists, and that is the design

`hunkStops()` in `ui/diffItems.ts` flattens every hunk in the column into an
ordered list of `{path, side, line}`, read off parsed patch headers rather than
measured — so it is known before anything is on screen. `goToHunk` in
`ui/DiffColumn.tsx` steps that list, runs off the end of one file into the next,
and re-anchors the cursor whenever it has drifted away from the file the
reviewer is actually on. `J` and `K` are bound to it in `lib/keymap.ts` and the
help overlay documents both.

So the navigation is built, tested and shipped. What is missing is that
**nothing on screen knows where in that list the reviewer is**. `hunkCursor` is
a `useRef`, deliberately — the comment beside it is explicit that moving it must
not re-render the column — and a value nothing can subscribe to cannot draw a
counter, a marker or a hint.

This is therefore not a navigation feature. It is one new derived number and
three readers of it. No new key bindings, no second notion of "next", no change
to what `J` means.

That framing is load-bearing for Principle 2. "Do less, completely" is the
argument against building a parallel navigation model beside the working one,
and against the pixel minimap in Rejected alternatives.

---

## Part 1: `currentStop`, and the only hard part

`currentStop` is an index into `stops`, meaning **the changed section at the top
of the viewport**.

It has two writers. `J` and `K` set it directly. Scrolling derives it.

The second writer is not optional. A number written only by the keyboard freezes
at whatever `J` last said while the reviewer scrolls somewhere else, and every
surface reading it then states a position the reviewer is not in — quietly, with
nothing on screen to contradict it. That is Principle 4's failure exactly, and
it is worse here than a missing feature would be, because the whole purpose of
the counter is to be trusted about what is left.

### 1.1 Deriving it from scroll

`CodeView` virtualizes per line and keeps its item offsets private. Worse, the
column already documents — see `reach` in `ui/DiffColumn.tsx`, and
`lib/review/columnTail.ts` — that Pierre's offset model is *permanently wrong*
about our card headers: it sizes every one from a 44px metric and never measures
one. So the viewer cannot be asked where a hunk is.

Ask the DOM instead, at two points — the top edge of the scrollport and the
bottom:

```
document.elementFromPoint(x, y)          -> the <diffs-container> host
  host.shadowRoot.elementFromPoint(x, y) -> the row under that point
  row.closest('[data-line]')             -> the line number
  stopAtLine(stops, path, line)          -> the index
```

Two hit-tests per animation frame. No traversal of the row list, no arithmetic
over line counts, and nothing that grows with the size of the pull request.
`elementFromPoint` retargets to the shadow host, so the path comes from the
host's own `[data-file-card]` child — the same route `ui/pierreDom.fixture.ts`
already takes in reverse.

`data-line` is an attribute observed in Pierre's source rather than a documented
API. That is the same bet `FULL_WIDTH_RICH_BODY` makes in `ui/DiffColumn.tsx`,
and it is taken here on the same terms: it must degrade rather than break.

### 1.2 The fallback, and its direction

When the probe finds no `[data-line]` — the point landed on a card header, a
hunk separator, an annotation, the tail, or a future Pierre renamed the
attribute — fall back to **the first stop of the topmost file**, which
`topmostFile(cardTops())` already computes on every scroll.

**The fallback always errs toward "there is more below."** A hint that appears
once too often costs a glance. A hint that fails to appear is the precise
failure this feature exists to prevent. Where the two roundings disagree, take
the noisy one.

### 1.3 Publishing it without re-rendering the column

A ref-backed store with subscribers, read through `useSyncExternalStore`.

`handleScroll` today re-renders the shell only when the *file* under the top of
the viewport changes, and the comment there says why: scroll fires at frame rate
and the reducer would absorb the repeats only after React had rendered to find
out. Hunk boundaries are crossed far more often than file boundaries, so
`useState` here would reintroduce exactly the cost that guard exists to avoid —
several column renders a second through a scroll, on a page whose entire
proposition is speed.

Three components subscribe. Nothing else moves. `ShortcutTargetsProvider` is the
existing instance of this pattern in this codebase, and for this reason.

---

## Part 2: The three surfaces

### 2.1 Counter and arrows, in the sticky file header

`Change 3 of 12` with a previous and a next button, on `FileCard`'s head row
beside the added and removed counts. `stickyHeaders` is on, so it stays pinned
for the whole length of a long file — which is the only place in the layout that
is both always visible and unambiguously about one file.

**Rendered only when the file has two or more reachable sections.** A "1 of 1"
on every single-hunk card is chrome on the majority of cards in most pull
requests, and "quiet" forbids it.

**Height is a hard constraint, not a preference.** `CodeView` sizes an item from
one global header metric and never measures this element, so anything that adds
a row is scroll range the viewer does not know it owes. It goes on the existing
head row; it does not add a second one. `lib/review/columnTail.ts` has the
numbers.

**The count is per file; the buttons are global.** "47 of 312" tells a reviewer
nothing, so the count is scoped to the file the header belongs to. The buttons
step the same global list `J` does, so pressing next on the last section of a
file walks into the next file — which is what `J` does today and what a reviewer
reading top to bottom wants. The buttons carry `title="Next change (J)"`: the
control teaches the shortcut rather than replacing it.

### 2.2 "3 more changes in this file" — the pill

A small pill at the foot of the scrollport. Clicking it is `goToHunk(1)`.

**Shown only when the current file has sections below the fold** — not whenever
anything anywhere below is unread. The distinction is the feature. A pill lit
for the entire review is a permanent badge that a reviewer stops seeing by the
third file; a pill that speaks at the moment they are about to wrongly conclude
a file is finished is the indicator that was asked for. The dangerous moment is
specifically the long file whose last change sits a screen below where the
changes appeared to stop.

Past the last section of the file it goes quiet, and the rail and the file tree
carry the cross-file question from there.

### 2.3 The rail

A strip roughly 12px wide to the right of the diff, inside the column and
outside the scrollport. One tick per section across the **whole diff** in
reading order, hairline separators at file boundaries, the current file's run
tinted and the current tick solid. Click a tick to jump. Hover for `path:line`.

**Whole diff rather than current file.** The column is one scroll region across
every file; a rail that resets at each file boundary fights the thing it sits
beside. Mapping all of it answers "how much of this review is left", and the
current file arrives as a highlighted contiguous run inside that — so the
per-file map is had anyway, without a second mode.

**Index-proportional, not pixel-proportional.** Every section occupies the same
height on the rail regardless of how many lines it spans. For "do not let me
miss one" this is not an approximation of a pixel minimap, it is better than
one: a four-line change is exactly as findable as a four-hundred-line change,
which is the opposite of what proportional height would do. It also means the
rail depends on no geometry the virtualizer owns, so it cannot drift.

**Compression.** Each stop gets `max(2px, available / stops)`. At a typical
800px that is about 130 sections before the floor binds. Past the floor, stops
bucket: a bucket draws one tick at the density of its contents and jumps to its
first stop.

**Uniform neutral ticks — no red and green.** The rail answers *where*, not
*what*. Hue-coded ticks would be meaning carried by colour alone, which
PRODUCT.md's "never colour alone" rules out and which matters more here than
elsewhere, since this is a diff tool.

**One tab stop, roving tabindex.** Three hundred tab stops between the diff and
whatever follows it would be a keyboard regression dressed as keyboard support.

---

## Part 3: The bug this sits on top of

`stops` is built from `drawnFiles`, and `drawnFiles` does not exclude collapsed
cards. Marking a file viewed collapses it — see the `byRule` block in
`ui/DiffColumn.tsx` — and a collapsed item renders at its header region with no
rows at all.

So today `J` steps into files the reviewer has already finished and issues a
`scrollTo({type: 'line'})` against a card that has no such line to reach. The
prediction from the code is that it lands on nothing.

Filtering `stops` by the collapsed set fixes it, and is required by this feature
regardless: a counter must count what the reviewer can actually reach, and a
rail must not offer a tick that goes nowhere. All four reasons a card collapses
— viewed, generated, whitespace-emptied, manually folded — mean "not reading
this now", so excluding them is also the answer a reviewer expects.

**This is a prediction, not an observation.** Confirm it in the browser before
claiming it is fixed.

---

## Module layout

| File | | |
|---|---|---|
| `lib/review/hunkNav.ts` | new | Pure. Owns the `HunkStop` type, `stopAtLine`, `fileRun`, `positionInFile`, `remainingInFile`, `bucket`. |
| `lib/review/hunkNav.test.ts` | new | Node. Resolvers and the bucketing boundary. |
| `ui/diffItems.ts` | edit | `hunkStops()` takes the collapsed set. `HunkStop` moves to `lib/` and is re-exported, so the dependency points the right way. |
| `ui/hunkPosition.ts` | new | The two hit-tests and the fallback. The only DOM-touching piece. |
| `ui/hunkCursor.ts` | new | Ref-backed store, context, `useSyncExternalStore` hook. |
| `ui/HunkSteps.tsx` | new | Counter and arrows. Mounted inside `FileCard`, self-subscribing. |
| `ui/MoreBelow.tsx` | new | The pill. |
| `ui/HunkRail.tsx` | new | The rail. |
| `ui/DiffColumn.tsx` | edit | A `.column-body` flex row around `CodeView` and the rail; publish the cursor; filter `stops`. |
| `ui/FileCard.tsx` | edit | Mount `HunkSteps` on the head row. |
| `entrypoints/review/style.css` | edit | `.column-body`, `.hunk-rail`, `.hunk-steps`, `.more-below`. |

`HunkSteps` subscribes to the store itself rather than taking the cursor as a
prop. `renderHeader` is memoized and `SlotPortals` watches its identity — a new
prop threaded through it would rebuild every mounted card, thread and composer
on every hunk boundary, which is the cost this design exists to avoid.

### Colour

**No new tokens.** `--border-default` for a tick, `--accent-emphasis` for the
current one, `--accent-subtle-bg` for the current file's run, `--border-muted`
for separators, `--canvas-overlay` with `--border-default` for the pill.

So `ui/tokens.css` and `lib/theme/tokens.ts` are untouched, `npm run palettes`
does not need re-running, and `ui/tokens.test.tsx` passes unchanged. Any literal
hex introduced while building this is a mistake, and that test says so.

### Layout

`.column` is a flex column whose `.diff-view` child is the scrollport Pierre
measures and binds its scroll listener to. The rail goes beside it, which means
a new row wrapper:

```css
.column-body { display: flex; flex: 1 1 auto; min-height: 0; }
.diff-view   { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; }
.hunk-rail   { flex: none; }
```

`min-height: 0` throughout is the rule `FilesView` already states: an
unconstrained host measures zero and renders nothing at all. Nothing in jsdom
can see this, because jsdom performs no layout — so it is an e2e assertion or it
is unverified.

---

## Failure modes

| | |
|---|---|
| Pierre renames or drops `data-line` | Probe returns nothing, fallback reports the topmost file's first stop. Counter coarsens to per-file, pill over-reports, rail still correct. Nothing breaks. |
| Point lands on a header, separator, annotation or the tail | Same fallback, same direction. |
| A file's context is expanded | Stops are read from patch headers, which expansion does not change. Positions are index-based. Unaffected. |
| Whitespace recompute removes a hunk | `stops` is already built over `drawnFiles`, so the removed hunk was never a stop. |
| File list replaced (scope change, refresh) | `stops` identity changes and the cursor resets to -1, as `hunkCursor` already does. |
| Diff with 0 or 1 sections | Rail and counter render nothing; the pill never fires. |
| Reduced motion | Jumps are `scrollTo`, which already honours the existing settings. No new transition without a `prefers-reduced-motion` alternative. |

---

## Testing

- **`lib/review/hunkNav.test.ts`** — node. Every resolver, plus the bucketing
  boundary in both directions and the empty list.
- **jsdom** — `HunkSteps`, `MoreBelow` and `HunkRail` against a stubbed store:
  what renders at 0, 1 and many sections, what the arrows call, roving tabindex,
  and that no card with one section grows a counter.
- **`ui/DiffColumn.test.tsx`** — `stops` excludes collapsed files; the store
  publishes on `goToHunk`.
- **e2e, and honestly so.** The scroll probe cannot be meaningfully unit tested:
  jsdom performs no layout and does not implement `ShadowRoot.elementFromPoint`.
  A many-hunk fixture in `e2e/review.spec.ts` asserts that the tick count
  matches the hunk count, the counter tracks a real scroll, the pill appears and
  then goes quiet past the file's last section, a tick click lands on the right
  line, `J` no longer steps into a viewed file, and `.column-body` has not
  broken Pierre's scrollport measurement.

Per `CLAUDE.md`, the e2e suite against `npx wxt build` output is the only honest
check for the built CSS, so the layout change is not verified until it runs
there.

---

## Rejected alternatives

**A pixel-accurate minimap.** The virtualizer keeps its offsets private and its
model of our headers is documented as wrong, so this means re-deriving the
column's entire scroll geometry ourselves — and re-deriving it again on every
Pierre upgrade. Principle 3 is "speed is the budget" and the anti-reference is a
second GitHub with everything in it. The rail delivers the question a minimap is
actually asked — where are the changes, how much is left — at a fraction of the
cost and with better behaviour on small changes.

**Proportional tick heights.** Truer to the document, worse at the job: it makes
the small changes, which are the ones people miss, the hardest to hit.

**A per-file rail.** Simpler and never needs bucketing, but it redraws on every
file boundary and duplicates what the file tree already says about cross-file
position.

**The pill whenever anything is below.** Never under-warns, but is lit for
almost the whole review and therefore stops being read.

**A settings toggle for the rail.** The options page is already long. A feature
that has to hide behind a preference to be tolerable has not earned its place:
either it is quiet enough to ship on, or it should not ship.

---

## Not doing

- Any new key binding. `J` and `K` already exist and the help overlay lists them.
- Red and green ticks.
- A second, per-file notion of "next", diverging from what `J` means.
- Cross-file indicators beyond the rail. The file tree owns that question.

---

## Open questions — verify before implementing

1. **Does `J` actually land on nothing in a collapsed file?** Strongly implied by
   `drawnFiles` and the `byRule` collapse, not yet observed. Check in the browser
   first; if it already behaves, the filter is still needed for the counter, but
   the claim in Part 3 must come out.
2. **Does `ShadowRoot.elementFromPoint` return a row under `stickyHeaders`?** A
   pinned header may be the topmost element at the top edge. If so, probe a few
   pixels below the sticky header's measured bottom rather than at the scrollport
   edge.
3. **Does `.column-body` disturb the scrollport?** Pierre measures `.diff-view`
   for virtualization. Expected to be inert, must be confirmed against
   `npx wxt build` output rather than the dev server.
