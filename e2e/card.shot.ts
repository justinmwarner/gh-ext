/**
 * Captures the injected card, for looking at while designing it.
 *
 * Not a test. Same harness as the store screenshots, so what it captures is
 * the real component in a real browser on the page it actually lives on,
 * rather than a mockup that can drift from it.
 *
 * Run with `npm run shots:card`.
 */

import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test as extensionTest } from './extension';

const OUT = 'store/card';
mkdirSync(OUT, { recursive: true });

const PR_URL = 'https://github.com/acme/widgets/pull/42';
const card = '#a-better-reviewer-card';

/**
 * How much of the page around the card to keep.
 *
 * Enough for its drop shadow and the green cast under it. `locator.screenshot`
 * clips to the element's own box, which cuts both off — and the shadow is half
 * of what separates this from a flat rectangle taped to the corner.
 */
const MARGIN = 28;

/** The card and the page immediately around it, so the shadow survives. */
async function shoot(page: Page, path: string): Promise<void> {
  const box = await page.locator(card).boundingBox();
  if (box === null) throw new Error('the card has no box to photograph');

  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - MARGIN),
      y: Math.max(0, box.y - MARGIN),
      width: box.width + MARGIN * 2,
      height: box.height + MARGIN * 2,
    },
  });
}

for (const scheme of ['light', 'dark'] as const) {
  extensionTest(`card ${scheme}`, async ({ context, api }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(PR_URL);

    const host = page.locator(card);
    await expect(host).toBeVisible({ timeout: 10_000 });
    // The card animates in; capture it settled rather than mid-transition.
    await page.waitForTimeout(1200);
    await shoot(page, `${OUT}/expanded-${scheme}.png`);

    await page.getByRole('button', { name: /collapse/i }).click();
    await page.waitForTimeout(1200);
    await shoot(page, `${OUT}/collapsed-${scheme}.png`);

    void api;
  });
}
