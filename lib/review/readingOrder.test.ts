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
import {
  AS_IS,
  type Arrangement,
  arrange,
  changedLines,
  inReadingOrder,
  mostChangedFirst,
  rankOf,
  sameArrangement,
} from './readingOrder';

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

  it('puts the files the tree dims as generated after the rest, however big they are', () => {
    // A regenerated lockfile is the biggest change in most pull requests that
    // have one, and the last thing a reviewer wants first.
    const sorted = mostChangedFirst([
      { ...file('package-lock.json', 4000, 3000), noise: true },
      file('src/a.ts', 2, 1),
      { ...file('dist/bundle.js', 900, 0), noise: true },
      file('src/b.ts', 30, 0),
    ]);

    expect(paths(sorted)).toEqual(['src/b.ts', 'src/a.ts', 'package-lock.json', 'dist/bundle.js']);
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

/**
 * Types read last: sent to the end of the review, not out of it.
 *
 * Each type the reviewer sends there goes after every type already there, so
 * the order they were sent in is the order they are read in. A file that
 * matches two of them goes with the one sent most recently, which is what
 * "send this to the end" means for a file that was already in another group.
 */
describe('arrange', () => {
  // Folder order, as the shell hands it over.
  const FILES = [
    file('assets/logo.png', 0, 0),
    file('src/a.spec.tsx', 5, 0),
    file('src/a.tsx', 9, 1),
    file('src/b.spec.tsx', 1, 1),
    file('src/b.tsx', 2, 0),
  ];
  const groupsOf = (arranged: ReturnType<typeof arrange<(typeof FILES)[number]>>) =>
    arranged.groups.map((group) => [group.type, paths(group.files)]);

  it('hands back the very list it was given, with nothing to rearrange', () => {
    const arranged = arrange(FILES, AS_IS);

    expect(arranged.files).toBe(FILES);
    expect(arranged.groups).toEqual([]);
  });

  it('moves a type read last to the end, and leaves the rest in their order', () => {
    const arranged = arrange(FILES, { sort: 'folders', last: ['.png'] });

    expect(paths(arranged.files)).toEqual([
      'src/a.spec.tsx',
      'src/a.tsx',
      'src/b.spec.tsx',
      'src/b.tsx',
      'assets/logo.png',
    ]);
    expect(groupsOf(arranged)).toEqual([['.png', ['assets/logo.png']]]);
  });

  it('reads the types last in the order they were sent there', () => {
    const arranged = arrange(FILES, { sort: 'folders', last: ['.spec.tsx', '.png'] });

    expect(paths(arranged.files)).toEqual([
      'src/a.tsx',
      'src/b.tsx',
      'src/a.spec.tsx',
      'src/b.spec.tsx',
      'assets/logo.png',
    ]);
    expect(groupsOf(arranged)).toEqual([
      ['.spec.tsx', ['src/a.spec.tsx', 'src/b.spec.tsx']],
      ['.png', ['assets/logo.png']],
    ]);
  });

  it('puts a file that two of them take in with the one sent there most recently', () => {
    const arranged = arrange(FILES, { sort: 'folders', last: ['.spec.tsx', '.tsx'] });

    // Every `.tsx` file went to the end after the specs did, specs included,
    // which leaves the specs' own group with nothing in it.
    expect(groupsOf(arranged)).toEqual([
      ['.tsx', ['src/a.spec.tsx', 'src/a.tsx', 'src/b.spec.tsx', 'src/b.tsx']],
    ]);
  });

  it('sorts the rest and each group by size while the review is read most changed first', () => {
    const arranged = arrange(FILES, { sort: 'changes', last: ['.spec.tsx'] });

    expect(paths(arranged.files)).toEqual([
      'src/a.tsx',
      'src/b.tsx',
      'assets/logo.png',
      'src/a.spec.tsx',
      'src/b.spec.tsx',
    ]);
  });

  it('hands back the list it was given when no file here has a type read last', () => {
    const arranged = arrange(FILES, { sort: 'folders', last: ['.md'] });

    expect(arranged.files).toBe(FILES);
    expect(arranged.groups).toEqual([]);
  });
});


/**
 * Whether two arrangements lay a review out alike. A remembered order comes
 * back from storage as a new object every time it is written, the writer's own
 * write included, and only a real change should reach the review.
 */
describe('sameArrangement', () => {
  const READ: Arrangement = { sort: 'changes', last: ['.snap', '.md'] };

  it('is the same order with the same types sent last, as a new object', () => {
    expect(sameArrangement(READ, { sort: 'changes', last: ['.snap', '.md'] })).toBe(true);
  });

  it.each<[Arrangement, string]>([
    [{ sort: 'folders', last: ['.snap', '.md'] }, 'the other order'],
    [{ sort: 'changes', last: ['.md', '.snap'] }, 'the same types, sent in the other order'],
    [{ sort: 'changes', last: ['.snap'] }, 'one type fewer'],
  ])('is not the same as %j: %s', (other) => {
    expect(sameArrangement(READ, other)).toBe(false);
  });
});
