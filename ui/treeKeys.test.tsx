/**
 * The arrow keys, resolved against a flat row list and nothing else.
 *
 * Lifted out of `FileTree` so the find panel's result tree answers Left and
 * Right the same way the file tree does. It is the fiddly half — "Left on an
 * open folder shuts it, on a shut one walks to the parent, and on a file walks
 * to the parent" is four rules wearing one key — and two copies of it would
 * drift the first time either tree grew a row kind.
 */

import { describe, expect, it } from 'vitest';
import { type KeyRow, claimsTreeKey, resolveTreeKey } from './treeKeys';

/**
 * A small tree, flat and in draw order, the way `treeRows` hands one over.
 *
 *   src/            0
 *     review/       1   (shut)
 *     app.ts        2
 *   README.md       3
 */
const ROWS: readonly KeyRow[] = [
  { path: 'src/', depth: 0, kind: 'directory', expanded: true },
  { path: 'src/review/', depth: 1, kind: 'directory', expanded: false },
  { path: 'src/app.ts', depth: 1, kind: 'file', expanded: false },
  { path: 'README.md', depth: 0, kind: 'file', expanded: false },
];

describe('resolveTreeKey', () => {
  it('steps down a row', () => {
    expect(resolveTreeKey(ROWS, 0, 'ArrowDown')).toEqual({ kind: 'move', index: 1 });
  });

  it('steps up a row', () => {
    expect(resolveTreeKey(ROWS, 2, 'ArrowUp')).toEqual({ kind: 'move', index: 1 });
  });

  it('stops at the ends rather than wrapping', () => {
    // A tree is a place, not a carousel. Walking off the bottom and landing at
    // the top loses the reviewer their place in a list of four hundred files.
    expect(resolveTreeKey(ROWS, 0, 'ArrowUp')).toBeNull();
    expect(resolveTreeKey(ROWS, 3, 'ArrowDown')).toBeNull();
  });

  it('goes to the first and last rows', () => {
    expect(resolveTreeKey(ROWS, 2, 'Home')).toEqual({ kind: 'move', index: 0 });
    expect(resolveTreeKey(ROWS, 0, 'End')).toEqual({ kind: 'move', index: 3 });
  });

  it('opens a shut directory with Right', () => {
    expect(resolveTreeKey(ROWS, 1, 'ArrowRight')).toEqual({
      kind: 'fold',
      path: 'src/review/',
      shut: false,
    });
  });

  it('descends into an already-open directory with Right', () => {
    expect(resolveTreeKey(ROWS, 0, 'ArrowRight')).toEqual({ kind: 'move', index: 1 });
  });

  it('does nothing on Right from a file', () => {
    expect(resolveTreeKey(ROWS, 2, 'ArrowRight')).toBeNull();
  });

  it('shuts an open directory with Left', () => {
    expect(resolveTreeKey(ROWS, 0, 'ArrowLeft')).toEqual({
      kind: 'fold',
      path: 'src/',
      shut: true,
    });
  });

  it('walks from a file to the directory holding it with Left', () => {
    expect(resolveTreeKey(ROWS, 2, 'ArrowLeft')).toEqual({ kind: 'move', index: 0 });
  });

  it('walks from a shut directory to its parent with Left', () => {
    expect(resolveTreeKey(ROWS, 1, 'ArrowLeft')).toEqual({ kind: 'move', index: 0 });
  });

  it('does nothing on Left from a row with no parent', () => {
    expect(resolveTreeKey(ROWS, 3, 'ArrowLeft')).toBeNull();
  });

  it('ignores keys that are not its business', () => {
    // `Enter` and `Space` mean different things in a checklist and in a result
    // list, so each tree answers them itself.
    expect(resolveTreeKey(ROWS, 0, 'Enter')).toBeNull();
    expect(resolveTreeKey(ROWS, 0, ' ')).toBeNull();
    expect(resolveTreeKey(ROWS, 0, 'a')).toBeNull();
  });

  it('gives back nothing for an index that is not in the list', () => {
    expect(resolveTreeKey(ROWS, -1, 'ArrowDown')).toBeNull();
    expect(resolveTreeKey([], 0, 'Home')).toBeNull();
  });

  it('finds the parent of a row nested more than one deep', () => {
    const deep: readonly KeyRow[] = [
      { path: 'a/', depth: 0, kind: 'directory', expanded: true },
      { path: 'a/b/', depth: 1, kind: 'directory', expanded: true },
      { path: 'a/b/c.ts', depth: 2, kind: 'file', expanded: false },
    ];

    expect(resolveTreeKey(deep, 2, 'ArrowLeft')).toEqual({ kind: 'move', index: 1 });
  });
});

/**
 * Whether the tree is answering a key, which is not the same question as
 * whether it has anywhere to go.
 *
 * `ArrowDown` on the last row moves nothing and must still be swallowed: the
 * tree owns the arrow keys for as long as it holds focus, and letting the last
 * one through would scroll the rail out from under a reviewer who had simply
 * reached the bottom of the list.
 */
describe('claimsTreeKey', () => {
  it('claims the six keys it navigates with', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(claimsTreeKey(key)).toBe(true);
    }
  });

  it('leaves everything else to the caller', () => {
    expect(claimsTreeKey('Enter')).toBe(false);
    expect(claimsTreeKey(' ')).toBe(false);
    expect(claimsTreeKey('a')).toBe(false);
    expect(claimsTreeKey('Escape')).toBe(false);
  });

  it('claims a key even where resolving it finds nowhere to go', () => {
    expect(resolveTreeKey(ROWS, 3, 'ArrowDown')).toBeNull();
    expect(claimsTreeKey('ArrowDown')).toBe(true);
  });
});
