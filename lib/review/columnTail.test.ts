/**
 * How much scroll range the viewer owes the column.
 *
 * Two library facts make this necessary, and the second is why it is an
 * estimate rather than a measurement. `lib/review/columnTail.ts` has both.
 */

import { describe, expect, it } from 'vitest';
import { RICH_CARD_EXCESS, TAIL_DEFICIT_CAP, tailDeficit } from './columnTail';

describe('tailDeficit', () => {
  it('owes nothing for a column of ordinary source files', () => {
    // The shape the library's metric was tuned for. A column of plain cards is
    // counted correctly and must not grow slack it does not need.
    expect(tailDeficit(0)).toBe(0);
  });

  it('owes one card-worth of slack per rich card', () => {
    expect(tailDeficit(1)).toBe(RICH_CARD_EXCESS);
    expect(tailDeficit(4)).toBe(RICH_CARD_EXCESS * 4);
  });

  it('stops at the cap rather than inventing a column of empty space', () => {
    // A payload of two hundred images would otherwise ask for a scroll region
    // mostly made of nothing, and a scrollbar that lies about how much there is
    // to read is its own defect. Past the cap the last cards get harder to
    // reach again — the honest failure, and one the reviewer can see.
    expect(tailDeficit(1000)).toBe(TAIL_DEFICIT_CAP);
  });

  it('treats a nonsensical count as no rich cards at all', () => {
    // Callers derive this by counting a list. A negative would shorten the
    // tail below what an ordinary column needs, which is the one direction
    // that costs the reviewer something.
    expect(tailDeficit(-3)).toBe(0);
  });

  it('covers the whole column’s shortfall, not just one card’s header', () => {
    // Measured in Chrome on the browser fixture after the card bodies moved
    // into annotations: with this removed entirely the last card settles 311px
    // down a 628px scrollport, over four rich cards — so anything under about
    // 78 leaves it unreachable. A card's own header accounts for only 26 of
    // that (70px against the 44px metric, the mode switcher's row); the rest is
    // the library's line-height estimate on the text cards above it, which this
    // has always been absorbing.
    expect(RICH_CARD_EXCESS * 4).toBeGreaterThanOrEqual(311);
    // And not so far over that the column becomes mostly nothing. Four rich
    // cards should not buy a whole extra screen of empty space.
    expect(RICH_CARD_EXCESS * 4).toBeLessThan(628);
  });
});
