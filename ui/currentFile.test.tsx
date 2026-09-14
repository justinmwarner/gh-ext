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

  it('acts when the tree is pressed on the file the scroll had landed on', () => {
    // Not an echo. The tree reporting a file back is one thing; a reviewer
    // *pressing* the row the scroll happened to select is another, and it is a
    // request — the header is partway up the column and they want it at the
    // top. Returning the identical state made that press do nothing at all,
    // which showed up hardest after a commit tab rebuilt the column: the file
    // was still `current`, so clicking its row could not bring it back.
    //
    // Only the scroll side keeps the identity bail-out, because only the
    // scroll side produces echoes. A press is never an echo.
    const scrolled = fromScroll(NO_FILE, 'src/a.ts');
    const pressed = fromTree(scrolled, 'src/a.ts');

    expect(pressed).not.toBe(scrolled);
    expect(pressed).toEqual({ path: 'src/a.ts', origin: 'tree' });
    expect(shouldScrollDiff(pressed)).toBe(true);
  });

  it('acts when a shortcut names the file the reviewer is already on', () => {
    // `j` onto the last file, then a jump to a thread in it. Same argument.
    const scrolled = fromScroll(NO_FILE, 'src/a.ts');
    const asked = fromCommand(scrolled, 'src/a.ts');

    expect(asked).not.toBe(scrolled);
    expect(shouldScrollDiff(asked)).toBe(true);
  });

  it('still returns the identical state when a scroll re-reports where it is', () => {
    // The half that has to keep bailing out: scroll fires at frame rate, and
    // most frames are still on the file the last one reported.
    const scrolled = fromScroll(NO_FILE, 'src/a.ts');

    expect(fromScroll(scrolled, 'src/a.ts')).toBe(scrolled);
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

    // The loop is closed by the *scroll* side's echo above, not by this one.
    // A press here is the reviewer asking again, so it acts — and acting is
    // safe, because nothing calls `fromTree` except an event handler. The
    // second report from a scroll is the fixed point; a press is a new start.
    state = fromTree(state, 'src/b.ts');
    expect(shouldScrollDiff(state)).toBe(true);
    expect(shouldSelectInTree(state)).toBe(false);

    state = fromScroll(state, 'src/b.ts');
    expect(shouldScrollDiff(state)).toBe(true); // unchanged: the effect will not re-run
  });

  it('acts on a second press of the row the reviewer is already on', () => {
    // There is something to scroll to: the reviewer has read half the file and
    // wants its header back at the top. This used to return the same object,
    // which made the second press — and every press after it — do nothing.
    const state = fromTree(NO_FILE, 'src/a.ts');

    expect(fromTree(state, 'src/a.ts')).not.toBe(state);
    expect(shouldScrollDiff(fromTree(state, 'src/a.ts'))).toBe(true);
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

  it('acts again when asked again for the file it is already on', () => {
    // `n` twice onto two threads in one file, or Mod+K to the file already
    // showing. Both are requests to be taken there, and both were swallowed
    // while every repeat returned the identical state. The loop is still
    // closed, because only a scroll can echo — see the reducer.
    const at = fromCommand(NO_FILE, 'src/app.ts');
    expect(fromCommand(at, 'src/app.ts')).not.toBe(at);
    expect(shouldScrollDiff(fromCommand(at, 'src/app.ts'))).toBe(true);
  });
});
