/**
 * The scroll range the viewer does not know it owes, and why it is a guess.
 *
 * `computeApproximateSize` in `VirtualizedFileDiff` adds one global header
 * metric — 44px — and, if the item is collapsed, *returns there*. There is no
 * per-item height input anywhere in the options, and 1.4.1 does not change it.
 * Anything a card renders in its header beyond that 44px is scroll range the
 * viewer does not know about, and the error shows up twice: it accumulates
 * until the last card cannot be brought to the top of the column, and the
 * column *lurches* by a card's whole shortfall each time it releases one while
 * scrolling.
 *
 * **Most of that is now fixed at the source.** Everything whose height depends
 * on the file — the comparison, the notices, the threads the diff cannot show —
 * moved out of the header and into a file-level annotation, which the library
 * *does* measure and fold into the item. Measured on the browser fixture,
 * before and after, on the same walk:
 *
 * | | header | lurch on release |
 * | --- | --- | --- |
 * | plain source file | 44 → 44 | 57 → 57 |
 * | a file with listed threads | 92 → 44 | — |
 * | rendered Markdown | 166 → 70 | 147 → 67 |
 * | an image | 126 → 70 | 107 → 67 |
 *
 * Two things are left, and neither is a header this file can do anything about.
 * A card with a mode switcher is 70px rather than 44 — the switcher is a second
 * row, and it stays in the header because a collapsed card still has to offer
 * it. And a plain text card lurches by ~57px with a header that is *exactly*
 * the metric, which is the library's own line-height estimate rather than
 * anything of ours; it was there before any of this and is untouched by it.
 *
 * So this is what is left of the workaround. With it removed entirely the last
 * card of the fixture settles 311px down a 628px scrollport — readable, which
 * it was not before (627px, only its top edge), but not reachable. The estimate
 * below buys that back.
 *
 * **It is an estimate rather than a measurement, and that is now a choice.**
 * Through 1.3.6 it was forced: `reconcileHost` re-measured the footer only when
 * the render callback's identity changed, the React wrapper pins that callback
 * to a stable internal `noopRender`, and `handleResize` dropped every entry
 * that was not the sticky container — so a tail that grew after mount was
 * ignored. 1.4.1 fixed that; growing this tail by 940px after mount now moves
 * `scrollHeight` and the scroll reaches the new end. What is left to measure is
 * small enough that counting the file list at mount is the simpler answer.
 *
 * Pure, like everything under `lib/`: a count in, a number of pixels out.
 */

/**
 * What one rich card costs the viewer, in pixels, over a plain one.
 *
 * Re-derived on 2026-09-07, down from 140. Two measured terms: the mode
 * switcher makes a rich card's header 70px against the 44px metric, and the
 * library's own line-height estimate costs about 57px per text card released,
 * which this has always been absorbing without saying so. Neither is per rich
 * card, and a count of rich cards is the only signal available before anything
 * has rendered — so this is that arithmetic spread over the term that can
 * actually be counted.
 *
 * Deliberately at the top of the range rather than the middle. Slack costs a
 * little empty space below the last card, which nobody notices; a shortfall
 * costs the last file of the review. When the two errors are not symmetric,
 * neither should the estimate be.
 */
export const RICH_CARD_EXCESS = 100;

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

/**
 * The tallest a card header may be, in pixels.
 *
 * `CodeView` models every header at 44px and never measures it, so a header
 * taller than that is scroll range the viewer does not know it owes — see
 * above. 44 is the head row: the name, the counts, the controls, the viewed
 * box. 70 is that plus the mode switcher's row, which stays in the header
 * because a collapsed card still has to offer it. This is 72, which is those
 * two plus a couple of pixels of rounding and nothing else.
 *
 * It is a budget rather than a description, and it is checked in a browser
 * because jsdom performs no layout and would report every one of these as zero.
 * Anything that puts a comparison, a notice or a list of threads back into the
 * header will exceed it, and that is the whole point: those belong in
 * `ui/FileBody.tsx`, where the library measures them.
 */
export const HEADER_BUDGET = 72;
