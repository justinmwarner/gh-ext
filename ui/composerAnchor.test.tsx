/**
 * Turning a gutter gesture into somewhere to put the composer.
 *
 * `normalizeSelection` decides whether GitHub can express the range. This
 * decides where the box goes when it cannot — because "explain the problem" is
 * only possible if there is a rendered line to hang the explanation on.
 */

import { describe, expect, it } from 'vitest';
import { BOTH_SIDES } from '@/lib/review/diffScope';
import { composerFor } from './composerAnchor';

describe('composerFor', () => {
  it('places a single-line selection on the added side', () => {
    expect(composerFor('src/app.ts', { start: 4, end: 4, side: 'additions' }, BOTH_SIDES)).toEqual({
      path: 'src/app.ts',
      side: 'additions',
      lineNumber: 4,
      anchor: { line: 4, side: 'RIGHT' },
      rejection: null,
    });
  });

  it('places a selection on the removed side', () => {
    expect(composerFor('src/app.ts', { start: 4, end: 4, side: 'deletions' }, BOTH_SIDES)).toEqual({
      path: 'src/app.ts',
      side: 'deletions',
      lineNumber: 4,
      anchor: { line: 4, side: 'LEFT' },
      rejection: null,
    });
  });

  it('rights a selection dragged upwards', () => {
    // Pierre preserves drag direction: `start` is the anchor, not the top.
    const placed = composerFor('src/app.ts', { start: 9, end: 5, side: 'additions' }, BOTH_SIDES);

    expect(placed?.anchor).toEqual({
      line: 9,
      side: 'RIGHT',
      startLine: 5,
      startSide: 'RIGHT',
    });
    expect(placed?.lineNumber).toBe(9);
  });

  it('places a cross-side drag on the line it ended at, with the reason', () => {
    // GitHub cannot represent this comment, but the reviewer still has to be
    // told — and the end of the drag is a line that is definitely on screen.
    expect(
      composerFor(
        'src/app.ts',
        { start: 4, end: 4, side: 'deletions', endSide: 'additions' },
        BOTH_SIDES,
      ),
    ).toEqual({
      path: 'src/app.ts',
      side: 'additions',
      lineNumber: 4,
      anchor: null,
      rejection: 'cross-side',
    });
  });

  it('refuses to place a range with no usable line at all', () => {
    // Nothing to anchor to, so the caller says so somewhere else on the page
    // rather than posting `line: NaN`.
    expect(
      composerFor(
        'src/app.ts',
        { start: Number.NaN, end: Number.NaN, side: 'additions' },
        BOTH_SIDES,
      ),
    ).toBeNull();
  });

  it('keeps a malformed start but usable end anchored, with the reason', () => {
    const placed = composerFor(
      'src/app.ts',
      { start: Number.NaN, end: 7, side: 'additions' },
      BOTH_SIDES,
    );

    expect(placed?.anchor).toBeNull();
    expect(placed?.rejection).toBe('invalid-range');
    expect(placed?.lineNumber).toBe(7);
  });

  /**
   * A comment is posted as a line number in the *pull request's* diff.
   * `addPullRequestReviewThread` takes no commit — the input shape has `path`,
   * `line` and `side` and nothing to say which commit they are counted in — so
   * a line picked off a diff between two other commits would be posted against
   * whatever occupies that number in the pull request's own diff.
   *
   * That comment would look posted, and would be attached to code the reviewer
   * never read. There is no way to make it right from here, so it is refused
   * where the reviewer can see why.
   */
  describe('on a diff taken between other commits', () => {
    const OLDER_HEAD = { additions: false, deletions: true };

    it('refuses a line on a side whose numbers belong to another commit', () => {
      const placed = composerFor(
        'src/app.ts',
        { start: 4, end: 4, side: 'additions' },
        OLDER_HEAD,
      );

      expect(placed?.anchor).toBeNull();
      expect(placed?.rejection).toBe('other-commit');
      // Still placed, so the explanation lands on the line they selected.
      expect(placed?.lineNumber).toBe(4);
      expect(placed?.side).toBe('additions');
    });

    it('still allows a line on the side that does line up', () => {
      const placed = composerFor(
        'src/app.ts',
        { start: 4, end: 4, side: 'deletions' },
        OLDER_HEAD,
      );

      expect(placed?.anchor).toEqual({ line: 4, side: 'LEFT' });
      expect(placed?.rejection).toBeNull();
    });

    it('reports a cross-side drag as cross-side, which is true on any diff', () => {
      // Both are refusals; only one of them goes away by showing all commits.
      const placed = composerFor(
        'src/app.ts',
        { start: 4, end: 4, side: 'deletions', endSide: 'additions' },
        OLDER_HEAD,
      );

      expect(placed?.rejection).toBe('cross-side');
    });
  });
});
