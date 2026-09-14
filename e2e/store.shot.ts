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

import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { MARKDOWN_FILE } from './fixture';

/** The one file with a comment anchored inside a rendered hunk. */
const THREADED_FILE = 'src/app.ts';
import { PR, expect, reviewUrl, test as extensionTest } from './extension';

const OUT = 'store/screenshots';
/** The store takes 1280×800 or 640×400. */
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(OUT, { recursive: true });

test.use({ viewport: VIEWPORT });

/**
 * The lead screenshot, which is the one the store draws largest.
 *
 * Reached through the tree rather than taken where the page opens, and that is
 * the whole of what this function does differently from a `goto`. The column
 * and the tree share one order now, so the top of the column is
 * `assets/logo.png` — an image comparison above a CSV grid, which is a fine
 * thing to show third and a confusing thing to show first. `src/app.ts` is a
 * code diff with a comment anchored in it, which is the loop the extension
 * exists for and the one the listing copy promises.
 *
 * Shared by the light and dark shots so the pair is the same view twice, which
 * is the only reading of "the same in dark mode" worth uploading.
 */
async function reviewOnAThread(page: Page): Promise<void> {
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();

  await page.locator(`[data-path="${THREADED_FILE}"]`).click();
  await expect(page.locator(`[data-file-card="${THREADED_FILE}"]`)).toBeVisible();
  // The thread itself, rather than the card that holds it: it is an annotation
  // Pierre lays out inside the diff, so the card can be on screen a beat before
  // the comment in it is.
  await expect(page.locator('[data-thread="PRRT_anchored"]')).toBeVisible();
  // The highlighter finishes a beat after the card mounts, and a
  // half-highlighted diff is exactly the thing a listing should not show.
  await page.waitForTimeout(1500);
}

extensionTest('01 the review page', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(reviewUrl(extensionId));
  await reviewOnAThread(page);

  await page.screenshot({ path: `${OUT}/01-review.png` });
  void api;
});

extensionTest('02 the review page in dark mode', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(reviewUrl(extensionId));
  await reviewOnAThread(page);

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
