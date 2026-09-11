/**
 * The Chrome Web Store screenshots.
 *
 * Not a test — nothing here asserts anything about behaviour. It drives the
 * real extension against the same fixtures the review suite uses and saves
 * what a reviewer would actually see, so the listing cannot drift from the
 * product the way hand-made mockups do.
 *
 * 1280×800 is one of the two sizes the store accepts, and the larger one.
 *
 * Run with `npm run screenshots`.
 */

import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { MARKDOWN_FILE } from './fixture';
import { PR, expect, reviewUrl, test as extensionTest } from './extension';

const OUT = 'store/screenshots';
/** The store takes 1280×800 or 640×400. */
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(OUT, { recursive: true });

test.use({ viewport: VIEWPORT });

extensionTest('01 the review page', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
  // The highlighter finishes a beat after the first card mounts, and a
  // half-highlighted diff is exactly the thing a listing should not show.
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT}/01-review.png` });
  void api;
});

extensionTest('02 the review page in dark mode', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT}/02-review-dark.png` });
  void api;
});

extensionTest('03 the options page', async ({ context, extensionId, api }) => {
  // Cleared so the page shows the setup walkthrough rather than the
  // already-configured panel, which is the screen a new install meets.
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as {
      chrome: { storage: { session: { remove(keys: string): Promise<void> } } };
    }).chrome;
    await chromeApi.storage.session.remove('github-token-unlocked');
  });

  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByLabel('GitHub fine-grained personal access token')).toBeVisible();

  await page.screenshot({ path: `${OUT}/03-options.png` });
  void api;
});

/**
 * Deliberately not a screenshot of the injected button on a pull request. The
 * harness serves a stubbed github.com, so that shot is a lone button on a
 * blank white page — worse than no screenshot at all. Capturing it against the
 * real github.com would need a real token and a real pull request, which is
 * not something a repeatable script should carry.
 */
extensionTest('04 the conversations view', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();

  await page.getByRole('tab', { name: /conversations/i }).click();
  await expect(page.locator('#review-view-conversations')).toBeVisible();
  await page.waitForTimeout(500);

  await page.screenshot({ path: `${OUT}/04-conversations.png` });
  void PR;
  void api;
});

/**
 * The rendered Markdown diff, with a Mermaid diagram drawn.
 *
 * Here because the rich comparisons are the part of this extension that has no
 * counterpart on github.com, and a listing of four code diffs says nothing
 * about them. `docs/readme.md` is the fixture's only real Markdown file, and it
 * carries two Mermaid fences precisely so a real browser has to draw them.
 */
extensionTest('05 the rendered Markdown diff', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();

  // Through the tree rather than by scrolling: the column is virtualised, so a
  // card far down it is not mounted until something takes the reviewer there.
  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();

  const body = page.locator(`[data-file-body="${MARKDOWN_FILE}"]`);
  await expect(body.locator('.markdown-rendered')).toBeVisible();
  // Mermaid resolves its chunk and measures text before it draws anything, so
  // the figure appearing is the only honest signal the diagram is on screen.
  await expect(body.locator('.md-diagram').first()).toBeVisible();
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT}/05-rendered-markdown.png` });
  void api;
});
