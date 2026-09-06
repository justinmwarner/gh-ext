/**
 * The scroll range the viewer does not know it owes, and why it is a guess.
 *
 * Two facts about `@pierre/diffs@1.3.6`, both read out of the shipped package
 * and both confirmed by measurement in Chrome. Neither is in its documentation.
 *
 * **A collapsed item is one global number.** `computeApproximateSize` in
 * `VirtualizedFileDiff` adds the header region and, if the item is collapsed,
 * *returns there* — before the measured correction the expanded path applies.
 * There is no per-item height input anywhere in the options. That is a fine
 * model for the library's own header, which is a fixed row, and wrong here:
 * this page renders a whole `FileCard` into the custom header slot, and for a
 * rich comparison that is the comparison itself. Measured on the browser
 * fixture, against the ~44px the metric assumes: a rendered Markdown card is
 * 153px, an image 126px, a table 179px. Every one is under-counted by the
 * difference, and the error accumulates downward until the last card cannot be
 * brought to the top of the column — 627px into a 628px scrollport, so the last
 * file of a review could not be read at all.
 *
 * **The footer is measured exactly once.** `renderCodeViewFooter` is the
 * library's own answer to a short column, and its height *is* included — but
 * `reconcileHost` re-measures only when the render callback's identity changes,
 * and the React wrapper pins that callback to a stable internal `noopRender`
 * and delivers the real content through a portal. So the height that counts is
 * whichever one the tail had when `CodeView` mounted, and a tail that grows
 * afterwards is ignored: the core goes on clamping scroll to the stale number.
 * Its `ResizeObserver` does observe the footer element and its handler drops
 * every entry that is not the sticky container.
 *
 * That second fact is the whole reason this is an estimate. Measuring the real
 * headers is easy and useless — they settle when their blobs arrive, long after
 * the only measurement that matters has been taken. What *is* known at mount is
 * how many cards will open on a rich comparison, because that follows from the
 * file list. So the tail is sized from a count, before anything has rendered.
 *
 * Pure, like everything under `lib/`: a count in, a number of pixels out.
 */

/**
 * What one rich card costs the viewer, in pixels, over a plain one.
 *
 * Deliberately at the top of the measured range rather than the middle. Slack
 * costs a little empty space below the last card, which nobody notices; a
 * shortfall costs the last file of the review, which is the defect this exists
 * to remove. When the two errors are not symmetric, neither should the estimate
 * be.
 */
export const RICH_CARD_EXCESS = 140;

/**
 * The most scroll range this will ever add, in pixels.
 *
 * Roughly two 1080p viewports. Paying the deficit is right, but a pull request
 * of two hundred screenshots would ask for a scroll region mostly made of
 * nothing, and a scrollbar that lies about how much there is to read is its own
 * defect. Past this the last cards get harder to reach again — which is the
 * honest failure, and the one a reviewer can at least see.
 */
export const TAIL_DEFICIT_CAP = 2400;

/**
 * How much taller than the viewer believes a column of this shape really is.
 *
 * `richCards` is how many files will open on a comparison rather than on a text
 * diff — the ones `codeViewItems` marks collapsed for that reason, and so the
 * ones whose headers carry a body the metric knows nothing about.
 */
export function tailDeficit(richCards: number): number {
  if (!Number.isFinite(richCards) || richCards <= 0) return 0;
  return Math.min(Math.round(richCards) * RICH_CARD_EXCESS, TAIL_DEFICIT_CAP);
}
