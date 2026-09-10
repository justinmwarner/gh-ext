/**
 * A walkthrough of the review page, recorded as video for the store listing.
 *
 * The Chrome Web Store does not take a video file — the listing field is a
 * **YouTube URL**, so this produces something to upload there rather than
 * something to upload to Google. It is a `.webm` at 1280×800, which is what
 * YouTube wants and the same shape as the screenshots beside it.
 *
 * Driven against the real extension and the same fixtures as the review suite,
 * for the reason `store.shot.ts` gives: a hand-made demo drifts from the
 * product and nobody notices until a reviewer does.
 *
 * Paced deliberately slowly. Every wait here is a beat somebody watching needs
 * — a cursor that jumps between four screens in two seconds shows a viewer
 * nothing they can follow, and this is the one artifact whose whole job is to
 * be followed.
 *
 * Skipped unless `TOUR_VIDEO` names a directory, because recording is a
 * property of the browser context and turning it on costs every other test in
 * the suite. `npm run tour` sets it.
 */

import { mkdirSync } from 'node:fs';
import { PR, expect, reviewUrl, test as extensionTest } from './extension';
import { REINDENTED_FILE } from './fixture';

const OUT = 'store/video';
const RAW = process.env.TOUR_VIDEO;

/** Long enough to read what just changed, short enough not to drag. */
const BEAT = 1_100;

extensionTest('the tour', async ({ context, extensionId, api }) => {
  extensionTest.skip(
    RAW === undefined,
    'recording is opt-in — run `npm run tour`, which sets TOUR_VIDEO',
  );
  void api;
  mkdirSync(OUT, { recursive: true });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(reviewUrl(extensionId));

  // Open on the diff, highlighted. The first beat is the whole pitch: this is
  // a pull request, and it is already readable.
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
  await page.waitForTimeout(2_000);

  // The tree moves the column. Two files, so it reads as navigation rather
  // than as one lucky click.
  await page.locator('[data-path="src/beta.ts"]').click();
  await page.waitForTimeout(BEAT);
  await page.locator(`[data-path="${REINDENTED_FILE}"]`).click();
  await page.waitForTimeout(BEAT);
  await page.locator('[data-path="src/app.ts"]').click();
  await page.waitForTimeout(BEAT);

  // Writing a comment, through the keyboard path the product is built around:
  // choose a line, press `c`.
  const gutter = page
    .locator('diffs-container')
    .first()
    .locator('[data-column-number][data-line-type="change-addition"]')
    .first();
  await gutter.click();
  await page.waitForTimeout(600);
  await page.locator('body').press('c');

  const box = page.getByRole('textbox', { name: /comment on src\/app\.ts/i });
  await expect(box).toBeVisible();
  await page.waitForTimeout(500);
  // Typed rather than filled, so the video shows a person writing.
  await box.pressSequentially('Can this allocation move out of the loop?', {
    delay: 45,
  });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(
    page.getByText('Can this allocation move out of the loop?').last(),
  ).toBeVisible();
  await page.waitForTimeout(BEAT + 400);

  // The other two views. Conversations is the one a reviewer comes back to,
  // so it gets the longer beat.
  await page.getByRole('tab', { name: /conversations/i }).click();
  await page.waitForTimeout(BEAT + 500);
  await page.getByRole('tab', { name: /overview/i }).click();
  await page.waitForTimeout(BEAT + 500);
  await page.getByRole('tab', { name: /^files$/i }).click();
  await page.waitForTimeout(BEAT);

  // And out on the diff, which is where the reviewer spends their time.
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1_600);

  void PR;

  // `saveAs` resolves once the recording is flushed, and the page has to be
  // closed for that to happen. Without this the file keeps the random name
  // Playwright gives it and lands wherever `TOUR_VIDEO` pointed.
  const video = page.video();
  await page.close();
  if (video !== null) await video.saveAs(`${OUT}/tour-1280x800.webm`);
});
