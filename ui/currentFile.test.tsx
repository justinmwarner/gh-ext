/**
 * Which file the reviewer is on, and which side moved it.
 *
 * Two surfaces drive the same value in opposite directions: picking a file in
 * the tree scrolls the diff, and scrolling the diff selects in the tree. Each
 * of those actions makes the *other* surface report back, so without a rule
 * about who moved last the two chase each other forever.
 *
 * The rule is here, in a reducer, rather than in either component — because a
 * loop is a property of the pair, and neither half can be tested for it alone.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_FILE,
  fromScroll,
  fromTree,
  shouldScrollDiff,
  shouldSelectInTree,
  topmostFile,
} from './currentFile';

describe('currentFile', () => {
  it('starts on nothing, with nobody to answer for it', () => {
    expect(NO_FILE).toEqual({ path: null, origin: null });
    expect(shouldScrollDiff(NO_FILE)).toBe(false);
    expect(shouldSelectInTree(NO_FILE)).toBe(false);
  });

  it('lets the tree move the diff column', () => {
    const state = fromTree(NO_FILE, 'src/a.ts');

    expect(state).toEqual({ path: 'src/a.ts', origin: 'tree' });
    expect(shouldScrollDiff(state)).toBe(true);
    expect(shouldSelectInTree(state)).toBe(false);
  });

  it('lets the diff column move the tree', () => {
    const state = fromScroll(NO_FILE, 'src/a.ts');

    expect(state).toEqual({ path: 'src/a.ts', origin: 'scroll' });
    expect(shouldSelectInTree(state)).toBe(true);
    expect(shouldScrollDiff(state)).toBe(false);
  });

  it('returns the identical state when the diff echoes back the tree’s choice', () => {
    // Identity, not equality: React bails out of a re-render when the reducer
    // returns the same object, so the echo costs nothing and starts no effects.
    const picked = fromTree(NO_FILE, 'src/a.ts');
    const echoed = fromScroll(picked, 'src/a.ts');

    expect(echoed).toBe(picked);
  });

  it('returns the identical state when the tree echoes back the diff’s scroll', () => {
    const scrolled = fromScroll(NO_FILE, 'src/a.ts');
    const echoed = fromTree(scrolled, 'src/a.ts');

    expect(echoed).toBe(scrolled);
  });

  it('settles after one round trip in either direction', () => {
    // The whole loop, played out. Tree picks, diff scrolls and reports back,
    // and the second report is the fixed point.
    let state = fromTree(NO_FILE, 'src/a.ts');
    expect(shouldScrollDiff(state)).toBe(true);

    state = fromScroll(state, 'src/a.ts');
    expect(shouldScrollDiff(state)).toBe(true); // unchanged: the effect will not re-run
    expect(shouldSelectInTree(state)).toBe(false);

    state = fromScroll(state, 'src/b.ts');
    expect(shouldSelectInTree(state)).toBe(true);

    state = fromTree(state, 'src/b.ts');
    expect(shouldSelectInTree(state)).toBe(true);
    expect(shouldScrollDiff(state)).toBe(false);
  });

  it('still moves when the same file is picked again from the other side', () => {
    // Re-picking the file you are already on is a no-op, deliberately: there is
    // nothing to scroll to and nothing to select that is not already selected.
    const state = fromTree(NO_FILE, 'src/a.ts');

    expect(fromTree(state, 'src/a.ts')).toBe(state);
  });
});

describe('topmostFile', () => {
  it('picks the last card that has reached the top of the viewport', () => {
    expect(
      topmostFile([
        { path: 'src/a.ts', top: -240 },
        { path: 'src/b.ts', top: -10 },
        { path: 'src/c.ts', top: 320 },
      ]),
    ).toBe('src/b.ts');
  });

  it('picks the first card while the column is still at the top', () => {
    expect(
      topmostFile([
        { path: 'src/a.ts', top: 0 },
        { path: 'src/b.ts', top: 400 },
      ]),
    ).toBe('src/a.ts');
  });

  it('falls back to the first card when every card is below the fold', () => {
    // Virtualization can leave the topmost mounted header below the viewport
    // for a moment. Reporting nothing would clear the tree selection.
    expect(
      topmostFile([
        { path: 'src/b.ts', top: 40 },
        { path: 'src/c.ts', top: 400 },
      ]),
    ).toBe('src/b.ts');
  });

  it('has no answer when nothing is mounted', () => {
    expect(topmostFile([])).toBeNull();
  });

  it('does not depend on the order it was measured in', () => {
    expect(
      topmostFile([
        { path: 'src/c.ts', top: 320 },
        { path: 'src/a.ts', top: -240 },
        { path: 'src/b.ts', top: -10 },
      ]),
    ).toBe('src/b.ts');
  });
});
