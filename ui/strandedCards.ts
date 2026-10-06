/**
 * Cards a reorder left drawn after it took them out of view, released.
 *
 * A bug in `@pierre/diffs` 1.4.1, worked around here rather than lived with.
 * After its items change order, `CodeView` releases the cards it had drawn by
 * walking its *old* range of positions over the *new* order. A drawn card that
 * moved past that range is never visited, so it is never released. Its element
 * stays at the bottom of the block of drawn cards, without its header. The
 * block is then taller than the height `CodeView` computed its sticky insets
 * from, and the bottom inset pulls every drawn card up by the difference. In
 * the e2e fixture, undoing "Most changed first" moved the line being read up
 * by 149px, which is exactly what the reorder was supposed to leave alone.
 *
 * The repair is `CodeView`'s own test, applied to the cards its own pass will
 * never visit. A card outside the range `CodeView` counts as drawn, and outside
 * the window it has just laid out, is released, through the same method
 * `CodeView` uses to release one. A card *inside* that range is left alone
 * even when it falls outside the window, which happens for a frame while
 * heights settle: it is `CodeView`'s to release. Releasing one of those had it
 * drawn again on the next frame, and a card released and redrawn over and over
 * is one nobody can click. Run this after `CodeView` has drawn the new order.
 * The React wrapper does that synchronously, in its own layout effect, so a
 * layout effect in the column runs after it and before the browser paints. No
 * frame with the stranded card is ever shown.
 *
 * Everything it touches is private to `CodeView`, so all of it is checked
 * before use. Against a version laid out differently this does nothing, and
 * the bug, if still there, shows again: the e2e tests on reordering are what
 * would say so. `docs/reference/pierre-diffs-api.md` has the details.
 */

/** As much of a `CodeView` record as this reads. */
interface Drawable {
  index: number;
  top: number;
  height: number;
  element: HTMLElement | undefined;
}

/** As much of `CodeView` as this reads. Private there, so typed loosely here. */
interface Internals {
  items?: unknown;
  windowSpecs?: { top?: unknown; bottom?: unknown };
  renderState?: { firstIndex?: unknown; lastIndex?: unknown };
  releaseRenderedItem?: unknown;
}

const isDrawable = (value: unknown): value is Drawable =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Drawable).index === 'number' &&
  typeof (value as Drawable).top === 'number' &&
  typeof (value as Drawable).height === 'number';

/**
 * Release every card drawn outside the window `CodeView` last laid out.
 *
 * Returns how many it released: none, on every change that is not a reorder
 * of drawn cards, which is almost all of them.
 */
export function releaseStrandedCards(instance: object | undefined): number {
  const view = instance as Internals | undefined;
  const items = view?.items;
  const top = view?.windowSpecs?.top;
  const bottom = view?.windowSpecs?.bottom;
  const first = view?.renderState?.firstIndex;
  const last = view?.renderState?.lastIndex;
  const release = view?.releaseRenderedItem;
  if (
    !Array.isArray(items) ||
    typeof top !== 'number' ||
    typeof bottom !== 'number' ||
    typeof first !== 'number' ||
    typeof last !== 'number' ||
    typeof release !== 'function'
  ) {
    return 0;
  }

  let released = 0;
  for (const item of items) {
    if (!isDrawable(item) || item.element === undefined) continue;
    // Inside the range `CodeView` counts as drawn: its own pass sees to it.
    if (first !== -1 && item.index >= first && item.index <= last) continue;
    // `CodeView`'s own condition for keeping a card drawn, word for word.
    if (item.top > top - item.height && item.top <= bottom) continue;
    release.call(view, item);
    released += 1;
  }
  return released;
}
