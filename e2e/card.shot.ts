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
import { expect, test as extensionTest } from './extension';

const OUT = 'store/card';
mkdirSync(OUT, { recursive: true });

const PR_URL = 'https://github.com/acme/widgets/pull/42';
const card = '#a-better-reviewer-card';

for (const scheme of ['light', 'dark'] as const) {
  extensionTest(`card ${scheme}`, async ({ context, api }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(PR_URL);

    const host = page.locator(card);
    await expect(host).toBeVisible({ timeout: 10_000 });
    // The card animates in; capture it settled rather than mid-transition.
    await page.waitForTimeout(600);
    await host.screenshot({ path: `${OUT}/expanded-${scheme}.png` });

    await page.getByRole('button', { name: /collapse/i }).click();
    await page.waitForTimeout(600);
    await host.screenshot({ path: `${OUT}/collapsed-${scheme}.png` });

    void api;
  });
}
