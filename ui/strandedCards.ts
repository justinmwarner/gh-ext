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
 * The repair is `CodeView`'s own test, applied to every card instead of only
 * the old range. A card stays drawn if its box touches the window `CodeView`
 * has just laid out, and is released otherwise, through the same method
 * `CodeView` uses to release one. Run it after `CodeView` has drawn the new
 * order. The React wrapper does that synchronously, in its own layout effect,
 * so a layout effect in the column runs after it and before the browser
 * paints. No frame with the stranded card is ever shown.
 *
 * Everything it touches is private to `CodeView`, so all of it is checked
 * before use. Against a version laid out differently this does nothing, and
 * the bug, if still there, shows again: the e2e tests on reordering are what
 * would say so. `docs/reference/pierre-diffs-api.md` has the details.
 */

/** As much of a `CodeView` record as this reads. */
interface Drawable {
  top: number;
  height: number;
  element: HTMLElement | undefined;
}

/** As much of `CodeView` as this reads. Private there, so typed loosely here. */
interface Internals {
  items?: unknown;
  windowSpecs?: { top?: unknown; bottom?: unknown };
  releaseRenderedItem?: unknown;
}

const isDrawable = (value: unknown): value is Drawable =>
  typeof value === 'object' &&
  value !== null &&
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
  const release = view?.releaseRenderedItem;
  if (
    !Array.isArray(items) ||
    typeof top !== 'number' ||
    typeof bottom !== 'number' ||
    typeof release !== 'function'
  ) {
    return 0;
  }

  let released = 0;
  for (const item of items) {
    if (!isDrawable(item) || item.element === undefined) continue;
    // `CodeView`'s own condition for keeping a card drawn, word for word.
    if (item.top > top - item.height && item.top <= bottom) continue;
    release.call(view, item);
    released += 1;
  }
  return released;
}
