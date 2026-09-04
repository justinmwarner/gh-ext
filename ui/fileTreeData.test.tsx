/**
 * How much conversation each file is carrying.
 *
 * One tally, read by two surfaces. The absence of a path is the signal the
 * tree reads, so the interesting cases are all about what is *not* in the map.
 */

import { describe, expect, it } from 'vitest';
import { fileComments } from './fileTreeData';
import { reviewThread } from './prPayload.fixture';

describe('fileComments', () => {
  it('counts a file’s threads and how many are still open', () => {
    const tally = fileComments([
      reviewThread({ path: 'src/a.ts', line: 4 }),
      reviewThread({ path: 'src/a.ts', line: 9, isResolved: true }),
    ]);

    expect(tally.get('src/a.ts')).toEqual({ total: 2, unresolved: 1 });
  });

  it('keeps a file whose threads are all resolved', () => {
    // The row still has something to say: this is where the discussion was.
    const tally = fileComments([reviewThread({ path: 'src/a.ts', isResolved: true })]);

    expect(tally.get('src/a.ts')).toEqual({ total: 1, unresolved: 0 });
  });

  it('leaves a file nobody commented on out of the map entirely', () => {
    // Absence is the signal the tree reads; a zeroed entry would draw a mark
    // on every row.
    expect(fileComments([]).has('src/a.ts')).toBe(false);
  });

  it('counts threads on a file the diff column never received', () => {
    // They cost nothing here, and a tree with no row for the path never asks.
    const tally = fileComments([reviewThread({ path: 'lib/dropped.ts' })]);

    expect(tally.get('lib/dropped.ts')).toEqual({ total: 1, unresolved: 1 });
  });
});
