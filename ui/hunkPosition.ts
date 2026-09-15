/**
 * Which changed section the reviewer is looking at, measured from the DOM.
 *
 * The viewer cannot answer this. `CodeView` keeps its item offsets private,
 * and — see `reach` in `DiffColumn.tsx` and the numbers in
 * `lib/review/columnTail.ts` — the model behind them is permanently wrong
 * about our card headers: it sizes every one from a 44px metric and never
 * measures one, so its idea of where an item begins is short by the
 * accumulated shortfall of every header above it. Asking it where a hunk is
 * would inherit that error.
 *
 * **No hit-testing, and that is the second design rather than the first.**
 * `document.elementFromPoint` is the obvious way to find the card under a
 * point, and it does not survive contact with the virtualizer. Measured in
 * Chrome against the production build: called from the animation frame after a
 * scroll event it resolves the content wrapper — `DIV < DIV.diff-view` — and
 * not a card at all, because Pierre has recycled the old rows out and not yet
 * put the new ones in. The identical call 250ms later, at rest, resolves the
 * card perfectly. So it worked every time it was checked by hand and never
 * once in the frame the page actually runs it: the coarse fallback carried
 * every reading and the counter sat on "Change 1 of 2" for the whole length of
 * every file. It looked like it worked.
 *
 * The column already knows which file is topmost, and already holds every
 * mounted card header in a map. From a header, `closest('diffs-container')`
 * reaches the card and its shadow root without asking the compositor anything.
 * When the rows are momentarily gone the scan finds nothing and the caller
 * falls back — one stale frame, rather than a permanently wrong answer.
 *
 * **`data-line` is observed, not promised.** It is an attribute found in
 * Pierre's source rather than a documented API — the same bet
 * `FULL_WIDTH_RICH_BODY` makes in `DiffColumn.tsx`, taken on the same terms: it
 * has to degrade rather than break. Every step below returns null instead of
 * throwing, and {@link readCursor} turns a null into the coarse answer the
 * column already computes for the file tree.
 *
 * **The direction of the failure is the design.** When the scan cannot see, it
 * over-reports what is below rather than under-reporting it. A hint that
 * appears once too often costs a glance. A hint that fails to appear is the
 * precise failure this feature exists to prevent.
 */

import { type HunkStop, fileRun, remainingInFile, stopAtLine } from '@/lib/review/hunkNav';

/** The file and line found at one height in the scrollport. */
export interface ProbeHit {
  path: string;
  line: number;
}

/**
 * How far below the pinned card header to look.
 *
 * The header height is measured rather than assumed — a card carrying a mode
 * switcher is 70px against 38px for one that is not — but the pixel directly
 * under it still belongs to a border or to a row scrolled half out of sight.
 */
const TOP_CLEARANCE = 6;

/** The same, from the bottom edge upward. */
const BOTTOM_CLEARANCE = 4;

/** Every mounted card header, by path. `DiffColumn` keeps exactly this map. */
export type CardHeaders = ReadonlyMap<string, HTMLElement>;

/** The shadow root drawing one file's rows, or null if it is not mounted. */
function rootFor(headers: CardHeaders, path: string): ShadowRoot | null {
  const header = headers.get(path);
  if (header === undefined || !header.isConnected) return null;
  return header.closest('diffs-container')?.shadowRoot ?? null;
}

/**
 * The line this shadow root draws at `y`: the last row starting at or above it.
 *
 * One rule for both edges, and it is the conservative one at each. At the top
 * edge "the section I am reading" is the one above me rather than the one I am
 * about to reach — the fold lands on ordinary context, or on the ~36px hunk
 * separator, far more often than on a hunk's first line, and rounding forward
 * there would call a section read before the reviewer had seen it. At the
 * bottom edge the same rule counts everything after that row as still below,
 * which is the direction that cannot hide a change.
 *
 * Falls back to the first row when `y` is above all of them, which is what the
 * top edge sees on a file whose first change is a long way down.
 *
 * A linear scan rather than a binary search: the rows are in visual order for
 * a unified diff and are *not* for a split one, where the two sides interleave,
 * so an ordered search would read from the wrong column half the time.
 * Virtualization is what makes the scan affordable — only the rows near the
 * viewport exist, which is tens of them.
 */
export function lineAt(root: ShadowRoot, y: number): number | null {
  let best: number | null = null;
  let bestTop = Number.NEGATIVE_INFINITY;
  let first: number | null = null;
  let firstTop = Number.POSITIVE_INFINITY;

  for (const row of root.querySelectorAll('[data-line]')) {
    const line = Number(row.getAttribute('data-line'));
    // A separator, a spacer, an annotation host — anything whose attribute is
    // not a line number.
    if (!Number.isFinite(line)) continue;

    const top = row.getBoundingClientRect().top;
    if (top <= y && top > bestTop) {
      best = line;
      bestTop = top;
    }
    if (top < firstTop) {
      first = line;
      firstTop = top;
    }
  }

  return best ?? first;
}

/** The file and line at one height, reached through the header map. */
export function probeLine(
  headers: CardHeaders,
  path: string | null,
  y: number,
): ProbeHit | null {
  if (path === null) return null;

  const root = rootFor(headers, path);
  if (root === null) return null;

  const line = lineAt(root, y);
  return line === null ? null : { path, line };
}

/**
 * Where one numbered row actually is, in viewport coordinates.
 *
 * What makes it possible to check whether a jump landed. `CodeView.scrollTo`
 * resolves a line through the same item offsets that are wrong about our card
 * headers, so asking it to put a line at the top of the scrollport puts it
 * somewhere near there — and sometimes, measured in Chrome, does not move the
 * column at all. `DiffColumn` folds the residual this returns back through the
 * target's `offset`, which is the technique `reachTo` already uses one level up
 * for whole cards.
 *
 * Null when the row is not drawn. Virtualization means a line far outside the
 * viewport has no element, and a correction loop has to stop rather than
 * correct towards a guess.
 */
export function rowTop(
  headers: CardHeaders,
  path: string,
  line: number,
): number | null {
  const root = rootFor(headers, path);
  if (root === null) return null;

  // Attribute selector with a numeric value needs no escaping, unlike the
  // opaque thread ids elsewhere in the column.
  const row = root.querySelector(`[data-line="${line}"]`);
  return row === null ? null : row.getBoundingClientRect().top;
}

/**
 * Which mounted card covers this height, if any.
 *
 * Over the header map rather than every `<diffs-container>` in the document:
 * only the cards near the viewport are mounted, so this is a handful of rects
 * rather than one per file in the pull request.
 */
export function cardAt(headers: CardHeaders, y: number): string | null {
  for (const [path, header] of headers) {
    if (!header.isConnected) continue;

    const host = header.closest('diffs-container');
    if (host === null) continue;

    const box = host.getBoundingClientRect();
    if (box.top <= y && box.bottom >= y) return path;
  }
  return null;
}

/** Everything the cursor store needs, resolved from the scrollport's two edges. */
export interface CursorReading {
  index: number;
  path: string | null;
  below: number;
}

export function readCursor(
  scroller: HTMLElement,
  stops: readonly HunkStop[],
  /** The column's own answer for which file is on top. */
  topmost: string | null,
  /** Height of the pinned card header, which covers the true top edge. */
  headerInset: number,
  headers: CardHeaders,
): CursorReading {
  const box = scroller.getBoundingClientRect();

  const top = probeLine(headers, topmost, box.top + headerInset + TOP_CLEARANCE);
  const path = top?.path ?? topmost;

  const run = fileRun(stops, path);
  if (run.count === 0) return { index: -1, path, below: 0 };

  // Above the file's first hunk is a real place to be — a file whose first
  // change is two hundred lines down is the file this feature is for — but it
  // is not a place worth blanking the counter for. Name the section they are
  // about to read.
  const found = top === null ? -1 : stopAtLine(stops, path as string, top.line);
  const index = found === -1 ? run.start : found;

  // Everything below the top edge: the ceiling on what the bottom edge can
  // find, and therefore the safe answer when it finds nothing.
  //
  // Counted from the line actually measured rather than from `index`, because
  // the two differ exactly where it matters — a reviewer sitting above the
  // file's first hunk is reported as being *on* it by the clamp above, and
  // counting from that would hide the first change.
  const mostBelow =
    top === null
      ? Math.max(run.count - 1, 0)
      : remainingInFile(stops, path as string, top.line);

  const bottomY = box.bottom - BOTTOM_CLEARANCE;
  const bottomPath = cardAt(headers, bottomY);

  // The fold has passed into a later file, so nothing of this one is under it.
  if (bottomPath !== null && bottomPath !== path) return { index, path, below: 0 };

  const bottom = probeLine(headers, bottomPath, bottomY);
  if (bottom === null) return { index, path, below: mostBelow };

  return {
    index,
    path,
    below: Math.min(mostBelow, remainingInFile(stops, path as string, bottom.line)),
  };
}
