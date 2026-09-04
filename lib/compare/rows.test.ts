/**
 * Lining two lists of rows up against each other.
 *
 * The two properties that matter are correctness on small inputs and a hard
 * ceiling on large ones. The second is not a nicety: this runs on whatever a
 * pull request contains, and a quadratic walk over a hundred thousand CSV rows
 * is a hung tab rather than a slow one.
 */

import { describe, expect, it } from 'vitest';
import { ALIGN_BUDGET, alignRows, pairRows } from './rows';

const kinds = (rows: ReturnType<typeof pairRows>): string[] =>
  rows.map((row) => row.kind);

describe('alignRows', () => {
  it('calls two identical lists equal all the way down', () => {
    const { ops, approximate } = alignRows(['a', 'b', 'c'], ['a', 'b', 'c']);

    expect(ops.map((op) => op.type)).toEqual(['equal', 'equal', 'equal']);
    expect(approximate).toBe(false);
  });

  it('finds an insertion in the middle without disturbing its neighbours', () => {
    const { ops } = alignRows(['a', 'c'], ['a', 'b', 'c']);

    expect(ops).toEqual([
      { type: 'equal', oldIndex: 0, newIndex: 0 },
      { type: 'added', newIndex: 1 },
      { type: 'equal', oldIndex: 1, newIndex: 2 },
    ]);
  });

  it('finds a deletion in the middle', () => {
    const { ops } = alignRows(['a', 'b', 'c'], ['a', 'c']);

    expect(ops).toEqual([
      { type: 'equal', oldIndex: 0, newIndex: 0 },
      { type: 'removed', oldIndex: 1 },
      { type: 'equal', oldIndex: 2, newIndex: 1 },
    ]);
  });

  it('keeps the longest common run rather than the first one it meets', () => {
    // The greedy answer here is to pair the leading `x` and call everything
    // after it changed. The right answer keeps the three-row tail.
    const { ops } = alignRows(['x', 'a', 'b', 'c'], ['a', 'b', 'c']);

    expect(ops.filter((op) => op.type === 'equal')).toHaveLength(3);
  });

  it('handles one side being empty', () => {
    expect(alignRows([], ['a', 'b']).ops.map((op) => op.type)).toEqual([
      'added',
      'added',
    ]);
    expect(alignRows(['a'], []).ops.map((op) => op.type)).toEqual(['removed']);
  });

  it('reports the whole thing as one replacement rather than exceeding its budget', () => {
    // Two large lists with nothing in common are the worst case, and this is
    // the answer that is bounded: everything on the left went, everything on
    // the right arrived. It is less informative and it always terminates.
    const size = 4000;
    const left = Array.from({ length: size }, (_, index) => `L${index}`);
    const right = Array.from({ length: size }, (_, index) => `R${index}`);

    const { ops, approximate } = alignRows(left, right);

    expect(approximate).toBe(true);
    expect(ops).toHaveLength(size * 2);
    expect(ops.filter((op) => op.type === 'equal')).toHaveLength(0);
  });

  it('still aligns a huge file exactly when only a little of it moved', () => {
    // The common case for a generated table: thousands of rows, one edit. The
    // shared prefix and suffix come off before the budget is consulted, so this
    // stays exact where the naive quadratic answer would have given up.
    const rows = Array.from({ length: 20_000 }, (_, index) => `row ${index}`);
    const edited = [...rows];
    edited[10_000] = 'row 10000 changed';

    const { ops, approximate } = alignRows(rows, edited);

    expect(approximate).toBe(false);
    expect(ops.filter((op) => op.type !== 'equal')).toHaveLength(2);
  });

  it('exposes its budget, so a caller can decide before it calls', () => {
    expect(ALIGN_BUDGET).toBeGreaterThan(0);
  });
});

describe('pairRows', () => {
  it('zips a removal against the addition that replaced it', () => {
    // Two rows in the same position with different contents is an edit, and a
    // reviewer wants to see which cells moved — not one red row and one green
    // one twenty lines apart.
    const { ops } = alignRows(['a', 'old', 'c'], ['a', 'new', 'c']);

    expect(kinds(pairRows(ops))).toEqual(['equal', 'changed', 'equal']);
  });

  it('leaves the surplus unpaired when the two runs are different lengths', () => {
    const { ops } = alignRows(['a', 'p', 'q', 'd'], ['a', 'P', 'd']);

    expect(kinds(pairRows(ops))).toEqual(['equal', 'changed', 'removed', 'equal']);
  });

  it('does not pair an addition with a removal that is not adjacent to it', () => {
    const { ops } = alignRows(['gone', 'a'], ['a', 'new']);

    expect(kinds(pairRows(ops))).toEqual(['removed', 'equal', 'added']);
  });

  it('carries both indices on a paired row', () => {
    const { ops } = alignRows(['old'], ['new']);

    expect(pairRows(ops)).toEqual([{ kind: 'changed', oldIndex: 0, newIndex: 0 }]);
  });
});
