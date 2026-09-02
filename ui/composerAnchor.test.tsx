/**
 * Turning a gutter gesture into somewhere to put the composer.
 *
 * `normalizeSelection` decides whether GitHub can express the range. This
 * decides where the box goes when it cannot — because "explain the problem" is
 * only possible if there is a rendered line to hang the explanation on.
 */

import { describe, expect, it } from 'vitest';
import { composerFor } from './composerAnchor';

describe('composerFor', () => {
  it('places a single-line selection on the added side', () => {
    expect(composerFor('src/app.ts', { start: 4, end: 4, side: 'additions' })).toEqual({
      path: 'src/app.ts',
      side: 'additions',
      lineNumber: 4,
      anchor: { line: 4, side: 'RIGHT' },
      rejection: null,
    });
  });

  it('places a selection on the removed side', () => {
    expect(composerFor('src/app.ts', { start: 4, end: 4, side: 'deletions' })).toEqual({
      path: 'src/app.ts',
      side: 'deletions',
      lineNumber: 4,
      anchor: { line: 4, side: 'LEFT' },
      rejection: null,
    });
  });

  it('rights a selection dragged upwards', () => {
    // Pierre preserves drag direction: `start` is the anchor, not the top.
    const placed = composerFor('src/app.ts', { start: 9, end: 5, side: 'additions' });

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
      composerFor('src/app.ts', {
        start: 4,
        end: 4,
        side: 'deletions',
        endSide: 'additions',
      }),
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
      composerFor('src/app.ts', { start: Number.NaN, end: Number.NaN, side: 'additions' }),
    ).toBeNull();
  });

  it('keeps a malformed start but usable end anchored, with the reason', () => {
    const placed = composerFor('src/app.ts', {
      start: Number.NaN,
      end: 7,
      side: 'additions',
    });

    expect(placed?.anchor).toBeNull();
    expect(placed?.rejection).toBe('invalid-range');
    expect(placed?.lineNumber).toBe(7);
  });
});
