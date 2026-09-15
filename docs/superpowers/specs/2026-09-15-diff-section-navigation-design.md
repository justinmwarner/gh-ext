# Diff Section Navigation — Design

**Date:** 2026-09-15
**Status:** Implemented
**Register:** product

## Goal

Make the changed sections of a diff findable without reading the whole column.
A reviewer on a long file should be able to see that more changes exist below,
see roughly where they are, and step to them with a control rather than a
shortcut they have to already know about.

Two surfaces, one derived number underneath both: a counter with arrows in each
file's sticky header, and a pill at the foot of the scrollport when the current
file still has changes below the fold.

**A third was built and removed.** A rail of ticks beside the diff, mapping
every section in the review, shipped in the first implementation and was taken
out on the reviewer's own verdict: not useful. The reasoning that argued for it
is kept below, because it was a reasonable argument and the next person to
propose a minimap should be able to read why this one did not survive contact
with a real review.

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
two readers of it. No new key bindings, no second notion of "next", no change
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

Ask the DOM instead.

**The first design hit-tested for it, and that was wrong — corrected during
implementation.** It read:

```
document.elementFromPoint(x, y)          -> the <diffs-container> host
  host.shadowRoot.elementFromPoint(x, y) -> the row under that point
```

Measured in Chrome against the production build, called from the animation
frame after a scroll event, `elementFromPoint` resolves the virtualizer's
content wrapper — `DIV < DIV.diff-view` — and not a card at all, because Pierre
has recycled the old rows out and not yet put the new ones in. The identical
call once the page is at rest resolves the card every time. So it passed every
check made by hand and failed in the only frame the page actually runs it:
silently, with the coarse fallback covering for it, leaving the counter on
"Change 1 of 2" for the whole length of every file.

What ships instead asks the column what it already knows. It holds every
mounted card header in a map and already computes which file is topmost:

```
headers.get(topmost)                     -> the card header
  .closest('diffs-container').shadowRoot -> the rows it drew
  the last [data-line] starting at or above y
  stopAtLine(stops, path, line)          -> the index
```

Nothing is asked of the compositor, so nothing depends on what the virtualizer
is doing this instant. The scan is over the rows currently mounted — tens of
them, because of virtualization — and it rounds *backwards*: the section being
read is the one above the fold, not the one below it. That matters, because the
~36px hunk separator sits directly under the pinned header, and rounding
forward through it would call a section read before the reviewer had seen it
and under-report what is left below.

`data-line` is an attribute observed in Pierre's source rather than a documented
API. That is the same bet `FULL_WIDTH_RICH_BODY` makes in `ui/DiffColumn.tsx`,
and it is taken here on the same terms: it must degrade rather than break.

### 1.2 The fallback, and its direction

When the scan finds no `[data-line]` — a rendered Markdown card, an image, a
table, a card momentarily unmounted, or a future Pierre that renamed the
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

Two components subscribe. Nothing else moves. `ShortcutTargetsProvider` is the
existing instance of this pattern in this codebase, and for this reason.

**The reading happens inside the existing `reaching` guard, not beside it.**
This was got wrong first, on the reasoning that the guard is about *reporting*
which file the reviewer is on, while the cursor is only a position to draw. Two
things are wrong with that.

It breaks the journey. `reachTo` is a measure-and-correct loop whose own comment
is explicit that a reading taken mid-flight is either the journey or an error
already answered, and that folding either in counts it twice. Taking the cursor
reading on the same frames adds synchronous layout to that loop — a rect per
mounted card, plus a scan of the rows — and measured against the production
build that is enough to stop a long jump ever landing. `reaching` then never
returns to zero and the tree stops following the diff for the rest of the
session. `the tree follows a hand scroll again after a jump has landed` is the
test that exists for exactly that, and it caught it: green alone, red as soon as
a real jump ran before it.

And it buys nothing, which is the part worth remembering. `landOn` publishes the
destination the moment it is asked for, so the counter already names where the
reviewer is going for the whole length of the scroll. All the guard suppresses
is the re-reading of cards being passed over.

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

Past the last section of the file it goes quiet, and the file tree carries the
cross-file question from there.

### 2.3 The rail, and why it is not here

Built, shipped, used, removed. It drew one tick per changed section down the
right-hand edge — the whole review, index-proportional, the current file tinted,
clickable, one tab stop with a roving `tabindex`.

The verdict on it was that it was not useful, and that is the right kind of
reason. It answered "where are the changes in this review" — a question the file
tree already answers by file, and one a reviewer working top to bottom does not
really ask. What they ask is "is this file finished", and the counter and the
pill answer that between them, on the card, where the question is.

It cost a column of permanent chrome down the side of the diff to say something
that was mostly already on screen. "Chrome recedes so the diff is the loudest
thing on screen" is the principle it lost to.

Removing it took `bucket()` out of `lib/review/hunkNav.ts` and the `goTo` verb
out of the navigation context; nothing else depended on it. The layout went back
to what shipped before the feature — `.diff-view` is again a direct flex child
of `.column` — which is the arrangement `CodeView` has always virtualized
against.

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
counter must not claim a section the reviewer cannot get to. All four reasons a
card collapses
— viewed, generated, whitespace-emptied, manually folded — mean "not reading
this now", so excluding them is also the answer a reviewer expects.

**This is a prediction, not an observation.** Confirm it in the browser before
claiming it is fixed.

---

## Module layout

| File | | |
|---|---|---|
| `lib/review/hunkNav.ts` | new | Pure. Owns the `HunkStop` type, `stopAtLine`, `fileRun`, `positionInFile`, `remainingInFile`. |
| `lib/review/hunkNav.test.ts` | new | Node. Every resolver. |
| `ui/diffItems.ts` | edit | `hunkStops()` takes the collapsed set. `HunkStop` moves to `lib/` and is re-exported, so the dependency points the right way. |
| `ui/hunkPosition.ts` | new | Reads the rows a card drew, and the fallback. The only DOM-touching piece. |
| `ui/hunkCursor.ts` | new | Ref-backed store, context, `useSyncExternalStore` hook. |
| `ui/HunkSteps.tsx` | new | Counter and arrows. Mounted inside `FileCard`, self-subscribing. |
| `ui/MoreBelow.tsx` | new | The pill. |
| `ui/DiffColumn.tsx` | edit | Publish the cursor; filter `stops`; land a jump accurately. |
| `ui/FileCard.tsx` | edit | Mount `HunkSteps` on the head row. |
| `entrypoints/review/style.css` | edit | `position: relative` on `.column`, plus `.hunk-steps` and `.more-below`. |

`HunkSteps` subscribes to the store itself rather than taking the cursor as a
prop. `renderHeader` is memoized and `SlotPortals` watches its identity — a new
prop threaded through it would rebuild every mounted card, thread and composer
on every hunk boundary, which is the cost this design exists to avoid.

### Colour

**No new tokens.** `--fg-muted` and `--fg-default` for the counter,
`--border-default` for a pressed arrow, `--canvas-overlay` on
`--border-default` for the pill.

So `ui/tokens.css` and `lib/theme/tokens.ts` are untouched, `npm run palettes`
does not need re-running, and `ui/tokens.test.tsx` passes unchanged. Any literal
hex introduced while building this is a mistake, and that test says so.

### Layout

`.column` is a flex column whose `.diff-view` child is the scrollport Pierre
measures and binds its scroll listener to, and it is again a direct flex child
of `.column` — the arrangement that shipped before this feature. The only
addition is an anchor for the pill:

```css
.column    { position: relative; }
.more-below { position: absolute; bottom: 12px; }
```

The first implementation put a `.column-body` flex row in between, so that a
rail could sit beside the scrollport. With the rail gone that wrapper had no
job, and removing it returns the layout to the one `CodeView` has always
virtualized against rather than leaving a div behind to be puzzled over.

`min-height: 0` throughout is the rule `FilesView` already states: an
unconstrained host measures zero and renders nothing at all. Nothing in jsdom
can see this, because jsdom performs no layout — so it is an e2e assertion or it
is unverified.

---

## Failure modes

| | |
|---|---|
| Pierre renames or drops `data-line` | The reading finds nothing, and the fallback reports the topmost file's first stop. The counter coarsens to per-file and the pill over-reports. Nothing breaks. |
| Point lands on a header, separator, annotation or the tail | Same fallback, same direction. |
| A file's context is expanded | Stops are read from patch headers, which expansion does not change. Positions are index-based. Unaffected. |
| Whitespace recompute removes a hunk | `stops` is already built over `drawnFiles`, so the removed hunk was never a stop. |
| File list replaced (scope change, refresh) | `stops` identity changes and the cursor resets to -1, as `hunkCursor` already does. |
| Diff with 0 or 1 sections | The counter renders nothing and the pill never fires. |
| Reduced motion | Jumps are `scrollTo`, which already honours the existing settings. No new transition without a `prefers-reduced-motion` alternative. |

---

## Testing

- **`lib/review/hunkNav.test.ts`** — node. Every resolver, including the empty
  list and a file that has no sections at all.
- **jsdom** — `HunkSteps` and `MoreBelow` against a stubbed store: what renders
  at 0, 1 and many sections, what the arrows call, and that no card with one
  section grows a counter.
- **`ui/DiffColumn.test.tsx`** — `stops` excludes collapsed files; the store
  publishes on `goToHunk`.
- **e2e, and honestly so.** The scroll probe cannot be meaningfully unit tested:
  jsdom performs no layout and does not implement `ShadowRoot.elementFromPoint`.
  `e2e/review.spec.ts` asserts that every multi-section file says so on its
  header, that the counter tracks a real scroll under the pinned header, that
  the pill appears and then goes quiet past the file's last section, and that
  `J` no longer steps into a viewed file.

Per `CLAUDE.md`, the e2e suite against `npx wxt build` output is the only honest
check for the built CSS, so the layout change is not verified until it runs
there.

---

## Rejected alternatives

**A pixel-accurate minimap.** The virtualizer keeps its offsets private and its
model of our headers is documented as wrong, so this means re-deriving the
column's entire scroll geometry ourselves — and re-deriving it again on every
Pierre upgrade. Principle 3 is "speed is the budget" and the anti-reference is a
second GitHub with everything in it.

The cheap version of it — the rail — *was* built, and then removed as not
useful. That is the stronger argument against the expensive version: the
question a minimap answers turned out not to be one reviewers were asking here.

**Proportional tick heights**, and **a per-file rail**. Both were weighed while
designing the rail. Moot now, and recorded only so that the next proposal does
not re-tread them.

**The pill whenever anything is below.** Never under-warns, but is lit for
almost the whole review and therefore stops being read.

**A settings toggle for the rail.** The options page is already long, and a
feature that has to hide behind a preference to be tolerable has not earned its
place: either it is quiet enough to ship on, or it should not ship. It was not,
so it did not — which is the rule working rather than failing.

---

## Not doing

- Any new key binding. `J` and `K` already exist and the help overlay lists them.
- A minimap, a rail, or any other permanent chrome down the side of the diff.
- A second, per-file notion of "next", diverging from what `J` means.
- Cross-file indicators. The file tree owns that question.

---

## Open questions — answered in the browser

All three were settled against `npx wxt build` output in Chrome. Two changed
the design, and both were failures that a passing unit suite could not see.

1. **Does `J` land on nothing in a collapsed file?** Yes, and the fix holds.
   Filtering `stops` by the collapsed set is asserted by
   *"a file marked viewed is no longer somewhere J can send you"*.
2. **Does `elementFromPoint` return a row under `stickyHeaders`?** No — and the
   sticky header was not the reason. It resolves the virtualizer's content
   wrapper whenever it is called in the frame after a scroll, so the whole
   hit-testing approach was replaced. See §1.1. The header inset survives and is
   measured rather than assumed: a card carrying a mode switcher covers 70px of
   the scrollport against 38px for one that does not.
3. **Does `.column-body` disturb the scrollport?** No. The pre-existing
   virtualization and scroll tests — *"scrolling the diff column walks the tree
   selection forward"* and *"every file in the column can be reached from the
   tree"* — pass unchanged with it in place.

### One thing found that the design did not anticipate

`CodeView.scrollTo({type: 'line'})` **frequently does not move the column at
all.** It resolves a line through the same item offsets that `reachTo` already
documents as wrong about our card headers. Pressing `J` advanced the cursor and
left the page where it was.

That was pre-existing and invisible, because nothing displayed the cursor.
Deriving the cursor from the scroll made it visible immediately and made it
worse: the jump set the target, the scroll that never happened reported the old
position back, and `J` oscillated between two sections.

`landOn` now does what `reachTo` does one level up — ask, measure the row's real
position, fold the residual back through the target's `offset`, and stop when
it is within a pixel or after `REACH_FRAMES`. A `landing` counter keeps the
scroll reading quiet while a jump is travelling, the same guard `reaching`
provides for file jumps. Measured after the fix, eight presses of `J` walk
monotonically down the column instead of oscillating between two sections.
