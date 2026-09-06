/**
 * The scroll range the viewer does not know it owes, and why it is a guess.
 *
 * Two facts about `@pierre/diffs`, both read out of the shipped package and
 * both confirmed by measurement in Chrome. Neither is in its documentation.
 * Only the first is still true.
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
 * difference, and the error shows up twice — it accumulates downward until the
 * last card cannot be brought to the top of the column, and it makes the
 * column lurch by a card's whole shortfall each time one is released while
 * scrolling. **Unchanged in 1.4.1**, which is why this file still exists.
 *
 * **The footer used to be measured exactly once.** Through 1.3.6,
 * `reconcileHost` re-measured only when the render callback's *identity*
 * changed, and the React wrapper pins that callback to a stable internal
 * `noopRender` and delivers the real content through a portal; `handleResize`
 * then dropped every observer entry that was not the sticky container. So the
 * height that counted was whichever one the tail had when `CodeView` mounted,
 * and a tail that grew afterwards was ignored. That is why the slack below is
 * *estimated from the file list* rather than measured from the headers as they
 * settle: the measurement arrived long after the only reading that counted.
 *
 * **1.4.1 fixed it.** `handleResize` gained a branch for the header and footer
 * host elements that calls `setHostHeight(host, blockSize)`. Measured on the
 * fixture: growing this tail by 940px after mount took `scrollHeight` from
 * 5,018 to 5,958 and the scroll actually reached the new end. So the estimate
 * below is no longer *forced* — a `ResizeObserver` over the mounted headers
 * could now set the true shortfall instead of a per-card guess, and would suit
 * a two-line Markdown file and a forty-row CSV rather than splitting the
 * difference. That is a change worth making deliberately, not as a side
 * effect of a dependency bump, so it has not been made yet.
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
