/**
 * Captures the pull request dashboard, for looking at while designing it.
 *
 * Not a test. Same harness as the other shots, so what lands on disk is the
 * real component in a real browser rendered out of the production bundle,
 * rather than a mockup that can drift from it.
 *
 * Both modes, because the palette is half the design and a light-only
 * screenshot hides every place a `light-dark()` pair was forgotten.
 *
 * Run with `npm run shots:dashboard`.
 */

import { mkdirSync } from 'node:fs';
import { dashboardUrl, expect, test } from './extension';

/**
 * The dashboard reads nothing until a repository is opted in, so a shot of it
 * has to opt in first or it captures the picker instead.
 */
async function watch(context: {
  serviceWorkers(): { evaluate(fn: (names: string[]) => Promise<void>, arg: string[]): Promise<void> }[];
}): Promise<void> {
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async (names: string[]) => {
    const api = (globalThis as unknown as {
      chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    }).chrome;
    await api.storage.local.set({ settings: { watchedRepos: names } });
  }, ['acme/widgets', 'acme/gears']);
}

const OUT = 'store/dashboard';
mkdirSync(OUT, { recursive: true });

for (const scheme of ['light', 'dark'] as const) {
  test(`the dashboard, ${scheme}`, async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
    // Every bucket drawn before the shutter, or the shot is of a half-built
    // list and says nothing about the spacing between sections.
    await expect(page.getByRole('heading', { name: /drafts/i })).toBeVisible();

    await page.screenshot({ path: `${OUT}/dashboard-${scheme}.png`, fullPage: true });
  });
}
