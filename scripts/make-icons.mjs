/**
 * Renders the extension icon to the sizes the manifest declares.
 *
 * Chromium rather than a raster library: Playwright is already a dependency
 * for the e2e suite, so this adds nothing to install, and an SVG rendered by
 * the same engine that will display it is the most honest preview available.
 *
 * Run with `npm run icons`. The source of truth is store/icon.svg.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 96, 128];
const svg = readFileSync('store/icon.svg', 'utf8');

const browser = await chromium.launch();
for (const size of SIZES) {
  // deviceScaleFactor 1 and a viewport exactly the icon's size, so the PNG is
  // the requested pixels rather than a scaled screenshot of something larger.
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <body style="margin:0">
       <div style="width:${size}px;height:${size}px">${svg}</div>
       <style>svg{width:100%;height:100%;display:block}</style>
     </body>`,
  );
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
  await page.close();
  console.log(`public/icon/${size}.png`);
}
await browser.close();
