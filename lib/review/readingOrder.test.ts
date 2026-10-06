/**
 * The second order a review can be read in: most changed first.
 *
 * What is pinned here is what decides where a file lands. The size is the
 * `+N −M` already on the file's row, so the order explains itself. Ties keep
 * the order the files arrived in, which is folder order, so a run of one-line
 * import fixes stays grouped by directory instead of being scattered. And a
 * file with no lines to count sinks to the end rather than being guessed at.
 */

import { describe, expect, it } from 'vitest';
import { changedLines, inReadingOrder, mostChangedFirst, rankOf } from './readingOrder';

const file = (path: string, additions: number, deletions: number) => ({
  path,
  additions,
  deletions,
});

const paths = (files: readonly { path: string }[]): string[] => files.map((f) => f.path);

describe('changedLines', () => {
  it('is lines added plus lines removed, the two figures on the row', () => {
    expect(changedLines(file('a.ts', 12, 3))).toBe(15);
  });
});

describe('mostChangedFirst', () => {
  it('puts the file with the most lines changed first', () => {
    const sorted = mostChangedFirst([
      file('a.ts', 1, 1),
      file('b.ts', 40, 2),
      file('c.ts', 3, 9),
    ]);

    expect(paths(sorted)).toEqual(['b.ts', 'c.ts', 'a.ts']);
  });

  it('counts a deletion by what it removed, so a large one rises to the top', () => {
    const sorted = mostChangedFirst([file('small.ts', 2, 0), file('gone.ts', 0, 900)]);

    expect(paths(sorted)).toEqual(['gone.ts', 'small.ts']);
  });

  it('keeps tied files in the order they arrived in, which is folder order', () => {
    const sorted = mostChangedFirst([
      file('lib/a.ts', 1, 1),
      file('lib/b.ts', 1, 1),
      file('src/big.ts', 30, 0),
      file('src/c.ts', 1, 1),
    ]);

    expect(paths(sorted)).toEqual(['src/big.ts', 'lib/a.ts', 'lib/b.ts', 'src/c.ts']);
  });

  it('sinks files with no lines to count, such as images and pure moves, to the end', () => {
    const sorted = mostChangedFirst([
      file('logo.png', 0, 0),
      file('a.ts', 1, 0),
      file('moved.ts', 0, 0),
    ]);

    expect(paths(sorted)).toEqual(['a.ts', 'logo.png', 'moved.ts']);
  });

  it('leaves the list it was given alone', () => {
    const given = [file('a.ts', 1, 0), file('b.ts', 9, 0)];
    mostChangedFirst(given);

    expect(paths(given)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('inReadingOrder', () => {
  it('lays a list out by a rank taken from another list', () => {
    const rank = rankOf([file('b.ts', 9, 0), file('a.ts', 1, 0), file('c.ts', 0, 0)]);

    expect(paths(inReadingOrder([file('a.ts', 1, 0), file('c.ts', 0, 0), file('b.ts', 9, 0)], rank))).toEqual([
      'b.ts',
      'a.ts',
      'c.ts',
    ]);
  });

  it('hands back the very list it was given when there is no rank to follow', () => {
    const given = [file('a.ts', 1, 0)];

    expect(inReadingOrder(given, null)).toBe(given);
  });

  it('puts a path the rank does not know last, not first', () => {
    const rank = rankOf([file('a.ts', 1, 0)]);

    expect(paths(inReadingOrder([file('stray.ts', 5, 5), file('a.ts', 1, 0)], rank))).toEqual([
      'a.ts',
      'stray.ts',
    ]);
  });
});
