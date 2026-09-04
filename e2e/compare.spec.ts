/**
 * The rich comparisons, in a real browser.
 *
 * Everything about this feature that could be tested in jsdom already is. What
 * is left is the part jsdom cannot have an opinion about, and it is most of the
 * interesting part:
 *
 * - **An `<img>` that actually loads.** jsdom never fetches one and reports
 *   every image as zero by zero forever, so the whole chain — worker reads the
 *   blob, base64 across the message channel, `atob` on the page, `Blob`,
 *   `createObjectURL` — is unverified until a decoder has run on the other end.
 *   `naturalWidth` is the assertion that it did.
 * - **That the URL is not remote.** The rule this extension is built on is that
 *   the review page never fetches. An `<img src="https://…">` would break it
 *   silently, and would tell github.com the extension exists.
 * - **`mix-blend-mode` and `isolation`.** Neither is computed by jsdom, and the
 *   difference mode's whole promise — unchanged goes black — depends on the
 *   blend being contained by the stage rather than reaching the page behind it.
 * - **Layout under `position: sticky`.** Every one of these renders inside a
 *   card header, which Pierre positions.
 *
 * No request leaves the machine: `e2e/extension.ts` answers `api.github.com`
 * from the fixture and aborts anything it does not recognize.
 */

import { IMAGE_FILE, TABLE_FILE, expect, reviewUrl, test } from './extension';
import type { Locator, Page } from '@playwright/test';

const card = (page: Page, path: string): Locator =>
  page.locator(`[data-file-card="${path}"]`);

const modeButton = (page: Page, path: string, label: string): Locator =>
  card(page, path).getByRole('button', { name: label, exact: true });

async function openReview(page: Page, extensionId: string): Promise<void> {
  await page.goto(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
}

/**
 * Bring a card into view, through the tree.
 *
 * `CodeView` virtualizes: a card near the bottom of a sixteen-file column is
 * not in the document at all until the column has been scrolled to it, so it
 * cannot be scrolled *into* view — there is nothing to scroll. The tree row is
 * the affordance that moves the viewer.
 */
async function reach(page: Page, path: string): Promise<void> {
  await page.locator(`[data-path="${path}"]`).click();
  // Deliberately not asserted through `data-current-file`. These two files are
  // the last in the column, and a short card at the very bottom cannot be
  // scrolled to the top — so the scroll handler reports whichever card *is*
  // topmost and the tree selection moves back off it. That is the column
  // behaving as designed; what this helper needs is only that the card mounted.
  await expect(card(page, path)).toBeVisible();
}

test('an image is compared as pixels, from bytes that never touched the page', async ({
  context,
  extensionId,
  api,
}) => {
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, IMAGE_FILE);

  const images = card(page, IMAGE_FILE).locator('img');
  await expect(images).toHaveCount(2);

  // Every one of these came through the worker. A remote URL here would be a
  // fetch from the page, which is the one thing the architecture forbids.
  for (const src of await images.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLImageElement).src),
  )) {
    expect(src.startsWith('blob:')).toBe(true);
  }

  // Decoded, not merely assigned. jsdom cannot tell the difference; this can.
  await expect
    .poll(async () =>
      images.first().evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(8);

  // And the read really did go through GitHub's contents endpoint at both
  // commits, rather than being served from somewhere this test did not look.
  expect(api.urls.filter((url) => url.includes('logo.png')).length).toBeGreaterThan(1);
});

test('the difference blend is applied, and is contained by its own stage', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, IMAGE_FILE);

  await modeButton(page, IMAGE_FILE, 'Difference').click();

  const stage = card(page, IMAGE_FILE).locator('.image-stage');
  await expect(stage).toBeVisible();

  const computed = await stage.evaluate((node) => {
    const top = node.querySelector('.image-layer-top');
    return {
      isolation: getComputedStyle(node).isolation,
      blend: top === null ? null : getComputedStyle(top).mixBlendMode,
    };
  });

  // Without `isolate` the blend composites against whatever is painted behind
  // the card, and "anything unchanged goes black" stops being true.
  expect(computed.isolation).toBe('isolate');
  expect(computed.blend).toBe('difference');
});

test('the overlay modes put both images in one coordinate space', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, IMAGE_FILE);

  await modeButton(page, IMAGE_FILE, 'Onion skin').click();

  const boxes = await card(page, IMAGE_FILE)
    .locator('.image-layer')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));

  expect(boxes).toHaveLength(2);
  // Two images of the same size, anchored at the same corner, at the same
  // scale. This is the geometry jsdom reports as zero by zero.
  expect(boxes[0]?.width).toBeGreaterThan(0);
  expect(boxes[0]?.left).toBeCloseTo(boxes[1]?.left ?? -1, 1);
  expect(boxes[0]?.top).toBeCloseTo(boxes[1]?.top ?? -1, 1);
  expect(boxes[0]?.width).toBeCloseTo(boxes[1]?.width ?? -1, 1);
});

test('the swipe slider moves the seam with the keyboard', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, IMAGE_FILE);

  await modeButton(page, IMAGE_FILE, 'Swipe').click();

  const slider = card(page, IMAGE_FILE).getByRole('slider');
  await slider.focus();
  const before = await card(page, IMAGE_FILE)
    .locator('.image-layer-top')
    .evaluate((node) => getComputedStyle(node).clipPath);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  const after = await card(page, IMAGE_FILE)
    .locator('.image-layer-top')
    .evaluate((node) => getComputedStyle(node).clipPath);

  expect(before).not.toBe(after);
  expect(after).toContain('inset');
});

test('a table is drawn as a grid with the one changed cell marked', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, TABLE_FILE);

  const grid = card(page, TABLE_FILE).locator('.grid');
  await expect(grid).toBeVisible();

  // One cell moved: `bolt`'s quantity. The text diff has this as a whole line
  // removed and a whole line added.
  const changed = card(page, TABLE_FILE).locator('.grid-cell-changed');
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText('5');

  // The header row is a real <th> and it sticks, which is what makes a wide
  // export readable at all.
  await expect(grid.locator('thead th').nth(1)).toHaveText('part');
});

test('raw puts the ordinary diff back, in the same card', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, TABLE_FILE);

  await expect(card(page, TABLE_FILE).locator('.grid')).toBeVisible();

  await modeButton(page, TABLE_FILE, 'Raw').click();

  await expect(card(page, TABLE_FILE).locator('.grid')).toHaveCount(0);
  // Pierre's own rows, inside the shadow root the card's item owns.
  await expect
    .poll(async () =>
      page.evaluate((path) => {
        const container = document
          .querySelector(`[data-file-card="${path}"]`)
          ?.closest('diffs-container');
        return container?.shadowRoot?.querySelector('[data-column-number]') != null;
      }, TABLE_FILE),
    )
    .toBe(true);
});

test('the last card in the column can still be scrolled to the top', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, TABLE_FILE);

  await page.evaluate(() => {
    const view = document.querySelector('.diff-view') as HTMLElement | null;
    view?.scrollTo({ top: view.scrollHeight });
  });

  // Without the tail, `CodeView` stops with the last item's bottom level with
  // the scrollport and the top of that card — every control it has — is below
  // the fold with nowhere left to scroll. Measured in Chrome before the fix:
  // the header sat 23px past the edge and its buttons could not be clicked.
  const inside = await page.evaluate((path) => {
    const button = document
      .querySelector(`[data-file-card="${path}"]`)
      ?.querySelector('.mode-button');
    const view = document.querySelector('.diff-view');
    if (button == null || view == null) return false;
    const one = button.getBoundingClientRect();
    const two = view.getBoundingClientRect();
    return one.top >= two.top && one.bottom <= two.bottom;
  }, TABLE_FILE);

  expect(inside).toBe(true);
});

test('the switcher is reachable and operable from the keyboard', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await reach(page, IMAGE_FILE);

  const raw = modeButton(page, IMAGE_FILE, 'Raw');
  await raw.focus();
  await expect(raw).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(raw).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, IMAGE_FILE).getByRole('note')).toContainText(/binary/i);
});
