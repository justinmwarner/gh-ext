/**
 * The repair for cards a reorder strands, against a stand-in for `CodeView`.
 *
 * `DiffColumn.test.tsx` shows the repair working on the real viewer. What is
 * pinned here is the line it must not cross: a card inside the range
 * `CodeView` itself counts as drawn is `CodeView`'s to release, even when it
 * sits outside the window for a moment, which happens while heights settle.
 * Releasing one of those had the viewer draw it again on the next frame, and
 * a card being released and redrawn over and over is one nobody can click.
 */

import { describe, expect, it, vi } from 'vitest';
import { releaseStrandedCards } from './strandedCards';

/** A record as `CodeView` keeps one: where it is, and its element if drawn. */
const record = (index: number, top: number, drawn: boolean) => ({
  index,
  top,
  height: 100,
  element: drawn ? document.createElement('div') : undefined,
});

function viewer(items: ReturnType<typeof record>[], firstIndex: number, lastIndex: number) {
  const releaseRenderedItem = vi.fn(function (this: unknown, item: { element: unknown }) {
    item.element = undefined;
  });
  return {
    items,
    renderState: { firstIndex, lastIndex },
    windowSpecs: { top: 1000, bottom: 1600 },
    releaseRenderedItem,
  };
}

describe('releaseStrandedCards', () => {
  it('releases a card drawn outside both the window and the drawn range', () => {
    const items = [record(0, 0, true), record(1, 1100, true), record(2, 1200, true)];
    const view = viewer(items, 1, 2);

    expect(releaseStrandedCards(view)).toBe(1);
    expect(view.releaseRenderedItem).toHaveBeenCalledWith(items[0]);
  });

  it('leaves a card inside the drawn range alone, even outside the window', () => {
    // Heights above it grew after the window was measured, so for a moment
    // it sits past the window's foot. It is still the viewer's card.
    const items = [record(0, 1100, true), record(1, 1700, true)];
    const view = viewer(items, 0, 1);

    expect(releaseStrandedCards(view)).toBe(0);
    expect(view.releaseRenderedItem).not.toHaveBeenCalled();
  });

  it('leaves cards in the window alone, wherever they are in the list', () => {
    const items = [record(0, 0, false), record(1, 1100, true), record(2, 1300, true)];
    const view = viewer(items, 1, 1);

    expect(releaseStrandedCards(view)).toBe(0);
  });

  it('does nothing against a viewer laid out some other way', () => {
    expect(releaseStrandedCards({})).toBe(0);
    expect(releaseStrandedCards(undefined)).toBe(0);
  });
});
