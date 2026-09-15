/**
 * The resolvers the two navigation surfaces are drawn from.
 *
 * Everything here is a function of one ordered stop list, which is why it runs
 * in the `lib` project: the counter and the pill read the same list, and a
 * disagreement between them would be a disagreement about arithmetic rather
 * than about the DOM.
 */

import { describe, expect, it } from 'vitest';
import {
  type HunkStop,
  fileRun,
  positionInFile,
  remainingInFile,
  stopAtLine,
} from './hunkNav';

/** Three hunks in one file, one in the next. Reading order, grouped by file. */
const at = (path: string, line: number): HunkStop => ({ path, side: 'additions', line });

const STOPS: readonly HunkStop[] = [
  at('a.ts', 10),
  at('a.ts', 50),
  at('a.ts', 90),
  at('b.ts', 4),
];

describe('fileRun', () => {
  it('finds where a file begins and how many stops it has', () => {
    expect(fileRun(STOPS, 'a.ts')).toEqual({ start: 0, count: 3 });
    expect(fileRun(STOPS, 'b.ts')).toEqual({ start: 3, count: 1 });
  });

  it('reports a file with no stops as absent rather than as empty at zero', () => {
    // `start` is fed back as a cursor index, where -1 already means "unknown".
    // Returning 0 would name the first stop of somebody else's file.
    expect(fileRun(STOPS, 'never.ts')).toEqual({ start: -1, count: 0 });
  });

  it('answers for no file at all, which is what an unscrolled column reports', () => {
    expect(fileRun(STOPS, null)).toEqual({ start: -1, count: 0 });
  });
});

describe('stopAtLine', () => {
  it('lands on the stop whose hunk starts exactly at this line', () => {
    expect(stopAtLine(STOPS, 'a.ts', 10)).toBe(0);
    expect(stopAtLine(STOPS, 'a.ts', 90)).toBe(2);
  });

  it('holds the last stop passed while the reviewer is inside or below a hunk', () => {
    // The viewport's top edge lands on context between two hunks far more often
    // than on a hunk header. "The section I am in" is the one above me.
    expect(stopAtLine(STOPS, 'a.ts', 60)).toBe(1);
    expect(stopAtLine(STOPS, 'a.ts', 4000)).toBe(2);
  });

  it('reports nothing above the first hunk of the file', () => {
    expect(stopAtLine(STOPS, 'a.ts', 5)).toBe(-1);
  });

  it('reports nothing for a file that has no stops', () => {
    expect(stopAtLine(STOPS, 'never.ts', 50)).toBe(-1);
  });

  it('does not read a neighbouring file to answer about this one', () => {
    // b.ts starts at line 4, which is below every line a.ts is asked about.
    // A scan that forgot to filter by path would return b.ts's stop here.
    expect(stopAtLine(STOPS, 'b.ts', 2)).toBe(-1);
  });
});

describe('positionInFile', () => {
  it('counts from one, within the file rather than within the review', () => {
    expect(positionInFile(STOPS, 0)).toEqual({ n: 1, of: 3 });
    expect(positionInFile(STOPS, 2)).toEqual({ n: 3, of: 3 });
  });

  it('restarts at the first stop of the next file', () => {
    expect(positionInFile(STOPS, 3)).toEqual({ n: 1, of: 1 });
  });

  it('has no answer for an unknown position', () => {
    expect(positionInFile(STOPS, -1)).toBeNull();
    expect(positionInFile(STOPS, 4)).toBeNull();
  });
});

describe('remainingInFile', () => {
  it('counts only the stops still below, and only in this file', () => {
    expect(remainingInFile(STOPS, 'a.ts', 10)).toBe(2);
    expect(remainingInFile(STOPS, 'a.ts', 50)).toBe(1);
  });

  it('goes quiet once the last change in the file is above', () => {
    // The pill's whole design is that it stops speaking here.
    expect(remainingInFile(STOPS, 'a.ts', 90)).toBe(0);
    expect(remainingInFile(STOPS, 'a.ts', 900)).toBe(0);
  });

  it('counts every stop when the reviewer is above the first', () => {
    expect(remainingInFile(STOPS, 'a.ts', 0)).toBe(3);
  });

  it('never goes negative, and knows nothing of a file with no stops', () => {
    expect(remainingInFile(STOPS, 'never.ts', 0)).toBe(0);
  });
});
