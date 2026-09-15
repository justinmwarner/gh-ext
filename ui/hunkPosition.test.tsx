/**
 * Where the reviewer actually is, measured rather than hit-tested.
 *
 * `CodeView` keeps its item offsets private, and `DiffColumn` already documents
 * that the model behind them is permanently wrong about our card headers — it
 * sizes every one from a 44px metric and never measures one. So the position is
 * read off the rows the card really drew.
 *
 * **Why there is no `elementFromPoint` here.** That was the first design and it
 * is gone. Measured in Chrome against the production build: called from the
 * animation frame after a scroll event it resolves the virtualizer's content
 * wrapper rather than a card, because Pierre has recycled the old rows out and
 * not yet put the new ones in; the identical call once the page is at rest
 * resolves the card every time. It therefore passed every check made by hand
 * and failed in the only frame that matters — silently, with the coarse
 * fallback covering for it.
 *
 * jsdom performs no layout, so every rect below is supplied. What that leaves
 * in reach is the whole of the decision-making — which row answers for a
 * height, and which way a reading rounds when it cannot see — and the rule
 * those obey is a product decision rather than a geometric one: **a reading
 * that cannot see must over-report what is below, never under-report it.**
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { HunkStop } from '@/lib/review/hunkNav';
import { cardAt, probeLine, readCursor, rowTop } from './hunkPosition';

const STOPS: readonly HunkStop[] = [
  { path: 'a.ts', side: 'additions', line: 10 },
  { path: 'a.ts', side: 'additions', line: 50 },
  { path: 'a.ts', side: 'additions', line: 90 },
  { path: 'b.ts', side: 'additions', line: 4 },
];

interface RowSpec {
  line: number | null;
  top: number;
  height?: number;
}

const rect = (top: number, height: number): DOMRect =>
  ({ top, bottom: top + height, height, left: 0, right: 800, width: 800 }) as DOMRect;

/**
 * A mounted card: a `<diffs-container>`, the header the column renders into it,
 * and rows in its shadow root at known heights.
 *
 * `diffs-container` is a real custom element — `testSetup` imports
 * `@pierre/diffs`, which defines it — and its constructor has already attached
 * a shadow root by the time `createElement` returns, so attaching a second one
 * throws.
 */
function card(
  path: string,
  rows: readonly RowSpec[],
  span: { top: number; height: number } = { top: 0, height: 400 },
): HTMLElement {
  const host = document.createElement('diffs-container');
  host.getBoundingClientRect = () => rect(span.top, span.height);

  const header = document.createElement('div');
  header.setAttribute('data-file-card', path);
  host.append(header);
  document.body.append(host);

  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  for (const spec of rows) {
    const row = document.createElement('div');
    if (spec.line !== null) row.setAttribute('data-line', String(spec.line));
    const height = spec.height ?? 20;
    row.getBoundingClientRect = () => rect(spec.top, height);
    root.append(row);
  }

  return header;
}

/** The map `DiffColumn` keeps, built from the cards a test mounted. */
const headersOf = (...entries: [string, HTMLElement][]): Map<string, HTMLElement> =>
  new Map(entries);

/** jsdom reports every element as zero-sized, so the edges are handed in. */
function scroller(top: number, bottom: number): HTMLElement {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => rect(top, bottom - top);
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('probeLine', () => {
  it('reads the line the card draws at that height', () => {
    const header = card('a.ts', [
      { line: 10, top: 40 },
      { line: 11, top: 60 },
      { line: 12, top: 80 },
    ]);

    expect(probeLine(headersOf(['a.ts', header]), 'a.ts', 65)).toEqual({
      path: 'a.ts',
      line: 11,
    });
  });

  it('holds the row above when the height lands in a dead band', () => {
    // Directly under the pinned card header sits a hunk separator — measured
    // at about 36px in Chrome — with no `data-line` anywhere in it. Rounding
    // *forward* through that gap would call the next section read before the
    // reviewer had seen it, and would under-report what is left below.
    const header = card('a.ts', [
      { line: 10, top: 0 },
      { line: 50, top: 60 },
    ]);

    expect(probeLine(headersOf(['a.ts', header]), 'a.ts', 30)).toEqual({
      path: 'a.ts',
      line: 10,
    });
  });

  it('takes the first row when the height is above all of them', () => {
    const header = card('a.ts', [
      { line: 10, top: 100 },
      { line: 11, top: 120 },
    ]);

    expect(probeLine(headersOf(['a.ts', header]), 'a.ts', 4)).toMatchObject({ line: 10 });
  });

  it('takes the last row when the height is below all of them', () => {
    const header = card('a.ts', [
      { line: 10, top: 0 },
      { line: 11, top: 20 },
    ]);

    expect(probeLine(headersOf(['a.ts', header]), 'a.ts', 900)).toMatchObject({
      line: 11,
    });
  });

  it('finds nothing in a card that draws no numbered rows at all', () => {
    // A rendered Markdown card, an image, a table. Real and common: measured
    // in Chrome, a .md file in its rendered mode has no `data-line` anywhere
    // in it, and the coarse fallback is the right answer there.
    const header = card('a.ts', [{ line: null, top: 10 }]);

    expect(probeLine(headersOf(['a.ts', header]), 'a.ts', 10)).toBeNull();
  });

  it('finds nothing for a file whose card is not mounted', () => {
    expect(probeLine(headersOf(), 'a.ts', 10)).toBeNull();
  });

  it('finds nothing when asked about no file at all', () => {
    const header = card('a.ts', [{ line: 10, top: 0 }]);
    expect(probeLine(headersOf(['a.ts', header]), null, 10)).toBeNull();
  });

  it('finds nothing through a header that has been unmounted', () => {
    // Virtualization detaches a card as it leaves the viewport, and the map
    // outlives the node by a render.
    const header = card('a.ts', [{ line: 10, top: 0 }]);
    document.body.replaceChildren();

    expect(probeLine(headersOf(['a.ts', header]), 'a.ts', 10)).toBeNull();
  });
});

describe('rowTop', () => {
  it('measures where a numbered row actually sits', () => {
    const header = card('a.ts', [
      { line: 10, top: 40 },
      { line: 50, top: 120 },
    ]);

    expect(rowTop(headersOf(['a.ts', header]), 'a.ts', 50)).toBe(120);
  });

  it('measures nothing for a row the card is not currently drawing', () => {
    // Virtualization: a line far outside the viewport has no element at all,
    // and the correction loop has to stop rather than correct towards a guess.
    const header = card('a.ts', [{ line: 10, top: 40 }]);

    expect(rowTop(headersOf(['a.ts', header]), 'a.ts', 900)).toBeNull();
  });

  it('measures nothing through a card that is not mounted', () => {
    expect(rowTop(headersOf(), 'a.ts', 10)).toBeNull();
  });
});

describe('cardAt', () => {
  it('names the card covering a height', () => {
    const a = card('a.ts', [], { top: 0, height: 100 });
    const b = card('b.ts', [], { top: 100, height: 100 });

    const headers = headersOf(['a.ts', a], ['b.ts', b]);
    expect(cardAt(headers, 50)).toBe('a.ts');
    expect(cardAt(headers, 150)).toBe('b.ts');
  });

  it('names nothing in the space past the last card', () => {
    const a = card('a.ts', [], { top: 0, height: 100 });
    expect(cardAt(headersOf(['a.ts', a]), 400)).toBeNull();
  });
});

describe('readCursor', () => {
  it('resolves the section at the top and what is left below it', () => {
    // One tall card, scrolled so the first hunk has gone up past the fold —
    // hence its negative top — the second is at the top of the scrollport, and
    // the third is on screen above the bottom edge.
    const header = card(
      'a.ts',
      [
        { line: 10, top: -100 },
        { line: 55, top: 0 },
        { line: 95, top: 120 },
      ],
      { top: -100, height: 500 },
    );

    expect(
      readCursor(scroller(0, 200), STOPS, 'a.ts', 0, headersOf(['a.ts', header])),
    ).toEqual({ index: 1, path: 'a.ts', below: 0 });
  });

  it('counts the sections of this file still under the fold', () => {
    const header = card(
      'a.ts',
      [
        { line: 12, top: 0 },
        { line: 55, top: 100 },
        { line: 95, top: 400 },
      ],
      { top: 0, height: 600 },
    );

    // Reading the first hunk; the second is on screen, the third is not.
    expect(
      readCursor(scroller(0, 200), STOPS, 'a.ts', 0, headersOf(['a.ts', header])),
    ).toMatchObject({ index: 0, below: 1 });
  });

  it('counts nothing below once the fold has passed into the next file', () => {
    const a = card('a.ts', [{ line: 95, top: 0 }], { top: 0, height: 100 });
    const b = card('b.ts', [{ line: 4, top: 120 }], { top: 100, height: 300 });

    expect(
      readCursor(scroller(0, 200), STOPS, 'a.ts', 0, headersOf(['a.ts', a], ['b.ts', b])),
    ).toMatchObject({ path: 'a.ts', below: 0 });
  });

  it('over-reports rather than under-reports when the fold sees no row', () => {
    // The rule. Everything below the *top* of the viewport is counted, which
    // is certainly at least as much as is below its bottom.
    const a = card('a.ts', [{ line: 12, top: 0 }], { top: 0, height: 50 });

    expect(
      readCursor(scroller(0, 200), STOPS, 'a.ts', 0, headersOf(['a.ts', a])),
    ).toMatchObject({ index: 0, below: 2 });
  });

  it('falls back to the topmost file when the card cannot be read', () => {
    expect(readCursor(scroller(0, 200), STOPS, 'a.ts', 0, headersOf())).toEqual({
      index: 0,
      path: 'a.ts',
      below: 2,
    });
  });

  it('knows nothing when it is told about no file and can see none', () => {
    expect(readCursor(scroller(0, 200), STOPS, null, 0, headersOf())).toEqual({
      index: -1,
      path: null,
      below: 0,
    });
  });

  it('names the first section while the reviewer is still above it', () => {
    // A file whose first change is two hundred lines down is the file this
    // whole feature is for. "No section" would blank the counter exactly there.
    const header = card('a.ts', [{ line: 2, top: 6 }], { top: 0, height: 400 });

    expect(
      readCursor(scroller(0, 200), STOPS, 'a.ts', 0, headersOf(['a.ts', header])),
    ).toMatchObject({ index: 0, below: 3 });
  });

  it('reads below the sticky header rather than at the very top edge', () => {
    // The header is pinned over the top of the scrollport — measured in
    // Chrome, one carrying a mode switcher covers 70px of it — so the row at
    // the true top edge is one the reviewer cannot see.
    const header = card(
      'a.ts',
      [
        { line: 10, top: 0 },
        { line: 55, top: 46 },
      ],
      { top: 0, height: 400 },
    );

    expect(
      readCursor(scroller(0, 200), STOPS, 'a.ts', 40, headersOf(['a.ts', header])),
    ).toMatchObject({ index: 1 });
  });
});
