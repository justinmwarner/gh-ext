/**
 * Lining two lists of rows up against each other, with a ceiling.
 *
 * Every structural comparison in this directory reduces to the same problem:
 * given the old rows and the new rows, which are the same row and which are
 * not. A table has rows, a notebook has cells, and both want the answer with
 * the unchanged ones left in place rather than a wall of red beside a wall of
 * green.
 *
 * The exact answer is a longest-common-subsequence, which is quadratic. That is
 * fine for the shape of a real edit and catastrophic for the shape of a real
 * *file*: a generated CSV with a hundred thousand rows would allocate a ten
 * billion cell table before rendering anything. Two things keep it bounded.
 *
 * - **The shared prefix and suffix come off first.** Almost every edit to a
 *   large table touches a small band in the middle, so the quadratic part sees
 *   a handful of rows even when the file has tens of thousands.
 * - **What survives that is checked against a budget.** Past it, the middle is
 *   reported as "all of this went, all of that arrived" — strictly less useful,
 *   always finite, and honestly flagged so the caller can say so on screen.
 *
 * A dependency was considered and not taken. `diff` (jsdiff) is already in the
 * tree as a dependency of `@pierre/diffs`, so it would cost no new bytes — but
 * its `diffArrays` has no budget of any kind, and the whole reason this exists
 * is the ceiling. Reaching for it would mean writing the bounding anyway, and
 * then owning the seam between our bound and its algorithm.
 */

export type RowOp =
  | { type: 'equal'; oldIndex: number; newIndex: number }
  | { type: 'removed'; oldIndex: number }
  | { type: 'added'; newIndex: number };

export interface Alignment {
  ops: RowOp[];
  /**
   * The budget was reached, and the middle is reported as one wholesale
   * replacement rather than matched row by row. The rows shown are still real;
   * only the pairing between them was given up on.
   */
  approximate: boolean;
}

/**
 * The largest table of pairs this will build, in cells.
 *
 * A million cells is a four-megabyte `Uint32Array` and a few milliseconds of
 * work, which is the most that belongs on the main thread of a page whose whole
 * premise is being faster than github.com. Past it the answer is coarser rather
 * than slower.
 */
export const ALIGN_BUDGET = 1_000_000;

export function alignRows(
  oldRows: readonly string[],
  newRows: readonly string[],
  budget: number = ALIGN_BUDGET,
): Alignment {
  const ops: RowOp[] = [];

  // The shared prefix, in place. This is the whole reason a twenty-thousand-row
  // file with one edit in it never reaches the quadratic path below.
  let start = 0;
  while (start < oldRows.length && start < newRows.length && oldRows[start] === newRows[start]) {
    ops.push({ type: 'equal', oldIndex: start, newIndex: start });
    start += 1;
  }

  // The shared suffix, measured from both ends inwards. Collected in reverse
  // and appended after the middle.
  let backwards = 0;
  while (
    backwards < oldRows.length - start &&
    backwards < newRows.length - start &&
    oldRows[oldRows.length - 1 - backwards] === newRows[newRows.length - 1 - backwards]
  ) {
    backwards += 1;
  }

  const oldEnd = oldRows.length - backwards;
  const newEnd = newRows.length - backwards;
  const oldMiddle = oldRows.slice(start, oldEnd);
  const newMiddle = newRows.slice(start, newEnd);

  const approximate = oldMiddle.length * newMiddle.length > budget;
  if (approximate) {
    for (let index = 0; index < oldMiddle.length; index += 1) {
      ops.push({ type: 'removed', oldIndex: start + index });
    }
    for (let index = 0; index < newMiddle.length; index += 1) {
      ops.push({ type: 'added', newIndex: start + index });
    }
  } else {
    for (const op of lcsOps(oldMiddle, newMiddle, start)) ops.push(op);
  }

  for (let index = 0; index < backwards; index += 1) {
    ops.push({ type: 'equal', oldIndex: oldEnd + index, newIndex: newEnd + index });
  }

  return { ops, approximate };
}

/**
 * The exact alignment of two already-trimmed lists.
 *
 * A textbook LCS table, walked backwards to recover the path. `Uint32Array`
 * rather than nested arrays because the caller has already promised the product
 * fits the budget, and a flat typed array is the difference between four bytes
 * a cell and a JavaScript object graph.
 *
 * `offset` is the number of rows trimmed off the front, so the indices handed
 * back address the caller's original lists rather than the slices.
 */
function lcsOps(oldRows: string[], newRows: string[], offset: number): RowOp[] {
  const rows = oldRows.length;
  const columns = newRows.length;

  if (rows === 0 || columns === 0) {
    const ops: RowOp[] = [];
    for (let index = 0; index < rows; index += 1) {
      ops.push({ type: 'removed', oldIndex: offset + index });
    }
    for (let index = 0; index < columns; index += 1) {
      ops.push({ type: 'added', newIndex: offset + index });
    }
    return ops;
  }

  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const at = row * width + column;
      table[at] =
        oldRows[row] === newRows[column]
          ? (table[at + width + 1] ?? 0) + 1
          : Math.max(table[at + width] ?? 0, table[at + 1] ?? 0);
    }
  }

  const ops: RowOp[] = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (oldRows[row] === newRows[column]) {
      ops.push({ type: 'equal', oldIndex: offset + row, newIndex: offset + column });
      row += 1;
      column += 1;
    } else if ((table[(row + 1) * width + column] ?? 0) >= (table[row * width + column + 1] ?? 0)) {
      ops.push({ type: 'removed', oldIndex: offset + row });
      row += 1;
    } else {
      ops.push({ type: 'added', newIndex: offset + column });
      column += 1;
    }
  }
  while (row < rows) {
    ops.push({ type: 'removed', oldIndex: offset + row });
    row += 1;
  }
  while (column < columns) {
    ops.push({ type: 'added', newIndex: offset + column });
    column += 1;
  }

  return ops;
}

/** One row of the rendered comparison. */
export type RowPair =
  | { kind: 'equal'; oldIndex: number; newIndex: number }
  /** The same row, edited. Both indices are real, and the cells differ. */
  | { kind: 'changed'; oldIndex: number; newIndex: number }
  | { kind: 'removed'; oldIndex: number }
  | { kind: 'added'; newIndex: number };

/**
 * Turn an alignment into rows to draw.
 *
 * The one thing this adds is pairing: a run of removals immediately followed by
 * a run of additions is, to a reviewer, a set of rows that were *edited*. Left
 * unpaired they are a block of red above a block of green, and working out
 * which cell moved means counting rows in two places at once. Zipped, the
 * caller can mark the cells that actually differ.
 *
 * Only the overlap is paired. Three rows replaced by five is three edits and
 * two additions, which is what it looks like on screen.
 */
export function pairRows(ops: readonly RowOp[]): RowPair[] {
  const pairs: RowPair[] = [];
  let at = 0;

  while (at < ops.length) {
    const op = ops[at];
    if (op === undefined) break;

    if (op.type === 'equal') {
      pairs.push({ kind: 'equal', oldIndex: op.oldIndex, newIndex: op.newIndex });
      at += 1;
      continue;
    }

    if (op.type === 'added') {
      pairs.push({ kind: 'added', newIndex: op.newIndex });
      at += 1;
      continue;
    }

    // A run of removals, and whatever additions follow it without interruption.
    const removed: number[] = [];
    while (at < ops.length && ops[at]?.type === 'removed') {
      removed.push((ops[at] as { oldIndex: number }).oldIndex);
      at += 1;
    }
    const added: number[] = [];
    while (at < ops.length && ops[at]?.type === 'added') {
      added.push((ops[at] as { newIndex: number }).newIndex);
      at += 1;
    }

    const paired = Math.min(removed.length, added.length);
    for (let index = 0; index < paired; index += 1) {
      pairs.push({
        kind: 'changed',
        oldIndex: removed[index] as number,
        newIndex: added[index] as number,
      });
    }
    for (let index = paired; index < removed.length; index += 1) {
      pairs.push({ kind: 'removed', oldIndex: removed[index] as number });
    }
    for (let index = paired; index < added.length; index += 1) {
      pairs.push({ kind: 'added', newIndex: added[index] as number });
    }
  }

  return pairs;
}
