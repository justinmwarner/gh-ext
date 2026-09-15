/**
 * Moving between the changed sections of a diff, as arithmetic over one list.
 *
 * The review page already knows where every hunk is: `hunkStops` in
 * `ui/diffItems.ts` reads them off the parsed patch headers, in reading order
 * and grouped by file, and `J` has stepped that list since the keyboard
 * existed. What it has never had is a way to *say* where in the list the
 * reviewer is — the cursor is a ref, deliberately, because moving it must not
 * re-render the column.
 *
 * Two surfaces now need to say it: a counter in each file's sticky header, and
 * a pill when the current file still has changes below the fold. Both are
 * drawn from the same index into the same list, and both live here rather than
 * in the components because a disagreement between them would be a
 * disagreement about arithmetic — which is the kind a test can settle, in
 * milliseconds, under Node.
 *
 * Nothing here touches the DOM. Where the reviewer actually *is* on screen is
 * `ui/hunkPosition.ts`, which is the only part of this that has to.
 */

/**
 * One hunk's first line, on the side the hunk actually shows.
 *
 * Declared here rather than beside `hunkStops` so that `lib/` never has to
 * import from `ui/` to describe its own arguments. `ui/diffItems.ts` builds
 * these and re-exports the type, so the dependency points one way only.
 */
export interface HunkStop {
  path: string;
  side: 'additions' | 'deletions';
  line: number;
}

/** Where one file's stops begin in the flattened list, and how many it has. */
export interface FileRun {
  /**
   * The global index of this file's first stop, or -1 when it has none.
   *
   * -1 rather than 0, and it matters: this value is handed back as a cursor
   * when the scroll probe cannot resolve a line, and -1 is already what the
   * cursor means by "I do not know". Zero would name the first stop of
   * whatever file happens to be at the top of the review.
   */
  start: number;
  count: number;
}

const ABSENT: FileRun = { start: -1, count: 0 };

/**
 * A linear scan, and it stays one.
 *
 * The list is grouped by file, so a binary search over paths would be possible
 * and is not worth it: the callers run on a scroll frame against a list whose
 * length is the number of hunks in the pull request, and the scan stops at the
 * end of the run rather than at the end of the list.
 */
export function fileRun(stops: readonly HunkStop[], path: string | null): FileRun {
  if (path === null) return ABSENT;

  const start = stops.findIndex((stop) => stop.path === path);
  if (start === -1) return ABSENT;

  let count = 0;
  while (stops[start + count]?.path === path) count += 1;
  return { start, count };
}

/**
 * The section containing `line` in `path`, as a global index.
 *
 * "Containing" is the last stop at or before the line, not the nearest one.
 * The top edge of a viewport lands on ordinary context between two hunks far
 * more often than on a hunk's first line, and the section a reviewer is
 * reading is the one above them — a nearest-match would flip the counter
 * forward a section early, halfway through the one they are still in.
 *
 * -1 when the line is above the file's first hunk, which is a real position:
 * a file whose first change is two hundred lines down is exactly the file this
 * whole feature exists for.
 */
export function stopAtLine(
  stops: readonly HunkStop[],
  path: string,
  line: number,
): number {
  const { start, count } = fileRun(stops, path);
  if (count === 0) return -1;

  let found = -1;
  for (let i = start; i < start + count; i += 1) {
    const stop = stops[i];
    if (stop === undefined || stop.line > line) break;
    found = i;
  }
  return found;
}

/**
 * Where a global index sits within its own file, counted from one.
 *
 * Per file rather than per review because "47 of 312" tells a reviewer nothing
 * they can act on, while "3 of 12" tells them how much of the file they have
 * left. The buttons beside it still step the global list — see the counter.
 */
export function positionInFile(
  stops: readonly HunkStop[],
  index: number,
): { n: number; of: number } | null {
  const stop = stops[index];
  if (stop === undefined) return null;

  const { start, count } = fileRun(stops, stop.path);
  return { n: index - start + 1, of: count };
}

/** How many of this file's sections are still below `line`. Never negative. */
export function remainingInFile(
  stops: readonly HunkStop[],
  path: string,
  line: number,
): number {
  const { start, count } = fileRun(stops, path);
  if (count === 0) return 0;

  const at = stopAtLine(stops, path, line);
  // -1 means every stop in the file is still below, which is what `start - 1`
  // gives once the subtraction below runs.
  const passed = at === -1 ? 0 : at - start + 1;
  return count - passed;
}
