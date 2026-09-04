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
  fromCommand,
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

  it('counts the file the column just scrolled to, not the one above it', () => {
    // Scrolling the column to a file does not leave that file's header flush
    // with the top: the gap between one file's last line and the next one's
    // header belongs to the file below it, and the scroll lands on top of the
    // gap. Measured at 26px in a real browser.
    //
    // With a tighter tolerance, clicking a file in the tree reported the file
    // *above* it — which then drove the tree to select that one instead, so
    // the row the reviewer had just clicked came back deselected.
    expect(
      topmostFile([
        { path: 'lib/util/clamp.ts', top: -20 },
        { path: 'lib/util/debounce.ts', top: 26 },
      ]),
    ).toBe('lib/util/debounce.ts');
  });

  it('still prefers a header that has actually passed the top', () => {
    // The tolerance is for the gap above a header, not licence to skip ahead
    // while the previous file still fills the viewport.
    expect(
      topmostFile([
        { path: 'src/a.ts', top: -300 },
        { path: 'src/b.ts', top: 400 },
      ]),
    ).toBe('src/a.ts');
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

describe('a move neither surface made', () => {
  /**
   * `j`, `k`, the Mod+K jump panel and the Overview's thread links all move
   * the current file without either surface having done it. They reused
   * `fromTree`, whose whole meaning is "the tree already knows, do not
   * re-select there" — so the diff scrolled and the tree sat still, showing a
   * file the reviewer left three keystrokes ago.
   *
   * The scroll echo cannot rescue it: `moveTo` returns the same state when the
   * path has not changed, and Pierre scrolls instantly, so the one scroll
   * event that follows reports the path already current and changes nothing.
   */
  it('scrolls the diff', () => {
    expect(shouldScrollDiff(fromCommand(NO_FILE, 'src/app.ts'))).toBe(true);
  });

  it('selects in the tree as well', () => {
    expect(shouldSelectInTree(fromCommand(NO_FILE, 'src/app.ts'))).toBe(true);
  });

  it('still lets the tree keep its own moves to itself', () => {
    const fromTheTree = fromTree(NO_FILE, 'src/app.ts');
    expect(shouldSelectInTree(fromTheTree)).toBe(false);
    expect(shouldScrollDiff(fromTheTree)).toBe(true);
  });

  it('still lets a scroll keep the column to itself', () => {
    const fromScrolling = fromScroll(NO_FILE, 'src/app.ts');
    expect(shouldScrollDiff(fromScrolling)).toBe(false);
    expect(shouldSelectInTree(fromScrolling)).toBe(true);
  });

  it('is a no-op when the file has not actually changed', () => {
    // The identity check is what stops the two surfaces echoing each other
    // forever; a third origin must not be the one that breaks it.
    const at = fromCommand(NO_FILE, 'src/app.ts');
    expect(fromCommand(at, 'src/app.ts')).toBe(at);
  });
});
