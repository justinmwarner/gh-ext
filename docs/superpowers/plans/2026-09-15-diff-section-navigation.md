# Diff Section Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deviation from the usual plan format, stated plainly:** this plan was written
> for inline execution in the same session that designed it, so steps lock file
> paths, exact type signatures and test names rather than duplicating every
> implementation body. The type signatures in Task 1 are the contract every later
> task is held to.

**Goal:** Make the changed sections of a diff visible and steppable — a counter in each file's sticky header, a pill when the current file has changes below the fold, and a rail of ticks mapping every section in the review.

**Architecture:** One derived number (`currentStop`, the section at the top of the viewport) written by both `J`/`K` and by scroll, published through a ref-backed store so the column does not re-render on every hunk boundary. Three components subscribe. All the navigation already exists in `goToHunk`.

**Tech Stack:** WXT, React 19, `@pierre/diffs`, vitest (node for `lib/`, jsdom for `ui/`), Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-09-15-diff-section-navigation-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/review/hunkNav.ts` | Pure resolvers over a stop list. Owns the `HunkStop` type. No DOM. |
| `lib/review/hunkNav.test.ts` | Node tests for the above. |
| `ui/diffItems.ts` | `hunkStops()` gains a collapsed filter; re-exports `HunkStop` from `lib/`. |
| `ui/hunkCursor.ts` | Ref-backed store + context + `useSyncExternalStore` hook. The only mutable state. |
| `ui/hunkPosition.ts` | The two shadow-DOM hit-tests and the fallback. The only DOM-touching piece. |
| `ui/HunkSteps.tsx` | Counter and arrows, mounted in `FileCard`. Self-subscribing. |
| `ui/MoreBelow.tsx` | The pill. Self-subscribing. |
| `ui/HunkRail.tsx` | The rail. Self-subscribing. |
| `ui/DiffColumn.tsx` | Filter `stops`; own the store; `.column-body` wrapper; publish on scroll and on `goToHunk`. |
| `ui/FileCard.tsx` | Mount `HunkSteps` on the head row. |
| `entrypoints/review/style.css` | `.column-body`, `.hunk-rail`, `.hunk-steps`, `.more-below`. |

---

## Task 1: The pure resolvers

**Files:**
- Create: `lib/review/hunkNav.ts`
- Test: `lib/review/hunkNav.test.ts`

The contract every later task is held to:

```ts
export interface HunkStop {
  path: string;
  side: 'additions' | 'deletions';
  line: number;
}

/** Where this file's stops begin, and how many. `count: 0` when absent. */
export interface FileRun { start: number; count: number }

export function fileRun(stops: readonly HunkStop[], path: string | null): FileRun;

/** The last stop in `path` at or before `line`, as a global index. -1 if none. */
export function stopAtLine(
  stops: readonly HunkStop[],
  path: string,
  line: number,
): number;

/** One-based position of a global index within its own file. Null if out of range. */
export function positionInFile(
  stops: readonly HunkStop[],
  index: number,
): { n: number; of: number } | null;

/** Stops in `path` strictly after `line`. Never negative. */
export function remainingInFile(
  stops: readonly HunkStop[],
  path: string,
  line: number,
): number;

/** Group `count` stops into at most `slots` buckets, each `[start, end)`. */
export function bucket(
  count: number,
  slots: number,
): readonly { start: number; end: number }[];
```

- [ ] **Step 1: Write the failing tests** in `lib/review/hunkNav.test.ts` — `fileRun` for present/absent/single-file; `stopAtLine` exact hit, between two hunks, before the first, unknown path; `positionInFile` first/middle/last and out of range; `remainingInFile` including zero past the last; `bucket` at `count <= slots` (identity), `count > slots` (even split, remainder distributed to the front), `slots <= 0`, `count === 0`.
- [ ] **Step 2: Run `npx vitest run --project lib hunkNav`** — expect FAIL, module not found.
- [ ] **Step 3: Implement `lib/review/hunkNav.ts`.** Stops are in reading order and grouped by file, so `fileRun` is a scan for the first and last index with that path. `stopAtLine` scans that run. No DOM, no imports outside `lib/`.
- [ ] **Step 4: Run `npx vitest run --project lib hunkNav`** — expect PASS.
- [ ] **Step 5: Commit** `lib/review/hunkNav.ts` + its test.

---

## Task 2: `hunkStops` skips collapsed files

**Files:**
- Modify: `ui/diffItems.ts` (the `HunkStop` interface and `hunkStops`)
- Test: `ui/diffItems.test.tsx` (existing `describe('hunkStops')` at :293)

`HunkStop` moves to `lib/review/hunkNav.ts` and `diffItems.ts` re-exports it, so the dependency points from `ui/` into `lib/` and never the other way.

New signature, with the argument optional so every existing caller and test is unchanged:

```ts
export function hunkStops(
  files: readonly ReviewFile[],
  collapsed: ReadonlySet<string> = new Set(),
): HunkStop[];
```

- [ ] **Step 1: Write the failing test** — a two-file list where one path is in `collapsed` yields only the other file's stops; an empty set yields both.
- [ ] **Step 2: Run `npx vitest run --project ui diffItems`** — expect FAIL.
- [ ] **Step 3: Implement** — `continue` on a collapsed path; re-export the type.
- [ ] **Step 4: Run `npx vitest run --project ui diffItems`** — expect PASS, existing cases still green.
- [ ] **Step 5: Commit.**

---

## Task 3: The cursor store

**Files:**
- Create: `ui/hunkCursor.ts`
- Test: `ui/hunkCursor.test.tsx`

```ts
export interface HunkCursorState {
  stops: readonly HunkStop[];
  /** Global index of the section at the top of the viewport. -1 when unknown. */
  index: number;
  /** The file the reviewer is on, for the pill and the rail's tint. */
  path: string | null;
  /** Stops of `path` below the fold. Drives the pill. */
  below: number;
}

export interface HunkCursorStore {
  subscribe(listener: () => void): () => void;
  get(): HunkCursorState;
  set(next: Partial<HunkCursorState>): void;
}

export function createHunkCursorStore(): HunkCursorStore;

/**
 * One context for the whole feature, carrying the state and both verbs.
 *
 * A second provider for the verbs would mean `DiffColumn` nesting two, and the
 * three consumers each reaching for both. `step` is `goToHunk`; `goTo` is the
 * rail landing on an absolute index.
 */
export interface HunkNav {
  store: HunkCursorStore;
  step(direction: 1 | -1): void;
  goTo(index: number): void;
}

export const HunkNavContext: React.Context<HunkNav | null>;
/** Subscribes. Re-renders the caller only when a field it reads changes. */
export function useHunkCursor(): HunkCursorState;
/** Does not subscribe. The verbs are stable for the column's lifetime. */
export function useHunkNav(): HunkNav | null;
```

`set` must be a no-op when nothing changed — a scroll fires at frame rate and most frames are inside the same section. Equality is field-by-field on the four fields, with `stops` compared by identity.

- [ ] **Step 1: Write the failing test** — subscribe/notify; `set` with identical values notifies nobody; unsubscribe stops delivery; `useHunkCursor` re-renders only on a real change (count renders).
- [ ] **Step 2: Run `npx vitest run --project ui hunkCursor`** — expect FAIL.
- [ ] **Step 3: Implement** with `useSyncExternalStore`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit.**

---

## Task 4: The scroll probe

**Files:**
- Create: `ui/hunkPosition.ts`
- Test: `ui/hunkPosition.test.tsx`

```ts
/** The `[data-line]` under this viewport point, with the file it belongs to. */
export interface ProbeHit { path: string; line: number }

export function probeLine(x: number, y: number): ProbeHit | null;

/** Everything the store needs, resolved from the scrollport's two edges. */
export function readCursor(
  scroller: HTMLElement,
  stops: readonly HunkStop[],
  topmost: string | null,
  /** Sticky headers cover the top edge; probe below them. Measured by the caller. */
  headerInset: number,
): { index: number; path: string | null; below: number };
```

`probeLine` is `document.elementFromPoint` → the `<diffs-container>` host → `host.shadowRoot.elementFromPoint` → `closest('[data-line]')`, with the path read from the host's own `[data-file-card]` child. Every step returns null rather than throwing.

`readCursor` falls back to `fileRun(stops, topmost).start` when the top probe misses, and — critically — **falls back to `remainingInFile` counted from the last stop it is sure about**, so a failed bottom probe over-reports rather than under-reports. It must never return `below: 0` on a probe failure when the file has any stop after the resolved index.

- [ ] **Step 1: Write the failing test** — jsdom cannot lay out, so assert the *fallback and null paths*: no element at the point, an element with no `[data-line]` ancestor, a host with no shadow root, and that a bottom-probe failure yields a non-zero `below` when stops remain. Stub `document.elementFromPoint`.
- [ ] **Step 2: Run `npx vitest run --project ui hunkPosition`** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit.**

---

## Task 5: Wire the column

**Files:**
- Modify: `ui/DiffColumn.tsx`
- Modify: `entrypoints/review/style.css`
- Test: `ui/DiffColumn.test.tsx`

- [ ] **Step 1:** `stops` becomes `useMemo(() => hunkStops(drawnFiles, collapsed), [drawnFiles, collapsed])`.
- [ ] **Step 2:** Create the store with `useRef(createHunkCursorStore())`, publish `stops` into it in an effect, and wrap the returned JSX in `<HunkCursorContext.Provider>`.
- [ ] **Step 3:** In `handleScroll`, after the existing `reaching`/`reported` guards, call `readCursor` and `store.set(...)`. Throttle to one `requestAnimationFrame` — hold a frame id in a ref and skip while one is pending. **The existing early `return` when `reaching.current > 0` must not skip the cursor update**, or the counter freezes through every keyboard jump; restructure so the cursor read happens before that guard and only the `onScrollTo` report is guarded.
- [ ] **Step 4:** In `goToHunk`, `store.set({ index: next })` alongside the existing `hunkCursor.current = next`.
- [ ] **Step 5:** Add the `.column-body` wrapper around `<CodeView>` and mount `<HunkRail />` beside it. CSS per the spec's Layout section.
- [ ] **Step 6:** Tests — `stops` excludes a collapsed file; `goToHunk` publishes an index.
- [ ] **Step 7: Run `npm test`, then commit.**

---

## Task 6: The counter

**Files:**
- Create: `ui/HunkSteps.tsx`
- Modify: `ui/FileCard.tsx`
- Test: `ui/HunkSteps.test.tsx`

Props are `{ path: string }` only — it reads the rest from the store, because `renderHeader` is memoized and `SlotPortals` watches its identity.

Renders nothing when `fileRun(stops, path).count < 2`. Buttons call `onStep(1 | -1)` obtained from context (Task 5 exposes `goToHunk` through the store's context object or a sibling context — use the single `HunkNavContext` from Task 3).

- [ ] **Step 1: Write the failing test** — nothing at 0 and 1 sections; `Change 3 of 12` at index 2 of a 12-stop file; the buttons call `step` with `1` and `-1`; `title` mentions `J` and `K`; height contributed is a single row.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement. Step 4: Run** — expect PASS.
- [ ] **Step 5:** Mount in `FileCard`'s head row, after `.file-counts`. **Step 6:** Style. **Step 7: Run `npm test`, commit.**

---

## Task 7: The pill

**Files:**
- Create: `ui/MoreBelow.tsx`
- Modify: `ui/DiffColumn.tsx` (mount inside `.column-body`)
- Test: `ui/MoreBelow.test.tsx`

- [ ] **Step 1: Write the failing test** — nothing when `below === 0`; `3 more changes in this file` at 3; singular `1 more change in this file` at 1; click calls `step(1)`; `role="status"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement. Step 4: Run** — PASS.
- [ ] **Step 5:** Style — pinned to the foot of `.column-body`, `--canvas-overlay` on `--border-default`. **Step 6: Run `npm test`, commit.**

---

## Task 8: The rail — built, then removed

Built as designed: `ui/HunkRail.tsx` plus its tests, `bucket()` in
`lib/review/hunkNav.ts`, the `goTo` verb on the navigation context, and a
`.column-body` flex row so it could sit beside the scrollport.

**Then removed on the reviewer's verdict: not useful.** Everything above came
back out, and the layout returned to `.diff-view` as a direct flex child of
`.column` — the arrangement that shipped before this feature. The two e2e tests
that had used the rail's marker as their observable were rewritten against the
counter, which is what a reviewer actually reads.

See the spec's §2.3 for why it lost, and Rejected alternatives for why that
verdict is also the strongest argument against the pixel minimap.

## Task 9: Verify in the real build

**Files:**
- Modify: `e2e/review.spec.ts`

- [ ] **Step 1:** Add a many-hunk fixture file to the mocked payload.
- [ ] **Step 2:** Assertions — tick count matches hunk count; the counter tracks a real scroll; the pill appears then goes quiet past the file's last section; a tick click lands on the right line; `J` does not step into a viewed file; the diff still scrolls and virtualizes with `.column-body` in place.
- [ ] **Step 3: Run `npm run test:e2e`.**
- [ ] **Step 4:** Answer the spec's three open questions in the doc — especially whether `elementFromPoint` returns a row under `stickyHeaders`, which decides `headerInset`.
- [ ] **Step 5: Commit.**

---

## Task 10: Build for local testing

- [ ] **Step 1: Run `npx wxt build`.**
- [ ] **Step 2:** Confirm `.output/chrome-mv3` exists. **Never `.output/store`** — it omits the manifest `key` on purpose.
- [ ] **Step 3:** Hand over the load-unpacked instructions and what to look at.
