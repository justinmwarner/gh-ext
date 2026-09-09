/**
 * The review page, in a real browser, driving the production build.
 *
 * Everything else in this project is jsdom, which performs no layout at all.
 * Four things therefore have never been checked anywhere until here, and each
 * one is a place where "the unit tests pass" means nothing:
 *
 * - **The scroll to tree mapping.** `CodeView` keeps its item offsets private,
 *   so `topmostFile` measures the card headers we mounted — and Pierre wraps
 *   every item in a `position: sticky` container with a *negative* `top`.
 *   Whether those measured offsets order the way the heuristic assumes is a
 *   question only a layout engine can answer.
 * - **The scrollport itself.** `CodeView` binds its scroll listener to the
 *   element we hand it and virtualizes against its height.
 * - **`light-dark()`**, which jsdom never evaluates.
 * - **Real keyboard events**, as opposed to synthetic `KeyboardEvent`s.
 *
 * No request leaves the machine: `e2e/extension.ts` answers `api.github.com`
 * from a fixture and aborts anything it does not recognize.
 */

import { HEADER_BUDGET } from '@/lib/review/columnTail';
import { REACHED } from '@/ui/currentFile';
import {
  BASE_SHA,
  FILES,
  FIRST_SHA,
  IMAGE_FILE,
  MARKDOWN_FILE,
  PRIOR_SHA,
  TABLE_FILE,
  THREADS,
} from './fixture';
import { expect, reviewUrl, test } from './extension';
import type { BrowserContext, Page } from '@playwright/test';

/** The scrollport `CodeView` was handed. */
const VIEW = '.diff-view';

/**
 * The measured half of a card, which is a separate element from its header.
 *
 * `CodeView` sizes an item from one global header metric and never measures the
 * header, so everything whose height depends on the file is an annotation
 * instead — see `ui/FileBody.tsx` and `lib/review/columnTail.ts`.
 */
const fileBody = (page: Page, path: string) =>
  page.locator(`[data-file-body="${path}"]`);

/** Every view is mounted at once, so anything text-based has to be scoped. */
const filesView = (page: Page) => page.locator('#review-view-files');
const threadsView = (page: Page) => page.locator('#review-view-conversations');

const openView = (page: Page, name: RegExp) =>
  page.getByRole('tab', { name }).click();

async function openReview(page: Page, extensionId: string): Promise<void> {
  await page.goto(reviewUrl(extensionId));
  // The shell only renders once the worker has assembled the whole payload.
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
}

/** Where each mounted card header sits, relative to the top of the scrollport. */
async function cardTops(page: Page): Promise<{ path: string; top: number }[]> {
  return page.evaluate((selector) => {
    const view = document.querySelector(selector);
    const origin = view?.getBoundingClientRect().top ?? 0;
    return [...document.querySelectorAll('[data-file-card]')].map((element) => ({
      path: element.getAttribute('data-file-card') ?? '',
      top: element.getBoundingClientRect().top - origin,
    }));
  }, VIEW);
}

/**
 * Every scope control but the numbered strip lives behind one kebab, so
 * reaching one is two steps. Opening is idempotent: an item that refuses to
 * run — a disabled one — leaves the menu where it was.
 */
async function scopeMenuItem(page: Page, name: RegExp) {
  const kebab = page.getByRole('button', { name: /diff options/i });
  if ((await kebab.getAttribute('aria-expanded')) !== 'true') await kebab.click();
  return page.getByRole('menu').locator('.menu-item').filter({ hasText: name });
}

const chooseScope = async (page: Page, name: RegExp): Promise<void> => {
  await (await scopeMenuItem(page, name)).click();
};

/** Read a toggle's state, and leave the menu shut so it is not over the diff. */
async function scopeChecked(page: Page, name: RegExp, value: string): Promise<void> {
  await expect(await scopeMenuItem(page, name)).toHaveAttribute('aria-checked', value);
  await page.keyboard.press('Escape');
}

const currentFile = (page: Page) =>
  page.locator('.shell').getAttribute('data-current-file');

async function scrollTo(page: Page, top: number): Promise<void> {
  await page.evaluate(
    ([selector, value]) => {
      document.querySelector(selector as string)?.scrollTo({ top: value as number });
    },
    [VIEW, top] as const,
  );
  await page.waitForTimeout(120);
}

const PR_URL = 'https://github.com/acme/widgets/pull/42';

/** The card's own button, wherever the card happens to be. */
const cta = (page: Page) => page.getByRole('button', { name: 'Start a Better Review' });

test('opens the review from the card the content script injects', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The whole entry path, in order: the content script puts its card on a pull
  // request page, and the worker opens the review — which it has to do itself,
  // because a page on github.com cannot reach an extension resource that is not
  // web-accessible, and making review.html web-accessible would let github.com
  // fingerprint the extension.
  const page = await context.newPage();
  await page.goto(PR_URL);

  await expect(cta(page)).toBeVisible();

  const opened = context.waitForEvent('page');
  await cta(page).click();
  const review = await opened;

  await review.waitForURL(new RegExp(`^chrome-extension://${extensionId}/review\.html#`));
  expect(review.url()).toBe(reviewUrl(extensionId));
  await expect(review.locator('.shell')).toBeVisible();

  // And the pull request is still there behind it, which is the entire reason
  // a new tab is the default rather than replacing this one.
  expect(page.url()).toBe(PR_URL);
  await expect(cta(page)).toBeVisible();
});

test('puts the card on a pull request reached by soft navigation', async ({
  context,
  extensionId,
  api,
}) => {
  void extensionId;
  void api;
  // The regression test for the bug this card was built around.
  //
  // Chrome decides whether to inject a content script from the URL the document
  // was *loaded* at. While the script matched only `/*/*/pull/*`, arriving at a
  // pull request from the pull request list — a `pushState`, not a load — meant
  // the script was never injected and there was no entry point at all until the
  // reviewer happened to reload. Matching all of github.com is what fixes it,
  // and this is the only test that can tell the difference.
  const page = await context.newPage();
  await page.goto('https://github.com/acme/widgets/pulls');
  await expect(cta(page)).toHaveCount(0);

  await page.evaluate(() => history.pushState({}, '', '/acme/widgets/pull/42'));
  await expect(cta(page)).toBeVisible({ timeout: 10_000 });
});

test('reveals the review already open rather than opening a second', async ({
  context,
  extensionId,
  api,
}) => {
  void extensionId;
  void api;
  const page = await context.newPage();
  await page.goto(PR_URL);

  const opened = context.waitForEvent('page');
  await cta(page).click();
  await opened;
  const after = context.pages().length;

  // The worker keeps a registry of the review tabs it opened, so a second press
  // shows the first one. Without it, a reviewer who forgets they already have
  // the review open collects a tab per press.
  await cta(page).click();
  await page.waitForTimeout(500);
  expect(context.pages().length).toBe(after);
});

test('remembers that the card was collapsed', async ({ context, extensionId, api }) => {
  void extensionId;
  void api;
  const page = await context.newPage();
  await page.goto(PR_URL);
  await expect(cta(page)).toBeVisible();

  await page.getByRole('button', { name: 'Collapse A Better Reviewer' }).click();
  await expect(cta(page)).toBeHidden();

  const pill = page.getByRole('button', { name: 'Expand A Better Reviewer' });
  await expect(pill).toBeVisible();

  // Collapsed is a choice about the extension, not about one page view.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand A Better Reviewer' })).toBeVisible();
  await expect(cta(page)).toBeHidden();

  // And it is still the way in.
  await page.getByRole('button', { name: 'Expand A Better Reviewer' }).click();
  await expect(cta(page)).toBeVisible();
});

/**
 * Write the reviewer's settings the way the options page would.
 *
 * Through the worker so it lands in the same `storage.local` the extension
 * reads, rather than a page's own origin storage, which is a different area.
 */
async function setSettings(
  context: BrowserContext,
  settings: { openIn: 'new-tab' | 'new-window' | 'same-tab'; autoOpen: boolean },
): Promise<void> {
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async (value) => {
    const api = (globalThis as unknown as {
      chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    }).chrome;
    await api.storage.local.set({ settings: value });
  }, settings);
}

test('opens a review by itself when the reviewer asked it to', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  await setSettings(context, { openIn: 'new-tab', autoOpen: true });

  const page = await context.newPage();
  const opened = context.waitForEvent('page');
  await page.goto(PR_URL);

  const review = await opened;
  await review.waitForURL(new RegExp(`^chrome-extension://${extensionId}/review\.html#`));
  expect(review.url()).toBe(reviewUrl(extensionId));

  // Opened, not thrust in front of anyone. The reviewer may be part-way
  // through a comment on the pull request page, and an action they did not
  // take must not move them off it.
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

  // The card stays, so closing the review leaves a way back.
  await expect(cta(page)).toBeVisible();
});

test('auto-open fires once per pull request, not once per tab of it', async ({
  context,
  extensionId,
  api,
}) => {
  void extensionId;
  void api;
  await setSettings(context, { openIn: 'new-tab', autoOpen: true });

  const page = await context.newPage();
  const opened = context.waitForEvent('page');
  await page.goto(PR_URL);
  await opened;
  const after = context.pages().length;

  // Conversation to Files is a navigation, and it is the same pull request.
  // Treating it as a fresh arrival would open a review per tab of every pull
  // request the reviewer walks through.
  await page.evaluate(() => history.pushState({}, '', '/acme/widgets/pull/42/files'));
  await page.waitForTimeout(1_000);
  expect(context.pages().length).toBe(after);
});

test('does not open by itself when nobody asked', async ({ context, extensionId, api }) => {
  void extensionId;
  void api;
  // The default, and deliberately so: a tab appearing unasked on someone's
  // first pull request reads as a malfunction rather than a feature.
  const page = await context.newPage();
  await page.goto(PR_URL);
  await expect(cta(page)).toBeVisible();

  const before = context.pages().length;
  await page.waitForTimeout(1_000);
  expect(context.pages().length).toBe(before);
});

test('the destination chosen on the options page is the one the card uses', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The whole settings path in one test: the options page writes the choice,
  // the worker reads it, and the card obeys it on another site entirely.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('radio', { name: 'This tab' }).check();

  const page = await context.newPage();
  await page.goto(PR_URL);
  await cta(page).click();

  // Same tab, so this page becomes the review rather than a new one appearing.
  await page.waitForURL(new RegExp(`^chrome-extension://${extensionId}/review\.html#`));
  expect(page.url()).toBe(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();
});

test('auto-open is refused for the same tab, where Back would be a trap', async ({
  context,
  extensionId,
  api,
}) => {
  void extensionId;
  void api;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const auto = options.getByRole('checkbox', {
    name: /Open a review automatically/,
  });
  await auto.check();
  await expect(auto).toBeChecked();

  // Choosing the same tab takes auto-open down with it, rather than leaving a
  // stored flag that silently comes back the next time the destination moves.
  await options.getByRole('radio', { name: 'This tab' }).check();
  await expect(auto).toBeDisabled();
  await expect(auto).not.toBeChecked();

  const page = await context.newPage();
  const before = context.pages().length;
  await page.goto(PR_URL);
  await expect(cta(page)).toBeVisible();
  await page.waitForTimeout(1_000);

  // Still on the pull request, and nothing else opened.
  expect(page.url()).toBe(PR_URL);
  expect(context.pages().length).toBe(before);
});

test('renders the pull request and its diff', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await openReview(page, extensionId);

  await expect(page.locator('.pr-title')).toHaveText('Cache the diff on head SHA');

  // Real code, syntax highlighted, inside Pierre's shadow root. Playwright's
  // selectors pierce it, which is the only reason this is assertable at all.
  const firstDiff = page.locator('diffs-container').first();
  await expect(firstDiff.locator('[data-column-number]').first()).toBeVisible();
  await expect(page.getByText('new src/app.ts')).toBeVisible();

  // An anchored thread is drawn in the diff; the ones that cannot be are listed
  // in their own file's card instead, which is the whole safety net.
  //
  // Each file is brought into the column before it is looked for. The section
  // is drawn by `renderCustomHeader`, so it exists only for files `CodeView`
  // has virtualized in — a function of the viewport height rather than of
  // anything this test is about. It happened to be on screen at 720px, and one
  // extra row of chrome above the column was enough to make it not.
  await expect(
    page.getByLabel('Diff').getByText('This allocates on every call.'),
  ).toBeVisible();
  for (const [path, reason] of [
    ['src/beta.ts', 'out-of-hunk'],
    ['src/gamma.ts', 'outdated'],
  ] as const) {
    await page.locator(`[data-path="${path}"]`).click();
    await expect(
      page.locator(`[data-unanchored="${path}"] [data-listed-reason="${reason}"]`),
    ).toHaveCount(1);
  }

  // The Conversations view lists every thread, including the ones the diff
  // cannot show, and every file is in the tree.
  await openView(page, /conversations/i);
  for (const thread of THREADS) {
    const entry = threadsView(page).getByText(thread.comments.nodes[0]?.body ?? '');
    // Resolved ones are folded behind a disclosure — present, one click away,
    // and never dropped.
    if (thread.isResolved) await threadsView(page).getByText('1 resolved').click();
    await expect(entry).toBeVisible();
  }
  for (const path of FILES) {
    await expect(page.locator(`[data-path="${path}"]`)).toHaveCount(1);
  }

  // And the fixture answered every request: nothing reached github.com.
  expect(api.operations).toContain('PullRequestReview');
  expect(api.urls).toContain('/repos/acme/widgets/pulls/42');
});

test('the tree marks which files carry conversations, and follows a resolve', async ({
  context,
  extensionId,
  api,
}) => {
  // The one thing no unit test can settle. `@pierre/trees` has no `refresh()`,
  // its decoration renderer is fixed at construction, and the only way we found
  // to redraw a row is re-setting the icons — inferred from the package's own
  // source, on a beta version, against a shadow root jsdom renders differently.
  // If that inference is wrong, the mark is drawn once and then lies for the
  // rest of the review.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const row = (path: string) => page.locator(`[data-path="${path}"]`);

  // Every file in the fixture carries exactly one open thread except src/app.ts,
  // which carries an open one and a resolved one — so all four read as open.
  const mark = (path: string) => row(path).locator('.tree-comment');
  await expect(mark('src/beta.ts')).toHaveAttribute('data-tone', 'open');
  await expect(mark('src/app.ts')).toHaveAttribute('data-tone', 'open');
  // And a file nobody has commented on says nothing at all.
  await expect(mark('src/epsilon.ts')).toHaveCount(0);

  // Resolving src/beta.ts's only thread has to flip its mark from open to
  // settled. Nothing in the file list moves when it does.
  //
  // By way of the Conversations view's Go to, which is the whole point of that
  // button: a thread is read and answered where its code is, so asking to be
  // shown one has to put the diff back on screen and scroll it there.
  await openView(page, /conversations/i);
  await threadsView(page)
    .locator('[data-thread-entry="PRRT_outofhunk"]')
    .getByRole('button', { name: /go to/i })
    .click();
  await expect(page.locator('.shell')).toHaveAttribute('data-view', 'files');

  await filesView(page)
    .locator('[data-thread="PRRT_outofhunk"]')
    .getByRole('button', { name: 'Resolve conversation' })
    .click();

  await expect(mark('src/beta.ts')).toHaveAttribute('data-tone', 'resolved');
  expect(api.operations).toContain('ResolveThread');

  // The counts, the mark and the box are separate elements in a real row now,
  // so there is no shared cell for one of them to collapse inside.
  await expect(row('src/app.ts').locator('.tree-counts')).toContainText('+1');
  await expect(row('src/app.ts').locator('[data-check]')).toHaveCount(1);
});

test('the rail’s reviewer list is not wearing the avatar’s ring', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // Two surfaces emit `reviewer-good`: the top bar's avatar, where it is a
  // 2px ring around a 20px circle, and the rail's reviewer list, where the
  // same rule drew a green rule across the full width of the row. Only a
  // layout engine renders a box-shadow, so nothing until here could see it.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const shadowOf = (selector: string) =>
    page.locator(selector).first().evaluate((node) => getComputedStyle(node).boxShadow);

  expect(await shadowOf('.reviewer-state.reviewer-good')).toBe('none');
  // And the avatar it belongs to still has it.
  expect(await shadowOf('.reviewer.reviewer-good')).not.toBe('none');
});

test('a file can be ticked off from the tree, and the card agrees', async ({
  context,
  extensionId,
  api,
}) => {
  // The tick is a glyph in the row's one decoration slot with a delegated
  // click handler, because a row is a `<button role="treeitem">` and nothing
  // focusable may nest inside one. Whether a click on it reaches us at all —
  // and whether it reaches the row underneath as well — is a question about a
  // real shadow tree and a real capture phase.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const row = (path: string) => page.locator(`[data-path="${path}"]`);

  const box = (path: string) => row(path).locator('[data-check]');
  await expect(box('src/app.ts')).toHaveAttribute('data-check', 'unchecked');
  await box('src/app.ts').click();

  await expect(box('src/app.ts')).toHaveAttribute('data-check', 'checked');
  expect(api.operations).toContain('MarkViewed');

  // The same state, not a second one: this is GitHub's viewed flag, so the
  // checkbox on the file's own card has to have moved with it.
  await expect(
    filesView(page).getByRole('checkbox', { name: /src\/app\.ts/ }),
  ).toBeChecked();

  // And ticking a file off did not also navigate to it. Every click inside the
  // row is a click on the row, so this only holds if the capture handler
  // stopped it.
  await expect(page.locator('.shell')).toHaveAttribute('data-current-file', '');
});

test('a folder ticks off every file beneath it', async ({ context, extensionId, api }) => {
  // The reason for owning the tree. `markFileAsViewed` has no bulk form, so
  // this is one mutation per file — what it must not be is one request storm.
  const page = await context.newPage();
  await openReview(page, extensionId);

  await page.locator('[data-path="src/"] [data-check]').click();

  await expect(page.locator('[data-path="src/"] [data-check]')).toHaveAttribute(
    'data-check',
    'checked',
    { timeout: 10000 },
  );
  for (const path of ['src/app.ts', 'src/beta.ts', 'src/gamma.ts']) {
    await expect(page.locator(`[data-path="${path}"] [data-check]`)).toHaveAttribute(
      'data-check',
      'checked',
    );
  }
  expect(api.operations.filter((op) => op === 'MarkViewed').length).toBeGreaterThan(2);
});

test('the keyboard can tick a file off without leaving the tree', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // A treeitem may not contain focusable content, so the box is not a tab
  // stop — ARIA's answer is that the row carries the state and Space toggles
  // it. That only works if the row is genuinely focusable, which is a claim
  // about a real browser.
  const page = await context.newPage();
  await openReview(page, extensionId);

  await page.locator('[data-path="src/app.ts"]').focus();
  await page.keyboard.press('Space');

  await expect(page.locator('[data-path="src/app.ts"] [data-check]')).toHaveAttribute(
    'data-check',
    'checked',
  );
});

test('hovering a tree row names the whole path', async ({ context, extensionId, api }) => {
  void api;
  // The row carries no `title` of its own and its `aria-label` is the bare
  // file name, so a truncated path had nowhere to say which file it was.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const row = page.locator('[data-path="src/components/Button.tsx"]');
  await row.hover();

  await expect(row).toHaveAttribute('title', 'src/components/Button.tsx');
});

test('each file in the diff is a block of its own', async ({ context, extensionId, api }) => {
  void api;
  // `stickyHeaders` is on, so a file's header stays pinned while its body
  // scrolls — and with no background of its own the code scrolled straight
  // through it. Only a layout engine composites, so nothing until here could
  // see that a pull request was reading as one enormous file.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const head = page.locator('.file-card').first();
  const style = await head.evaluate((node) => {
    const css = getComputedStyle(node);
    return {
      bg: css.backgroundColor,
      top: css.borderTopWidth,
      bottom: css.borderBottomWidth,
    };
  });

  expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.bg).not.toBe('transparent');
  expect(style.top).not.toBe('0px');
  expect(style.bottom).not.toBe('0px');

  // And the header's background differs from the code beneath it, or being
  // opaque buys nothing.
  const body = await page
    .locator('diffs-container')
    .first()
    .evaluate((node) => {
      const inner = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot
        ?.firstElementChild;
      return inner == null ? null : getComputedStyle(inner).backgroundColor;
    });
  expect(style.bg).not.toBe(body);
});

test('the header rows keep their height and do not overlap the body', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // `.shell` is a flex column exactly one viewport tall, and the diff inside it
  // is enormous — so every child that does not refuse to shrink gets shrunk.
  // The top bar lost 21px of its declared 52 the moment a second header row was
  // added, and the row below it then sat 21px over the top of the body. Only a
  // layout engine can see any of that.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const box = (selector: string) =>
    page.locator(selector).evaluate((node) => {
      const r = node.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    });

  const declared = await page.evaluate(() =>
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height'), 10),
  );
  const topbar = await box('.topbar');
  const body = await box('.shell-body');
  const scope = await box('.scope-bar');
  const files = await box('.filesview');

  expect(topbar.height).toBe(declared);
  expect(body.top).toBe(topbar.bottom);
  // The scope bar is the first row inside the Files view now, and the diff
  // begins exactly where it ends: the tabs open straight onto what they scope.
  expect(scope.top).toBe(body.top);
  expect(scope.height).toBeGreaterThan(0);
  expect(files.top).toBe(scope.bottom);
});

test('switching views and back leaves the diff exactly where it was', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The reason the views are hidden with `visibility` rather than with
  // `display: none` or by not rendering them. `CodeView` virtualizes against a
  // scrollport it measures; a display-hidden ancestor takes that measurement
  // to zero, and on the way back the reviewer has lost their scroll position,
  // their mounted rows, and every line of context they expanded to get there.
  // Nothing in jsdom performs layout, so this cannot be checked anywhere else.
  const page = await context.newPage();
  await openReview(page, extensionId);

  await scrollTo(page, 900);
  const scrollTop = () =>
    page.evaluate((selector) => document.querySelector(selector)?.scrollTop ?? -1, VIEW);
  const before = await scrollTop();
  expect(before).toBeGreaterThan(0);

  await openView(page, /overview/i);
  await expect(page.locator('.shell')).toHaveAttribute('data-view', 'overview');
  await openView(page, /^files$/i);

  expect(await scrollTop()).toBe(before);
  await expect(
    page.locator('diffs-container').first().locator('[data-column-number]').first(),
  ).toBeVisible();
});

test('scrolling the diff column walks the tree selection forward, in file order', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // The whole column, not just `FILES`: the image and the table follow it in
  // `UNIFIED_DIFF`, and the walk reaches them now that the tail gives the column
  // the scroll range its rich cards were costing it.
  const order = new Map<string, number>(
    [...FILES, IMAGE_FILE, TABLE_FILE].map((path, index) => [path, index]),
  );
  const seen: string[] = [];

  const height = await page.locator(VIEW).evaluate((node) => node.scrollHeight);
  for (let top = 0; top <= height; top += 150) {
    await scrollTo(page, top);
    const current = await currentFile(page);
    if (current !== null && current !== '' && current !== seen.at(-1)) seen.push(current);
  }

  // Every file it named is a real file, and it never went backwards. This is
  // the specific claim jsdom cannot make: the measured header offsets order
  // the same way the file list does, in spite of the sticky wrapper's negative
  // `top`.
  expect(seen.length).toBeGreaterThan(6);
  const indices = seen.map((path) => order.get(path));
  expect(indices).not.toContain(undefined);
  for (let i = 1; i < indices.length; i += 1) {
    expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
  }

  // It starts at the top of the list and reaches the bottom of it.
  expect(seen[0]).toBe(FILES[0]);
  expect(order.get(seen.at(-1) as string)).toBeGreaterThan(FILES.length - 4);

  // And the file it names is genuinely the topmost one on screen, measured
  // rather than inferred. Asked just short of the end rather than at it: the
  // tail is deliberately long enough to scroll past the last card — that is
  // what lets the last card reach the top at all — so the very bottom of the
  // column is empty space with no card to be topmost. Moving re-fires the
  // handler against the layout as it finally settled, which the reported file
  // is otherwise one render behind.
  await page.evaluate((selector) => {
    const view = document.querySelector(selector);
    if (view !== null) view.scrollTop = (view.scrollHeight - view.clientHeight) * 0.88;
  }, VIEW);
  await page.waitForTimeout(300);
  // Then the nudge, as before: it is what re-fires the handler against the
  // layout as it finally settled, which the reported file is otherwise one
  // render behind.
  await page.evaluate((selector) => {
    const view = document.querySelector(selector);
    if (view !== null) view.scrollTop += 1;
  }, VIEW);
  await page.waitForTimeout(300);

  // The same tolerance the page uses, imported rather than restated. Written
  // out as a literal here it silently stopped matching the moment a row of
  // chrome was added above the column, and this test then disagreed with the
  // implementation about which file was on top rather than about anything real.
  const tops = await cardTops(page);
  const reached = tops
    .filter((card) => card.top <= REACHED)
    .sort((a, b) => a.top - b.top)
    .at(-1);
  expect(reached).toBeDefined();
  expect(await currentFile(page)).toBe(reached?.path);
});

test('clicking a file in the tree scrolls the column to it', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // The tree renders inside `@pierre/trees`' own shadow root; Playwright's
  // selectors pierce it, and the row carries its own path.
  const row = page.locator('[data-path="lib/util/debounce.ts"]');
  await row.click();

  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.shell')).toHaveAttribute(
    'data-current-file',
    'lib/util/debounce.ts',
  );

  // The column really moved, and it moved to that card.
  await expect
    .poll(async () => (await page.locator(VIEW).evaluate((n) => n.scrollTop)) > 0)
    .toBe(true);
  await expect
    .poll(async () => {
      const tops = await cardTops(page);
      return tops.find((card) => card.path === 'lib/util/debounce.ts')?.top ?? null;
    })
    .toBeLessThan(40);
});

test('a comment can be typed and posted', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await openReview(page, extensionId);

  // The gutter "+" appears on hover and lives in the shadow root, so the
  // composer is opened through the keyboard path instead: select a line, then
  // press `c`. Both halves are the real ones.
  const gutter = page
    .locator('diffs-container')
    .first()
    .locator('[data-column-number][data-line-type="change-addition"]')
    .first();
  await gutter.click();

  await page.locator('body').press('c');

  const box = page.getByRole('textbox', { name: /comment on src\/app\.ts/i });
  await expect(box).toBeVisible();
  await box.fill('Posted from the browser test.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();

  await expect
    .poll(() => api.operations.filter((name) => name === 'AddThread').length)
    .toBe(1);
  const sent = api.variables[api.operations.indexOf('AddThread')];
  expect(sent?.['path']).toBe('src/app.ts');
  expect(sent?.['body']).toBe('Posted from the browser test.');

  // And it is actually published, which is the whole point.
  //
  // `addPullRequestReviewThread` has no standalone mode: on its own it leaves
  // the comment queued inside a PENDING review that nobody else can see. So
  // the review is opened, written to, and submitted in one go — and this
  // asserts the third round trip really happens, in a real browser, because
  // the version that did not looked identical on screen.
  const reads = ['PullRequestReview', 'ViewerPendingReview', 'PullRequestCommits'];
  const mutations = api.operations.filter((name) => !reads.includes(name));
  expect(mutations).toEqual(['StartReview', 'AddThread', 'SubmitReview']);
  expect(api.variables[api.operations.indexOf('SubmitReview')]?.['event']).toBe(
    'COMMENT',
  );

  // And it comes back onto the page as a thread rather than vanishing.
  await expect(
    filesView(page).getByText('Posted from the browser test.').last(),
  ).toBeVisible();

  // Nothing is left queued: no pending-review bar, no "not posted" chip.
  await expect(page.getByText(/not posted yet/i)).toHaveCount(0);
});

/**
 * A reviewer who already has a review open.
 *
 * GitHub allows one PENDING review per pull request and answers a second with
 * "User can only have one pending review per pull request". Both ways this page
 * writes a comment begin by opening one, so this reviewer could previously do
 * neither — the only thing on screen was that refusal.
 *
 * The fake API enforces the same rule, so this exercises the real recovery.
 */
test('joins a review the reviewer already had open', async ({
  context,
  extensionId,
  api,
}) => {
  api.pendingReviewId = 'PRR_already';

  const page = await context.newPage();
  await openReview(page, extensionId);

  // Known before anything is typed: the page asked, and says what it found.
  await expect(page.getByText(/not posted yet/i).first()).toBeVisible();

  const gutter = page
    .locator('diffs-container')
    .first()
    .locator('[data-column-number][data-line-type="change-addition"]')
    .first();
  await gutter.click();
  await page.locator('body').press('c');

  const box = page.getByRole('textbox', { name: /comment on src\/app\.ts/i });
  await expect(box).toBeVisible();
  await box.fill('Added to the review that was already open.');
  await page.getByRole('button', { name: 'Add to review', exact: true }).click();

  await expect
    .poll(() => api.operations.filter((name) => name === 'AddThread').length)
    .toBe(1);

  // Onto the existing review, and emphatically not submitted: that review may
  // hold comments made elsewhere, and sending them is not this page's call.
  const sent = api.variables[api.operations.indexOf('AddThread')];
  expect(sent?.['pullRequestReviewId']).toBe('PRR_already');
  expect(api.operations).not.toContain('SubmitReview');
});

test('the keyboard map works against real key events', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  const body = page.locator('body');

  // `j` / `k` move through the file list.
  await body.press('j');
  await expect(page.locator('.shell')).toHaveAttribute('data-current-file', FILES[0]);
  await body.press('j');
  await expect(page.locator('.shell')).toHaveAttribute('data-current-file', FILES[1]);
  await body.press('k');
  await expect(page.locator('.shell')).toHaveAttribute('data-current-file', FILES[0]);

  // And the tree follows. Asserting only on `data-current-file` is how the
  // tree came to sit still through `j` and `k`: the column moved, the shell
  // attribute moved, and the rail kept highlighting whatever was clicked last.
  // Matched on the name rather than exactly, because Pierre truncates the
  // label right-to-left and renders it as two overlapping runs.
  const selectedRow = page.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow).toContainText('app');

  await body.press('j');
  await expect(page.locator('.shell')).toHaveAttribute('data-current-file', FILES[1]);
  await expect(selectedRow).toContainText('beta');

  // `?` is a shifted key on this layout, which is exactly the case the map
  // resolves from `event.key` rather than from `shiftKey`.
  await body.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  // Closed by its own button. This overlay has no Escape binding — the search
  // panel below does — which the browser is the first thing to have noticed.
  await help.getByRole('button', { name: 'Close' }).click();
  await expect(help).toBeHidden();

  // `n` moves to the first thread and brings its file with it.
  await body.press('n');
  await expect(page.locator('.shell')).toHaveAttribute(
    'data-current-file',
    'src/app.ts',
  );

  // Mod+K opens the file filter. On this platform that is Ctrl.
  await body.press('Control+k');
  await expect(page.getByRole('dialog', { name: /jump to a file/i })).toBeVisible();
  await body.press('Escape');
});

test('nothing unmodified fires while a comment is being typed', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // No `scrollIntoViewIfNeeded` before the click, here or anywhere below.
  // `click` scrolls to its target as part of its own actionability checks and
  // retries a node that was detached under it; the bare scroll fails outright.
  // That matters from @pierre/diffs 1.4.1 on: it draws the rows, then replaces
  // every one of them when the highlighter is ready — measured with a
  // `MutationObserver` at 44 nodes out and 44 back in, about 200ms after the
  // first card appears — so anything resolved before that is detached.
  const reply = page.locator('[data-reply-for]').first();
  await reply.click();
  await reply.fill('');
  await reply.pressSequentially('jjk');

  // The keystrokes went into the box, not into the file list.
  await expect(reply).toHaveValue('jjk');
  await expect(page.locator('.shell')).toHaveAttribute('data-current-file', '');
});

test('expanding unchanged context anchors a comment the diff could not show', async ({
  context,
  extensionId,
  api,
}) => {
  // Task 26 end to end, through the real worker: the expander only exists
  // because a loader was supplied, the blobs come back over the message
  // channel, and Pierre hydrates the metadata in place.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const listed = page.locator('[data-unanchored="src/beta.ts"]');
  await expect(listed).toHaveCount(1);

  const card = page
    .locator('diffs-container')
    .filter({ has: page.locator('[data-file-card="src/beta.ts"]') });
  // Scrolled by `click` rather than beforehand, for the reason given on the
  // reply box above: the row this sits in is replaced once after first paint.
  const expander = card.locator('[data-expand-button]').first();
  await expander.click();

  // Both sides were read, each at its own commit.
  await expect
    .poll(() => api.urls.filter((url) => url.includes('/contents/src/beta.ts')).length)
    .toBe(2);

  // The comment is now drawn on its line in the diff, and is no longer listed
  // as something the diff cannot show.
  await expect(page.getByLabel('Diff').getByText('Out of hunk comment.')).toBeVisible();
  await expect(listed).toHaveCount(0);
  await expect(card.getByText('context line 10')).toBeVisible();
});

test('dark mode renders', async ({ context, extensionId, api }) => {
  void api;
  const page = await context.newPage();

  await page.emulateMedia({ colorScheme: 'light' });
  await openReview(page, extensionId);
  const light = await page.evaluate(() => ({
    shell: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  const dark = await page.evaluate(() => ({
    shell: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));

  // `light-dark()` is never evaluated by jsdom, so this pair of values has
  // never been observed anywhere before now.
  expect(dark.shell).not.toBe(light.shell);
  expect(dark.text).not.toBe(light.text);

  // And the diff resolves to the same background as the page. It renders into
  // a shadow root, so this cannot be checked anywhere but a real browser — and
  // left alone the seam shows two colours meeting, the page at #0d1117 and the
  // diff at pure black.
  const seams = await page.evaluate(() => {
    // The rendered colour, not the custom property: `getPropertyValue` on a
    // custom property hands back the unresolved token text, which compares
    // equal to nothing useful. Read inside the shadow root, because that is
    // where the surface the reviewer actually sees is painted.
    const bg = (element: Element | null) =>
      element == null ? null : getComputedStyle(element).backgroundColor;
    const diffHost = document.querySelector('diffs-container') as
      | (Element & { shadowRoot?: ShadowRoot })
      | null;
    return {
      page: bg(document.body),
      diff: bg(diffHost?.shadowRoot?.firstElementChild ?? null),
      tree: bg(document.querySelector('.filetree')),
    };
  });

  expect(seams.diff).toBe(seams.page);
  // The tree paints nothing of its own, so it cannot disagree with the page —
  // which is a stronger guarantee than matching it. It used to render into a
  // shadow root with its own theme, and the three surfaces met at #0d1117,
  // #141415 and pure black.
  expect(seams.tree).toBe('rgba(0, 0, 0, 0)');

  // The diff itself follows, inside Pierre's shadow root and its own theme.
  const diffBackground = await page
    .locator('diffs-container')
    .first()
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(diffBackground).not.toBe('rgba(0, 0, 0, 0)');

  // And the page is still legible: the diff is drawn, not blanked.
  await expect(
    page.locator('diffs-container').first().locator('[data-column-number]').first(),
  ).toBeVisible();
});

test('a comment expanded into view survives narrowing the diff', async ({
  context,
  extensionId,
  api,
}) => {
  // The bug this pins is silent: expanding context teaches the column that
  // `src/beta.ts` line 10 is drawable, and that answer outlives the renderer
  // it came from. Toggling "since my last review" tears `CodeView` down and
  // rebuilds it collapsed, so the line is no longer on screen — but the column
  // still believes it is, and hands Pierre an annotation for a row that does
  // not exist. Pierre draws nothing and raises nothing, and the comment is in
  // neither the diff nor the per-file list.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const listed = page.locator('[data-unanchored="src/beta.ts"]');
  const card = page
    .locator('diffs-container')
    .filter({ has: page.locator('[data-file-card="src/beta.ts"]') });

  // The comment starts out listed as something the diff cannot show. Asserted
  // rather than assumed: it is the precondition the rest of this test changes.
  await expect(listed).toHaveCount(1);

  // Expand, so the comment moves out of the list and into the diff. Scrolled
  // by `click` rather than beforehand, for the reason on the reply box above.
  const expander = card.locator('[data-expand-button]').first();
  await expander.click();
  await expect(page.getByLabel('Diff').getByText('Out of hunk comment.')).toBeVisible();
  await expect(listed).toHaveCount(0);

  // Narrow to what landed since the last review. That patch's only hunk covers
  // lines 1-3, so line 10 is out of hunk again and the comment belongs back in
  // the list.
  await chooseScope(page, /since my last review/i);
  await scopeChecked(page, /since my last review/i, 'true');
  // Prove the narrowing actually landed rather than assuming it: the compare
  // endpoint was called, and the column now holds that patch's one file
  // instead of the pull request's fourteen.
  expect(api.urls.some((url) => url.includes('/compare/'))).toBe(true);
  await expect(page.locator('[data-file-card="src/beta.ts"]')).toHaveCount(1);
  await expect(page.locator('[data-file-card="src/app.ts"]')).toHaveCount(0);

  // Line 10 is outside the narrowed patch's only hunk, and the expansion that
  // once revealed it died with the renderer — so the comment belongs back in
  // the per-file list, and has to be visible there.
  await expect(listed).toHaveCount(1);
  // Listed means reachable: the disclosure is closed until asked, which is how
  // every out-of-hunk thread is offered, so opening it is the reader's step.
  await listed.locator('summary').click();
  await expect(listed.getByText('Out of hunk comment.')).toBeVisible();

  // And back. The full diff returns collapsed, so the verdict is the same one
  // the page reaches on a cold load: listed, not drawn.
  await chooseScope(page, /since my last review/i);
  await scopeChecked(page, /since my last review/i, 'false');
  // Drawn this time rather than listed, and that is right: the blobs are warm
  // from the expansion above, so the column's standing request for the line is
  // granted immediately. Either surface is correct — being on neither is not.
  await expect(page.getByLabel('Diff').getByText('Out of hunk comment.')).toBeVisible();
});

test('split view redraws the column, and keeps the comments on it', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The layout is the one thing jsdom cannot check at all — it performs no
  // layout — and this is a control whose entire job is layout. §B.3 promises
  // that moving between the two needs no annotation change; here is that
  // promise against the production build, in a browser that lays out.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const diff = page.locator('diffs-container').first().locator('[data-diff-type]').first();
  await expect(diff).toHaveAttribute('data-diff-type', 'single');

  await chooseScope(page, /split view/i);

  await expect(diff).toHaveAttribute('data-diff-type', 'split');
  // Still real, highlighted, numbered code — not an empty two-column frame.
  await expect(
    page.locator('diffs-container').first().locator('[data-column-number]').first(),
  ).toBeVisible();
  // And the thread that was anchored in unified is still anchored in split.
  await expect(
    page.getByLabel('Diff').getByText('This allocates on every call.'),
  ).toBeVisible();

  await scopeChecked(page, /split view/i, 'true');
});

test('a file can be read without its whitespace, and says that it is', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The label is the requirement, not the decoration: the body under it is not
  // what anybody else on this pull request is looking at. Checked in the real
  // build because it is the shipped stylesheet that has to make it visible.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const card = page.locator('[data-file-card="src/app.ts"]');
  // The toggle is on the header; the notice it turns on is in the body, which
  // is a separate element because that is the half `CodeView` measures.
  const note = fileBody(page, 'src/app.ts').locator('[data-whitespace-note]');
  const toggle = card.getByRole('button', { name: /ignore whitespace/i });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toContainText(/not the diff GitHub is showing/i);
  // Per file. The next card is still showing GitHub's diff, unannounced.
  await expect(
    fileBody(page, 'src/beta.ts').locator('[data-whitespace-note]'),
  ).toHaveCount(0);

  // The column survived being rebuilt under a new key: there is still code.
  await expect(
    page.locator('diffs-container').first().locator('[data-column-number]').first(),
  ).toBeVisible();

  await toggle.click();
  await expect(note).toHaveCount(0);
});

test('the numbered strip scopes the diff, and keeps All within reach', async ({
  context,
  extensionId,
  api,
}) => {
  // Numbers rather than subjects, because a strip of subjects is unscannable.
  // What a number cannot say goes on its title, and which commits are on
  // screen is said once, to the left of the strip.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const strip = page.getByRole('toolbar', { name: /scope the diff/i });
  await expect(strip.getByRole('button')).toHaveCount(4);
  await expect(strip.getByRole('button', { name: 'All' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await expect(strip.getByRole('button', { name: /^Commit 2/ })).toHaveAttribute(
    'title',
    /Handle renames.*rowan/,
  );

  // "All" is last in the sequence and pinned to the right-hand end of it, so a
  // pull request long enough to scroll its numbers away cannot scroll away the
  // way back. The numbers go with it rather than starting at the left, so the
  // strip reads as one group. Only a layout engine can show any of that.
  const ends = await strip.evaluate((node) => {
    const tabs = [...node.querySelectorAll('.commit-tab')];
    const all = node.querySelector('.commit-tab-all');
    const first = tabs[0];
    const lastNumber = tabs[tabs.length - 2];
    if (all === null || first === undefined || lastNumber === undefined) {
      throw new Error('no strip');
    }
    const box = (element: Element) => element.getBoundingClientRect();
    return {
      last: node.lastElementChild === all,
      stripLeft: Math.round(box(node).left),
      stripRight: Math.round(box(node).right),
      firstLeft: Math.round(box(first).left),
      allLeft: Math.round(box(all).left),
      allRight: Math.round(box(all).right),
      lastNumberRight: Math.round(box(lastNumber).right),
    };
  });
  expect(ends.last).toBe(true);
  expect(ends.allRight).toBe(ends.stripRight);
  // The numbers are up against "All" — one 2px flex gap between them — and not
  // stranded at the far left of a wide strip.
  expect(ends.allLeft - ends.lastNumberRight).toBe(2);
  expect(ends.firstLeft).toBeGreaterThan(ends.stripLeft);


  // The first commit alone, which is the one range this fixture routes for a
  // single commit. Its own parent is the pull request's base.
  await strip.getByRole('button', { name: /^Commit 1/ }).click();

  await expect(page.locator('.scope-bar')).toHaveAttribute('data-scope', 'narrowed');
  await expect(strip.getByRole('button', { name: /^Commit 1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(api.urls.some((url) => url.includes(`${BASE_SHA}...${FIRST_SHA}`))).toBe(true);
  await expect(page.locator('.scope-status')).toContainText('Commit ccccccc');

  // Pinned means painted. Unpressed now, so it is not the diff's colour — and
  // it sits over whatever numbers have scrolled past it, so it has to be the
  // bar's own rather than transparent. Read as "the same as the bar" rather
  // than as a literal, so a state that recolours the bar cannot leave a grey
  // patch stranded on it.
  //
  // Polled rather than read once: the tab is mid-transition from the colour it
  // wore while it was pressed, and a single read lands on an interpolated
  // value a few units off.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bar = document.querySelector('.scope-bar');
        const all = document.querySelector('.commit-tab-all');
        if (bar === null || all === null) throw new Error('no strip');
        const painted = getComputedStyle(all).backgroundColor;
        return {
          pressed: all.getAttribute('aria-pressed'),
          matchesBar: painted === getComputedStyle(bar).backgroundColor,
          transparent: painted === 'rgba(0, 0, 0, 0)',
        };
      }),
    )
    .toEqual({ pressed: 'false', matchesBar: true, transparent: false });
});

test('a strip too long for the row still keeps All on screen', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The reason "All" is sticky rather than merely last. Forced by squeezing
  // the strip rather than by inventing a hundred-commit fixture: what is being
  // checked is the sticky, and a narrow scrollport is what makes it do
  // anything at all.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const strip = page.locator('.commit-strip');
  await strip.evaluate((node) => {
    node.style.maxWidth = '80px';
  });

  const scrolled = await strip.evaluate((node) => {
    node.scrollLeft = 0;
    const all = node.querySelector('.commit-tab-all');
    if (all === null) throw new Error('no All tab');
    return {
      overflows: node.scrollWidth > node.clientWidth,
      right: Math.round(node.getBoundingClientRect().right),
      allRight: Math.round(all.getBoundingClientRect().right),
    };
  });

  // Vacuous otherwise: nothing is scrolled away, so nothing has to stay.
  expect(scrolled.overflows).toBe(true);
  // Scrolled hard left, with two numbered tabs still to its left, and it is
  // nonetheless flush against the right-hand end of the strip.
  expect(scrolled.allRight).toBe(scrolled.right);
});

test('shift-clicking the strip takes the span between two commits', async ({
  context,
  extensionId,
  api,
}) => {
  const page = await context.newPage();
  await openReview(page, extensionId);

  const strip = page.getByRole('toolbar', { name: /scope the diff/i });
  await strip.getByRole('button', { name: /^Commit 1/ }).click();
  await expect(page.locator('.scope-bar')).toHaveAttribute('data-scope', 'narrowed');

  await page.keyboard.down('Shift');
  await strip.getByRole('button', { name: /^Commit 2/ }).click();
  await page.keyboard.up('Shift');

  // Both ends pressed, and the middle of a two-commit span is its ends.
  await expect(strip.getByRole('button', { name: /^Commit 1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(strip.getByRole('button', { name: /^Commit 2/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.scope-status')).toContainText('2 commits');
  expect(api.urls.some((url) => url.includes(`${BASE_SHA}...${PRIOR_SHA}`))).toBe(true);
});

test('scoping the diff to one commit never draws a comment on the wrong line', async ({
  context,
  extensionId,
  api,
}) => {
  // The worst failure this feature can produce, and it is silent. A thread's
  // `line` is a position in the *pull request's* diff. Scoped to the first
  // commit, the additions side is numbered against the file as it stood then,
  // so line 2 is a different line — one that exists, so Pierre would draw the
  // annotation there and raise nothing. Only a real renderer can show whether
  // it did, which is why this is here and not in jsdom.
  const page = await context.newPage();
  await openReview(page, extensionId);

  // Anchored in the diff to begin with.
  await expect(
    page.getByLabel('Diff').getByText('This allocates on every call.'),
  ).toBeVisible();
  await expect(page.locator('.scope-bar')).toHaveAttribute('data-scope', 'whole');
  // The pressed "All" tab is what says the column is showing everything; the
  // sentence that used to repeat it is gone.
  await expect(page.getByRole('button', { name: 'All' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await chooseScope(page, /choose commits/i);
  const picker = page.getByRole('dialog', { name: 'Commits' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Select commit ccccccc/ }).click();

  await expect(page.locator('.scope-bar')).toHaveAttribute('data-scope', 'narrowed');
  await expect(page.locator('.scope-bar')).toContainText('ccccccc');
  // Three-dot, from that commit's own parent, which is the pull request's base
  // here. `..` is not routed because the real API answers it 404.
  expect(
    api.urls.some((url) => url.includes(`/compare/${BASE_SHA}...${FIRST_SHA}`)),
  ).toBe(true);

  // The one file that commit touched, and nothing else.
  await expect(page.locator('[data-file-card="src/app.ts"]')).toHaveCount(1);
  await expect(page.locator('[data-file-card="src/beta.ts"]')).toHaveCount(0);

  // The comment is not drawn in the diff — and it is not gone either. Stated
  // as "there is exactly one card for that thread, and it is the listed one",
  // because both surfaces sit inside the column and counting text alone cannot
  // tell them apart.
  const listed = page.locator('[data-unanchored="src/app.ts"]');
  await expect(listed.locator('[data-listed-reason="other-commit"]')).toHaveCount(2);
  await expect(page.locator('[data-thread="PRRT_anchored"]')).toHaveCount(1);
  await expect(
    listed.locator('[data-thread="PRRT_anchored"]'),
  ).toHaveCount(1);
  // Listed means reachable: the disclosure is closed until asked. `.first()`
  // because the resolved thread beside it carries its own.
  await listed.locator('summary').first().click();
  await expect(listed.getByText('This allocates on every call.')).toBeVisible();

  // And commenting is refused on the side whose numbers are not the pull
  // request's, rather than posting against a line the reviewer never read.
  // Selected in the gutter and opened with `c`, which is the same path the
  // posting test uses: the "+" only appears on hover, inside the shadow root.
  await page
    .locator('diffs-container')
    .first()
    .locator('[data-column-number][data-line-type="change-addition"]')
    .first()
    .click();
  await page.locator('body').press('c');
  await expect(page.getByRole('alert')).toContainText('Show all commits');
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(0);

  // A range, chosen as two clicks rather than a modifier drag, so it is
  // reachable from the keyboard. Its base is the parent of the *first*
  // selection, which is what makes one commit and a one-commit range the same
  // request.
  await chooseScope(page, /choose commits/i);
  const again = page.getByRole('dialog', { name: 'Commits' });
  await again.getByRole('button', { name: /Compare from ccccccc/ }).click();
  await again.getByRole('button', { name: /Select commit bbbbbbb/ }).click();

  await expect(page.locator('.scope-bar')).toContainText('2 commits');
  expect(
    api.urls.some((url) => url.includes(`/compare/${BASE_SHA}...${PRIOR_SHA}`)),
  ).toBe(true);
  await expect(page.locator('[data-file-card="src/beta.ts"]')).toHaveCount(1);

  // Back to everything, and the comment is drawn again.
  await chooseScope(page, /show all commits/i);
  await expect(page.locator('.scope-bar')).toHaveAttribute('data-scope', 'whole');
  await expect(
    page.getByLabel('Diff').getByText('This allocates on every call.'),
  ).toBeVisible();
});

test('clearing the token stops the cache serving the pull request', async ({
  context,
  extensionId,
  api,
}) => {
  // Nothing in a cache key names an account, so without a sweep on token
  // change the cache outlives the token that filled it — and a signed-out
  // reviewer keeps seeing a whole private pull request until the TTL expires.
  const page = await context.newPage();
  await openReview(page, extensionId);
  await expect(page.locator('[data-file-card]').first()).toBeVisible();

  const before = api.urls.length;

  // Locking the vault, which is what the options page's Lock button does. The
  // decrypted token goes and the cache must go with it — the cache lives in
  // the same session area, so this is the sweep that is easiest to get wrong.
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async () => {
    const api = (globalThis as unknown as {
      chrome: { storage: { session: { remove(keys: string): Promise<void> } } };
    }).chrome;
    await api.storage.session.remove('github-token-unlocked');
  });

  await page.reload();

  // The setup screen, not the diff — and the worker did not answer it from
  // cache, which is the part that would have been silent.
  await expect(page.getByRole('button', { name: 'Open options' })).toBeVisible();
  await expect(page.locator('[data-file-card]')).toHaveCount(0);
  expect(api.urls.length).toBe(before);
});

test('a token works with no passphrase at all, and can be encrypted later', async ({
  context,
  extensionId,
  api,
}) => {
  // The default path. Encryption is opt-in, so the setup a new install
  // actually walks through is: paste a token, press save, review.
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as {
      chrome: { storage: { session: { remove(keys: string): Promise<void> } } };
    }).chrome;
    await chromeApi.storage.session.remove('github-token-unlocked');
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('GitHub fine-grained personal access token').fill('ghp_fixture_token');
  await options.getByRole('button', { name: 'Save token' }).click();
  await expect(options.getByText(/^Token saved\./)).toBeVisible();

  // Usable straight away, and with no passphrase to enter.
  const page = await context.newPage();
  await openReview(page, extensionId);
  await expect(page.locator('[data-file-card]').first()).toBeVisible();

  // And it survives what would lock an encrypted one, because there is
  // nothing to lock.
  await page.reload();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();

  // Encryption can be added afterwards without re-entering the token.
  await options.reload();
  await options.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await options.getByLabel('Passphrase again').fill('correct horse battery staple');
  await options.getByRole('button', { name: 'Encrypt this token' }).click();
  await expect(options.getByText(/unencrypted copy has been deleted/i)).toBeVisible();
  await expect(options.getByRole('button', { name: 'Remove passphrase' })).toBeVisible();
  void api;
});

test('a token can be encrypted, locked, and unlocked again', async ({
  context,
  extensionId,
  api,
}) => {
  // The whole vault, driven the way a reviewer drives it. Everything below
  // this is unit tested in isolation; what only a real browser can show is
  // that Chrome's WebCrypto, the options page and the review page agree — and
  // that a token sealed on one screen opens on another.
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  // The fixture seeds an already-unlocked token, which is the state this test
  // wants to reach on its own.
  await worker.evaluate(async () => {
    const api = (globalThis as unknown as {
      chrome: { storage: { session: { remove(keys: string): Promise<void> } } };
    }).chrome;
    await api.storage.session.remove('github-token-unlocked');
  });

  const PASSPHRASE = 'correct horse battery staple';
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await options.getByLabel('GitHub fine-grained personal access token').fill('ghp_fixture_token');
  // The passphrase fields only exist once encryption is asked for, which is
  // the point of this change: the default path never sees them.
  await options.getByLabel(/protect it with a passphrase/i).check();
  await options.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await options.getByLabel('Passphrase again').fill(PASSPHRASE);
  await options.getByRole('button', { name: 'Save token' }).click();
  await expect(options.getByText(/encrypted and saved/i)).toBeVisible();

  // Sealed, and usable straight away.
  const page = await context.newPage();
  await openReview(page, extensionId);
  await expect(page.locator('[data-file-card]').first()).toBeVisible();

  await options.getByRole('button', { name: 'Lock now' }).click();
  await expect(options.getByText(/^Locked\./)).toBeVisible();

  // A locked vault asks for a passphrase. It must not ask for a token — the
  // reviewer has one, and being told to make another reads as data loss.
  await page.reload();
  await expect(page.getByLabel('Passphrase')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open options' })).toBeVisible();

  await page.getByLabel('Passphrase').fill('not the passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/does not open this vault/i)).toBeVisible();
  await expect(page.locator('[data-file-card]')).toHaveCount(0);

  // And the right one brings the pull request back with no reload: unlocking
  // writes the token, which is the same storage event the page already
  // retries on.
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
  void api;
});

test('says nothing to the console unless the reviewer asked it to', async ({
  context,
  extensionId,
  api,
}) => {
  // The console belongs to whoever opened it, and this extension runs a
  // content script on every github.com page. Logging uninvited puts noise in
  // the middle of someone else's debugging, permanently.
  //
  // Asserted in a real browser rather than by unit test because the gate has
  // to hold in three separate module registries — the worker, the content
  // script and the page — each with its own copy of the flag.
  const noise: string[] = [];
  const watch = (target: Page) => {
    target.on('console', (msg) => {
      if (msg.text().includes('a-better-reviewer')) noise.push(msg.text());
    });
  };

  const pr = await context.newPage();
  watch(pr);
  await pr.goto('https://github.com/acme/widgets/pull/42');
  await expect(cta(pr)).toBeVisible({ timeout: 10_000 });

  const review = await context.newPage();
  watch(review);
  await openReview(review, extensionId);

  const options = await context.newPage();
  watch(options);
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByLabel(/write diagnostics/i)).toBeVisible();

  expect(noise).toEqual([]);
  void api;
});

test('takes the card away when the tab leaves the pull request, and brings it back', async ({
  context,
  extensionId,
  api,
}) => {
  void extensionId;
  void api;
  // A card offering to review a page the reviewer is no longer on is worse than
  // no card. Removing it used to be the easy half; putting it back was the bug,
  // because a latch meant to log once also gated the mount, so leaving a pull
  // request and returning left the extension with no entry point until a hard
  // reload — which is not a thing anyone thinks to try.
  const page = await context.newPage();
  await page.goto(PR_URL);
  await expect(cta(page)).toBeVisible();

  // Soft-navigate off the pull request, the way GitHub's own router does.
  await page.evaluate(() => history.pushState({}, '', '/acme/widgets/issues'));
  await expect(cta(page)).toHaveCount(0);

  // And back, more than once, because once is what the old latch survived.
  for (const _ of [0, 1]) {
    await page.evaluate(() => history.pushState({}, '', '/acme/widgets/pull/42'));
    await expect(cta(page)).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => history.pushState({}, '', '/acme/widgets/issues'));
    await expect(cta(page)).toHaveCount(0);
  }
});

/**
 * The bottom of the column is reachable, however tall the cards above it are.
 *
 * `CodeView` sizes a *collapsed* item at one global metric — read
 * `computeApproximateSize` in `VirtualizedFileDiff`: it adds the header region
 * and returns before the measured correction the expanded path applies. Every
 * rich comparison is a collapsed item whose custom header is 126-179px rather
 * than the ~44px the metric assumes, so the viewer under-counts the column once
 * per rich card and the error accumulates downward as scroll range it does not
 * know it owes.
 *
 * Which showed up as the last file of a review being unreadable: at maximum
 * scroll its header sat 627px into a 628px scrollport, with nowhere further to
 * go. `lib/review/columnTail.ts` buys the range back on the footer, which is
 * the one element whose height the viewer does measure.
 */
test('the last card can still be read when the column is full of rich ones', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  const cardTop = async (): Promise<number | null> =>
    page.evaluate(
      ([selector, path]) => {
        const view = document.querySelector(selector as string) as HTMLElement;
        const card = document.querySelector(`[data-file-card="${path}"]`);
        if (card === null) return null;
        return Math.round(
          card.getBoundingClientRect().top - view.getBoundingClientRect().top,
        );
      },
      [VIEW, TABLE_FILE] as const,
    );

  const scrollFraction = (fraction: number) =>
    page.evaluate(
      ([selector, value]) => {
        const view = document.querySelector(selector as string) as HTMLElement;
        view.scrollTop = (view.scrollHeight - view.clientHeight) * (value as number);
      },
      [VIEW, fraction] as const,
    );

  // Near the end first, and in its own turn: the viewer mounts a card only when
  // it is close to the viewport, and cannot mount anything while the thread is
  // still inside the `evaluate` that moved the scroll. This is also what proves
  // the card exists at all, so that its *absence* at the bottom below can only
  // mean it was scrolled past.
  await scrollFraction(0.9);
  await expect.poll(cardTop).not.toBeNull();

  await scrollFraction(1);
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        const view = document.querySelector(selector as string) as HTMLElement;
        return Math.round(view.scrollHeight - view.clientHeight - view.scrollTop);
      }, VIEW),
    )
    .toBe(0);

  // Either at the top of the scrollport, or scrolled clean past it — both mean
  // the column goes far enough. Before the tail was sized for rich cards this
  // sat at 627px into a 628px scrollport with nowhere further to go: the last
  // file of the review was on screen, and only its top edge was.
  const settled = await cardTop();
  expect(settled === null || settled < 80).toBe(true);
});

/**
 * The one measurement the whole card layout rests on.
 *
 * `CodeView` sizes every item's header from a single global metric and never
 * measures the element, so a header taller than that metric is scroll range the
 * viewer does not know it owes. It cost the last file of a review its
 * reachability, and it made the column jump past cards as it released them —
 * measured at 147px in one frame for a rendered Markdown card.
 *
 * The fix was to empty the header of everything whose height depends on the
 * file. This is what keeps it empty. It cannot be asserted anywhere but a
 * browser: jsdom performs no layout and reports every one of these as zero.
 */
test('no card header is taller than the height the viewer assumes', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // Every card, not just the first screen: the column virtualizes, and the
  // tall ones are the rich comparisons at the bottom.
  const tallest = new Map<string, number>();
  for (const fraction of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
    await page.evaluate(
      ([selector, value]) => {
        const view = document.querySelector(selector as string) as HTMLElement;
        view.scrollTop = (view.scrollHeight - view.clientHeight) * (value as number);
      },
      [VIEW, fraction] as const,
    );
    await page.waitForTimeout(400);
    for (const [path, height] of await page.evaluate(() =>
      [...document.querySelectorAll('[data-file-card]')].map(
        (node) =>
          [
            node.getAttribute('data-file-card') ?? '',
            Math.round(node.getBoundingClientRect().height),
          ] as const,
      ),
    )) {
      tallest.set(path, Math.max(tallest.get(path) ?? 0, height));
    }
  }

  // Enough of them to be worth the walk, and the rich ones among them.
  expect(tallest.size).toBeGreaterThan(FILES.length);
  expect(tallest.has(MARKDOWN_FILE)).toBe(true);
  expect(tallest.has(IMAGE_FILE)).toBe(true);

  const over = [...tallest].filter(([, height]) => height > HEADER_BUDGET);
  expect(over).toEqual([]);
});

/**
 * Markdown, rendered and marked, in a browser that will actually run things.
 *
 * The unit tests for this live in jsdom, and jsdom cannot answer the question
 * that matters: it loads no images, so an `onerror` never fires, and it runs no
 * script assigned through `innerHTML`. An assertion that nothing was executed
 * passes there whether or not anything is sanitising. Chrome will do both, so
 * this is the only place the sanitiser is really tested — and the origin it
 * defends holds a GitHub token.
 */
test('a rendered Markdown diff marks the prose and executes none of it', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  const row = page.locator(`[data-path="${MARKDOWN_FILE}"]`);
  await row.click();

  const card = fileBody(page, MARKDOWN_FILE);
  await expect(card.locator('.markdown-rendered')).toBeVisible();

  // The word that changed is marked in place, which is the whole point of a
  // rendered *diff* rather than a rendered preview.
  await expect(card.locator('.markdown-rendered ins')).toContainText('structured');
  await expect(card.locator('.markdown-rendered del')).toContainText('plain');

  // Nothing that can fetch, run, or navigate survived into the document.
  const rendered = card.locator('.markdown-rendered');
  await expect(rendered.locator('img')).toHaveCount(0);
  await expect(rendered.locator('script')).toHaveCount(0);
  await expect(rendered.locator('iframe')).toHaveCount(0);
  await expect(rendered.locator('[onerror]')).toHaveCount(0);
  await expect(rendered.locator('a[href^="javascript:"]')).toHaveCount(0);

  // And the payload's own report: it sets this from three different places.
  expect(await page.evaluate(() => (globalThis as { __pwned?: boolean }).__pwned)).toBe(
    undefined,
  );
});
