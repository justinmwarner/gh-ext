/**
 * The Chrome Web Store promotional tiles.
 *
 * Not a test, and — unlike `store.shot.ts` — not a photograph of the product
 * either. The store shows these at a few hundred pixels wide in a grid beside
 * other extensions, where a screenshot of a diff is an illegible grey smear.
 * So these are drawn: the extension's own mark, its name, one line, and a hint
 * of a file list that says "this is about reading changes" without asking
 * anybody to read it.
 *
 * Generated rather than hand-made for the same reason the screenshots are. The
 * two sizes are one design at two scales, and keeping them in one template is
 * what stops the marquee drifting away from the small tile the next time either
 * is touched.
 *
 * The colours are the product's: `#0d1117` behind everything, and the mark's
 * three bars in the added/removed/unchanged green, red and grey that
 * `store/icon.svg` and the injected card both use.
 *
 * Run with `npm run promo`.
 */

import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';

const OUT = 'store/promo';

mkdirSync(OUT, { recursive: true });

/** The mark, at the size the tile wants it. Same geometry as `store/icon.svg`. */
const mark = (size: number): string => `
  <svg class="mark" width="${size}" height="${size}" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="28" fill="#161b22"/>
    <rect x="24" y="34" width="80" height="14" rx="7" fill="#3fb950"/>
    <rect x="24" y="58" width="52" height="14" rx="7" fill="#f85149"/>
    <rect x="24" y="82" width="66" height="14" rx="7" fill="#8b949e"/>
  </svg>`;

/**
 * A file list, reduced to the part that is legible from across a room.
 *
 * Path, then a green count and a red count. It is the shape of the product's
 * left rail rather than a copy of it — a real screenshot at this scale would be
 * texture, and texture is what every other tile in the grid already is.
 *
 * Only drawn on the marquee. At 440×280 there is no room for it that does not
 * come out of the name.
 */
const FILES: [string, string, string][] = [
  ['lib/cache.ts', '+4', '−0'],
  ['src/app.ts', '+1', '−1'],
  ['lib/memo.ts', '+0', '−3'],
  ['docs/readme.md', '+2', '−1'],
];

const fileList = (): string => `
  <ul class="files">
    ${FILES.map(
      ([path, added, removed]) => `
      <li>
        <span class="path">${path}</span>
        <span class="added">${added}</span>
        <span class="removed">${removed}</span>
      </li>`,
    ).join('')}
  </ul>`;

interface Tile {
  name: string;
  width: number;
  height: number;
  /** The tile's own layout, on top of the shared look below. */
  css: string;
  body: string;
}

/**
 * Shared by both sizes, so they read as one family.
 *
 * The two radial blooms and the lit top edge are the same devices the injected
 * card uses — a reviewer who has seen the card should recognise the tile.
 */
const BASE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    background: #0d1117;
    color: #e6edf3;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* Lit from the top left in the brand's green, cooling to blue across the
     tile. Behind everything, so no text sits on a colour it did not choose. */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(63, 185, 80, 0.22), transparent 55%),
      radial-gradient(120% 140% at 100% 100%, rgba(56, 139, 253, 0.18), transparent 55%);
  }
  body::after {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(90deg, #3fb950, #388bfd 60%, transparent);
    opacity: 0.7;
  }
  .inner { position: relative; display: flex; align-items: center; width: 100%; }
  .words { min-width: 0; }
  h1 { font-weight: 650; letter-spacing: -0.02em; line-height: 1.05; }
  p { color: #9198a1; }
  .files { list-style: none; }
  .files li {
    display: flex;
    align-items: baseline;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    border-bottom: 1px solid #21262d;
  }
  .path { flex: 1 1 auto; color: #c9d1d9; }
  .added { color: #3fb950; }
  .removed { color: #f85149; }
`;

const TILES: Tile[] = [
  {
    // Required for any kind of featuring, and the one that is actually seen.
    name: 'small-promo-440x280',
    width: 440,
    height: 280,
    css: `
      .inner { flex-direction: column; align-items: flex-start; gap: 18px; padding: 34px 36px; }
      h1 { font-size: 38px; }
      p { font-size: 16px; margin-top: 8px; }
    `,
    body: `
      <div class="inner">
        ${mark(64)}
        <div class="words">
          <h1>A Better<br>Reviewer</h1>
          <p>Read pull requests, fast.</p>
        </div>
      </div>`,
  },
  {
    // Only shown if the store decides to marquee the listing, which is why it
    // can afford the file list: it is never rendered small.
    name: 'marquee-promo-1400x560',
    width: 1400,
    height: 560,
    css: `
      .inner { gap: 48px; padding: 0 64px; }
      .words { flex: 1 1 auto; }
      .mark { flex: 0 0 auto; }
      /* Both on one line each. Sized to the column rather than to taste: the
         name breaking after "A Better" reads as two products, and a tagline
         that wraps after "pull" leaves "requests." alone on a line. */
      h1 { font-size: 66px; white-space: nowrap; }
      p { font-size: 28px; margin-top: 16px; white-space: nowrap; }
      .files { flex: 0 0 380px; }
      .files li { gap: 20px; padding: 16px 4px; font-size: 20px; }
      .files li:last-child { border-bottom: 0; }
    `,
    body: `
      <div class="inner">
        ${mark(132)}
        <div class="words">
          <h1>A Better Reviewer</h1>
          <p>A fast review UI for GitHub pull requests.</p>
        </div>
        ${fileList()}
      </div>`,
  },
];

for (const tile of TILES) {
  test(tile.name, async ({ page }) => {
    await page.setViewportSize({ width: tile.width, height: tile.height });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>${BASE}${tile.css}</style>${tile.body}`,
    );
    // The web fonts are the system's, so there is nothing to wait on but
    // layout. One frame is enough and a timeout would only make this slower.
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/${tile.name}.png` });
  });
}
