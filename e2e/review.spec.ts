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
  ADDED_FILE,
  BASE_SHA,
  DELETED_FILE,
  EXEMPTED_FILE,
  FILES,
  FIRST_SHA,
  GENERATED_FILE,
  IMAGE_FILE,
  MARKDOWN_FILE,
  PRIOR_SHA,
  REINDENTED_FILE,
  TABLE_FILE,
  THREADS,
  UNEVEN_FILE,
} from './fixture';
import { expect, reviewUrl, test } from './extension';
import type { BrowserContext, Page } from '@playwright/test';

/** The scrollport `CodeView` was handed. */
const VIEW = '.diff-view';

/**
 * Every file in the column, in the order `UNIFIED_DIFF` concatenates them.
 *
 * `FILES` alone is not the column. Five more follow it — the image, the table,
 * and the added, deleted and unevenly-modified files — and a walk down the
 * column reaches all of them.
 */
const COLUMN_ORDER = [
  ...FILES,
  GENERATED_FILE,
  EXEMPTED_FILE,
  REINDENTED_FILE,
  IMAGE_FILE,
  TABLE_FILE,
  ADDED_FILE,
  DELETED_FILE,
  UNEVEN_FILE,
] as const;

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
  const kebab = page.getByRole('button', { name: /commit options/i });
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

/**
 * What the page cannot vouch for, in the bar rather than under it.
 *
 * A fine-grained token that grants the repository but not `Checks` gets the
 * whole pull request back with `statusCheckRollup` nulled and one error beside
 * it. That used to open a banner between the top bar and the diff; it is now a
 * section of a panel behind one control in the bar, and the thing to prove in a
 * real browser is that the control is reachable, that what is behind it is the
 * same sentence as before, and that a page with a caveat on it is not a page
 * with a row taken off the top of the diff.
 */
test('a refused permission is named in the bar, not banded across the page', async ({
  context,
  extensionId,
  api,
}) => {
  api.deniedPath = [
    'repository',
    'pullRequest',
    'commits',
    'nodes',
    0,
    'commit',
    'statusCheckRollup',
  ];

  const page = await context.newPage();
  await openReview(page, extensionId);

  // Nothing between the bar and the diff: the caveat costs the review no
  // vertical space at all until it is asked for.
  await expect(page.locator('.notice-panel')).toHaveCount(0);

  const trigger = page.getByRole('button', { name: /partly hidden/i });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('data-tone', 'incomplete');

  await trigger.click();
  const panel = page.getByRole('dialog', { name: /cannot show/i });
  await expect(panel).toContainText(/would not show this token the status checks/i);
  // And GitHub's own words, for pasting into a bug report.
  await expect(panel).toContainText(/not accessible by personal access token/i);

  // It hangs below the bar rather than being clipped inside it.
  const bar = await page.locator('.topbar').boundingBox();
  const box = await panel.boundingBox();
  expect(bar).not.toBeNull();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0)).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0));
  expect(box?.height ?? 0).toBeGreaterThan(40);

  // Escape leaves it, and the keyboard lands back where it started.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

/**
 * A read-only account, which is the state the page used to be least legible in.
 *
 * Every refusal arrived on its own: a greyed-out Resolve with a tooltip nobody
 * without a mouse could read, and — before this — a Start a review that opened
 * a pending review GitHub would refuse to submit, stranding every comment
 * queued on it. Nothing said why, and nothing connected the two.
 */
test('an account that can only read is told so once, not control by control', async ({
  context,
  extensionId,
  api,
}) => {
  api.viewerPermission = 'READ';

  const page = await context.newPage();
  await openReview(page, extensionId);

  // Not offered at all: a review that can be opened and never submitted is
  // worse than no button, because the comments on it are invisible until it is.
  await expect(page.getByRole('button', { name: /start a review/i })).toHaveCount(0);

  const trigger = page.getByRole('button', { name: /read-only/i });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('data-tone', 'blocked');

  await trigger.click();
  const panel = page.getByRole('dialog', { name: /cannot show/i });
  await expect(panel).toContainText(/read-only on this repository/i);
  // Both remedies, in the order they are worth trying.
  await expect(panel).toContainText(/pull requests: read and write/i);
  await expect(panel.getByRole('button', { name: /check your token/i })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // And the diff is still there to read, which is most of what this page is
  // for. A permission problem is not a reason to replace a pull request.
  await expect(page.locator('[data-file-card]').first()).toBeVisible();
});

test('an ordinary account is offered a review and told nothing about permissions', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  await expect(page.getByRole('button', { name: /start a review/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /read-only/i })).toHaveCount(0);
});

/**
 * The three files that are not a one-for-one edit.
 *
 * Every other file in the fixture swaps one line for one line, which meant the
 * tree only ever drew `M +1 −1` — so `A`, `D` and an asymmetric pair of counts
 * were rendered by nothing, anywhere, and the store screenshots showed a pull
 * request in which nothing is ever only added or only removed.
 */
test('the tree marks what was added and what was deleted', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  const expected = [
    {
      path: ADDED_FILE,
      status: 'added',
      letter: 'A',
      additions: '+4',
      deletions: '−0',
      line: 'const entries = new Map();',
    },
    {
      path: DELETED_FILE,
      status: 'deleted',
      letter: 'D',
      additions: '+0',
      deletions: '−3',
      line: 'export default memo;',
    },
    // Modified, but unevenly: the counts differ, which is the case a fixture of
    // one-line swaps can never produce.
    {
      path: UNEVEN_FILE,
      status: 'modified',
      letter: 'M',
      additions: '+2',
      deletions: '−3',
      line: `old alpha of ${UNEVEN_FILE}`,
    },
  ];

  for (const file of expected) {
    const row = page.locator(`[data-path="${file.path}"]`);
    await expect(row).toHaveAttribute('data-status', file.status);
    await expect(row.locator('.tree-status')).toHaveText(file.letter);
    await expect(row.locator('.additions')).toHaveText(file.additions);
    await expect(row.locator('.deletions')).toHaveText(file.deletions);
  }

  // And they are counted into the bar above the column rather than only drawn
  // in the rail.
  await expect(page.locator('.scope-status')).toContainText(
    `${COLUMN_ORDER.length} files changed`,
  );

  // And each of the three really draws. The counts above come from GraphQL, so
  // they would be right even if the patches were malformed — and a hunk header
  // whose line counts do not add up is exactly the kind of thing a hand-written
  // fixture gets wrong, and exactly the kind of thing a renderer drops in
  // silence. Reached through the tree, which is what scrolls the column to a
  // card that has not been virtualized in yet.
  for (const file of expected) {
    await page.locator(`[data-path="${file.path}"]`).click();
    await expect(page.locator(`[data-file-card="${file.path}"]`)).toBeVisible();
    await expect(page.getByText(file.line, { exact: true })).toBeVisible();
  }

  // The uneven file's second hunk too, which is the one that only adds: it is
  // twenty lines below the one that only removes, and everything between them
  // is numbered three apart on the two sides.
  await expect(
    page.getByText(`new delta of ${UNEVEN_FILE}`, { exact: true }),
  ).toBeVisible();
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

/**
 * The Overview's right-hand column: everything a reviewer picks from or checks.
 *
 * Checked in a browser rather than in jsdom because both claims here are about
 * layout. That the commit log is *in* that column is structural and jsdom can
 * see it; that it still reads at 340px, with its subjects on their own line
 * above the sha, needs something that lays out.
 */
test('the overview gathers what is pickable in one column, commits last', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await openView(page, /overview/i);

  const meta = page.locator('.overview-meta');
  await expect(meta.locator('h2')).toHaveText([
    'Branches',
    'Checks',
    'Reviewers',
    'Commits',
  ]);
  // Not under the description, where a description of ordinary length pushed
  // it off the bottom of the view.
  await expect(page.locator('.overview-main .commit-log')).toHaveCount(0);

  // The subject sits above the sha rather than beside it, which is what buys
  // it the width to be worth reading in a column this narrow.
  const rows = await meta.locator('.commit-log-open').first().evaluate((node) => {
    const headline = node.querySelector('.commit-log-headline')?.getBoundingClientRect();
    const meta = node.querySelector('.commit-log-meta')?.getBoundingClientRect();
    return { headline: headline?.top ?? 0, meta: meta?.top ?? 0, width: headline?.width ?? 0 };
  });
  expect(rows.meta).toBeGreaterThan(rows.headline);
  expect(rows.width).toBeGreaterThan(180);
});

/**
 * The rail's way out, which only a real extension can prove works.
 *
 * `runtime.openOptionsPage` is the whole of the mechanism, and it is exactly
 * the part jsdom stubs away: the unit test asserts the call, and this asserts
 * that the call lands on a page with the settings on it.
 */
test('the rail opens the options page, without leaving the review', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  const opened = context.waitForEvent('page');
  // Scoped and exact: the diff's kebab is called "Commit options", and a
  // substring match on "Options" finds both.
  await page
    .locator('.viewswitcher')
    .getByRole('button', { name: 'Options', exact: true })
    .click();
  const options = await opened;

  await expect(options).toHaveURL(new RegExp(`^chrome-extension://${extensionId}/options.html`));
  await expect(options.getByRole('heading', { name: /reading a diff/i })).toBeVisible();

  // A new tab, not this one. The review is a page a reviewer is midway
  // through, and replacing it to change a checkbox would cost them their
  // scroll position and every line of context they expanded.
  await expect(page.locator('.shell')).toBeVisible();
  await options.close();
});

test('each branch opens that branch on GitHub', async ({ context, extensionId, api }) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await openView(page, /overview/i);

  const branches = page.locator('.overview-branches');
  await expect(branches.getByRole('link', { name: 'main' })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/tree/main',
  );
  await expect(branches.getByRole('link', { name: 'cache-the-diff' })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/tree/cache-the-diff',
  );
});

test('scrolling the diff column walks the tree selection forward, in file order', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // The whole column, not just `FILES`: the image, the table and the three
  // uneven files follow it in `UNIFIED_DIFF`, and the walk reaches them now that
  // the tail gives the column the scroll range its rich cards were costing it.
  const order = new Map<string, number>(
    COLUMN_ORDER.map((path, index) => [path, index]),
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
  // Polled rather than read once: the fourth is sent after the submit resolves,
  // so a straight read here catches the sequence one trip short.
  const reads = ['PullRequestReview', 'ViewerPendingReview', 'PullRequestCommits'];
  await expect
    .poll(() => api.operations.filter((name) => !reads.includes(name)))
    .toEqual(['StartReview', 'AddThread', 'SubmitReview', 'ThreadPermissions']);
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
 * The comment you just posted can be resolved, without reloading first.
 *
 * `addPullRequestReviewThread` can only write into a PENDING review, so the
 * thread it hands back is described as one nobody else can see — and not
 * everything is permitted on one of those. The page kept that description after
 * submitting the review, so a reviewer posted a comment and met a Resolve
 * button they could not press on a conversation plainly in front of them.
 * Reloading fixed it, which was the tell: only the copy on the page was stale.
 *
 * In a browser rather than in jsdom because the fourth round trip is the fix,
 * and the fixture answers it the way GitHub does — unresolvable on the way in,
 * resolvable once the review is submitted.
 */
test('a comment just posted can be resolved without reloading', async ({
  context,
  extensionId,
  api,
}) => {
  const page = await context.newPage();
  await openReview(page, extensionId);

  const gutter = page
    .locator('diffs-container')
    .first()
    .locator('[data-column-number][data-line-type="change-addition"]')
    .first();
  await gutter.click();
  await page.locator('body').press('c');

  const box = page.getByRole('textbox', { name: /comment on src\/app\.ts/i });
  await expect(box).toBeVisible();
  await box.fill('Resolvable straight away.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();

  const posted = filesView(page)
    .locator('[data-thread="PRRT_posted"]')
    .last();
  await expect(posted.getByText('Resolvable straight away.')).toBeVisible();

  // The assertion the bug was: enabled, on the page the comment was written on.
  await expect(posted.getByRole('button', { name: /resolve conversation/i })).toBeEnabled();

  // Asked for, rather than guessed at. Submitting a review does not by itself
  // earn the right to resolve — read access is enough to review a repository
  // and not enough to resolve on it.
  expect(api.operations).toContain('ThreadPermissions');
  expect(api.variables[api.operations.indexOf('ThreadPermissions')]?.['ids']).toEqual([
    'PRRT_posted',
  ]);

  // And it works, rather than merely looking as though it would.
  await posted.getByRole('button', { name: /resolve conversation/i }).click();
  await expect
    .poll(() => api.operations.filter((name) => name === 'ResolveThread').length)
    .toBe(1);
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
  // Escape leaves it, which needs the overlay to have taken focus on the way
  // in: the key is read on the panel, not on the document. Pressed through the
  // dialog rather than through `body` for that reason.
  await help.press('Escape');
  await expect(help).toBeHidden();

  // And its own button still does too.
  await body.press('?');
  await expect(help).toBeVisible();
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
  const filter = page.getByRole('dialog', { name: /jump to a file/i });
  await expect(filter).toBeVisible();

  // Escape has to work from the results, not just from the input. The results
  // are real buttons, so one Tab leaves the field — and a handler bound to the
  // field never sees the key from there. That left a dialog the keyboard could
  // enter and could not leave.
  await page.keyboard.press('Tab');
  await expect(filter.locator('.search-result:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(filter).toBeHidden();
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

/**
 * The options page reaching an open review, twice over.
 *
 * Both of these used to be controls on the review itself, remembered for the
 * session and no longer. They are settings now, which makes the chain much
 * longer — a checkbox on one extension page, `storage.local`, a change event,
 * a hook, four components and an option handed to Pierre — and every seam in
 * it is a place a value can be dropped in a way jsdom cannot see.
 *
 * Driven by ticking the real checkbox rather than by writing storage directly.
 * Writing storage would skip the half of the chain most likely to break: that
 * the options page writes the field the review reads.
 */
async function setPreference(
  context: BrowserContext,
  extensionId: string,
  name: RegExp,
): Promise<void> {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const box = options.getByRole('checkbox', { name });
  await expect(box).toBeVisible();
  await box.check();
  await expect(box).toBeChecked();
  await options.close();
}

test('split view is a setting, and reaches a review that is already open', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The layout is the one thing jsdom cannot check at all — it performs no
  // layout — and this is a preference whose entire job is layout. §B.3 promises
  // that moving between the two needs no annotation change; here is that
  // promise against the production build, in a browser that lays out.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const diff = page.locator('diffs-container').first().locator('[data-diff-type]').first();
  await expect(diff).toHaveAttribute('data-diff-type', 'single');

  // Ticked while this review is open, and it has to land here without a
  // reload — a setting that needs the tab restarted reads as one that does not
  // work.
  await setPreference(context, extensionId, /side by side/i);

  await expect(diff).toHaveAttribute('data-diff-type', 'split');
  // Still real, highlighted, numbered code — not an empty two-column frame.
  await expect(
    page.locator('diffs-container').first().locator('[data-column-number]').first(),
  ).toBeVisible();
  // And the thread that was anchored in unified is still anchored in split.
  await expect(
    page.getByLabel('Diff').getByText('This allocates on every call.'),
  ).toBeVisible();

  // A rich comparison gets the whole card here, not one column of it.
  //
  // Its card hands Pierre an empty diff, so both split columns hold nothing but
  // the file-level annotation the body sits in — and Pierre sizes annotation
  // content to a single column. Left alone, a rendered Markdown document drew
  // 405px inside an 880px card, beside a 440px column with nothing in it.
  // `FULL_WIDTH_RICH_BODY` collapses the empty pair; this is the only honest
  // check of it, because jsdom performs no layout and the rule lives inside a
  // shadow root.
  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();
  const rendered = fileBody(page, MARKDOWN_FILE).locator('.markdown-rendered');
  await expect(rendered).toBeVisible();

  // Measured against the column, not against an ancestor of the body: the body
  // is light DOM slotted into a shadow row, so `closest()` stops at the
  // annotation wrapper — which is itself the single column being complained
  // about, and comparing the two gives 405 of 407 whether the rule is there or
  // not.
  const fit = await rendered.evaluate((element) => {
    const column = document.querySelector('diffs-container');
    return {
      body: element.getBoundingClientRect().width,
      column: column === null ? 0 : column.getBoundingClientRect().width,
    };
  });
  // Generous on purpose: the exact figure moves with the viewport and with
  // Pierre's own padding. Half a column is the failure being guarded against,
  // and without the rule this measures 0.46.
  expect(fit.column).toBeGreaterThan(0);
  expect(fit.body / fit.column).toBeGreaterThan(0.85);
});

test('a diff read without its whitespace says so, on the row of each file it shortened', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The caveat is the requirement, not the decoration: the body under it is not
  // what anybody else on this pull request is looking at, and the reviewer did
  // not shorten it on this page — they ticked a box on another one, quite
  // possibly weeks ago.
  //
  // Which is why the setting goes on *before* the review opens. That is the
  // state a reviewer actually lives in, and it is the one where the caveat has
  // to carry itself with no recent action to remind them. Ticking it against an
  // open review is a different claim and `split view` already makes it.
  //
  // In the real build because it is the shipped stylesheet that has to make the
  // flag visible without letting the head row grow.
  await setPreference(context, extensionId, /whitespace moved/i);

  const page = await context.newPage();
  await openReview(page, extensionId);

  // The last of twenty files, so it is virtualized out until the tree scrolls
  // the column to it.
  await page.locator(`[data-path="${REINDENTED_FILE}"]`).click();
  await expect(page.locator(`[data-file-card="${REINDENTED_FILE}"]`)).toBeVisible();

  const flag = page.locator(`[data-file-card="${REINDENTED_FILE}"] .whitespace-flag`);
  const indentedRows = page
    .locator('diffs-container')
    .filter({ has: page.locator(`[data-file-card="${REINDENTED_FILE}"]`) });
  await expect(flag).toBeVisible();
  await expect(flag).toHaveText(/whitespace hidden/i);
  // The words that used to be a paragraph in the body, kept where a pointer and
  // a screen reader can each still reach them.
  await expect(flag).toHaveAttribute('title', /not the diff GitHub is showing/i);
  // Named by the two words and described by the sentence they stand for, so a
  // screen reader reaching the button does not have to hear three sentences to
  // learn which file it is on.
  const describedBy = await flag.getAttribute('aria-describedby');
  await expect(page.locator(`#${describedBy ?? 'missing'}`)).toContainText(
    /comments still attach to GitHub/i,
  );

  // The per-file button that used to turn this on is gone: one question, one
  // switch.
  await expect(
    page.locator(`[data-file-card="${REINDENTED_FILE}"]`).getByRole('button', {
      name: /ignore whitespace/i,
    }),
  ).toHaveCount(0);

  // And the rewrite really landed, which is what the flag is claiming. Counted
  // in change rows rather than by looking for a vanished line, because the
  // reindented line does not vanish — it stops being a change and becomes a
  // context line, which is the entire trick. GitHub's patch has two of each;
  // the drawn one has one.
  await expect(
    indentedRows.locator('[data-column-number][data-line-type="change-addition"]'),
  ).toHaveCount(1);
  await expect(
    page.getByText(`new body of ${REINDENTED_FILE}`, { exact: true }),
  ).toBeVisible();

  // And it is the way back, not merely a label. Pressing it restores GitHub's
  // own patch for this one file, without disturbing the setting.
  await expect(flag).toHaveAttribute('aria-pressed', 'false');
  await flag.click();

  // Back to the file: restoring GitHub's patch rebuilds the column under a new
  // key, and a card twenty files down is virtualized out by that. By way of
  // another row, because the tree still holds this one as the current file and
  // choosing the file you are already on scrolls nowhere.
  await page.locator('[data-path="src/app.ts"]').click();
  await page.locator(`[data-path="${REINDENTED_FILE}"]`).click();
  await expect(flag).toHaveAttribute('aria-pressed', 'true');
  await expect(flag).toHaveText(/whitespace shown/i);
  // Both changes are changes again, which is the point of asking for it.
  await expect(
    indentedRows.locator('[data-column-number][data-line-type="change-addition"]'),
  ).toHaveCount(2);

  // Nothing on a file it had nothing to take out of. With the setting on for
  // the whole pull request, a caveat on all twenty is one nobody reads on the
  // one that needed it.
  await page.locator('[data-path="src/app.ts"]').click();
  await expect(page.locator('[data-file-card="src/app.ts"]')).toBeVisible();
  await expect(
    page.locator('[data-file-card="src/app.ts"] .whitespace-flag'),
  ).toHaveCount(0);

  // The column survived being built under the setting: there is still code.
  await expect(
    page.locator('diffs-container').first().locator('[data-column-number]').first(),
  ).toBeVisible();
});

/**
 * Folding away the files nobody wrote, and the repository's veto.
 *
 * GitHub answers this question over no API at all — see
 * `lib/review/generated.ts` — so the whole mechanism is ours: a pattern list,
 * and `.gitattributes` fetched at the head commit through the same contents
 * endpoint the diff expander uses. Only a real browser can show that the second
 * of those actually arrives, since it crosses the worker, the message channel
 * and a cache.
 */
test('a generated file is folded to its header, unless the repository says otherwise', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  await setPreference(context, extensionId, /generated files/i);

  const page = await context.newPage();
  await openReview(page, extensionId);

  // Folded: a header, a flag saying why, and no rows under it.
  await page.locator(`[data-path="${GENERATED_FILE}"]`).click();
  const generated = page.locator(`[data-file-card="${GENERATED_FILE}"]`);
  await expect(generated).toBeVisible();
  const flag = generated.getByRole('button', { name: 'Generated' });
  await expect(flag).toBeVisible();
  await expect(flag).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByText(`new ${GENERATED_FILE}`, { exact: true }),
  ).toHaveCount(0);

  // Nothing about it is hidden, only its reading: GitHub's own counts are still
  // on the row, which is what makes this different in kind from ignoring
  // whitespace.
  await expect(generated.locator('.additions')).toHaveText('+2');

  // The repository declared this one hand-written despite living under
  // `dist/**`, and that has to beat any pattern of ours.
  await page.locator(`[data-path="${EXEMPTED_FILE}"]`).click();
  const exempted = page.locator(`[data-file-card="${EXEMPTED_FILE}"]`);
  await expect(exempted).toBeVisible();
  await expect(exempted.getByRole('button', { name: 'Generated' })).toHaveCount(0);
  await expect(page.getByText(`new ${EXEMPTED_FILE}`, { exact: true })).toBeVisible();
});

test('a folded file opens when the reviewer presses the word on its row', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The escape hatch. One press, on the same control that explained the folding
  // — a separate "show anyway" beside the word would be two controls for one
  // thought.
  await setPreference(context, extensionId, /generated files/i);

  const page = await context.newPage();
  await openReview(page, extensionId);
  await page.locator(`[data-path="${GENERATED_FILE}"]`).click();

  const flag = page
    .locator(`[data-file-card="${GENERATED_FILE}"]`)
    .getByRole('button', { name: 'Generated' });
  await flag.click();

  await expect(flag).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(`new ${GENERATED_FILE}`, { exact: true })).toBeVisible();
});

test('nothing is folded until the setting asks for it', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);
  await page.locator(`[data-path="${GENERATED_FILE}"]`).click();

  await expect(
    page.locator(`[data-file-card="${GENERATED_FILE}"]`).getByRole('button', {
      name: 'Generated',
    }),
  ).toHaveCount(0);
  await expect(page.getByText(`new ${GENERATED_FILE}`, { exact: true })).toBeVisible();
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
/**
 * Marking a file viewed folds it, and folding it takes the switcher with it.
 *
 * In a browser because the two halves that matter are layout: a folded card
 * has to actually stop drawing a body, and folding the mode switcher away is
 * what takes a card's header from 70px back to the 44px `CodeView` assumes it
 * to be. jsdom performs no layout and would report every height as zero.
 */
test('a file marked viewed folds away, switcher and all', async ({
  context,
  extensionId,
  api,
}) => {
  const page = await context.newPage();
  await openReview(page, extensionId);

  // A rich card, because it is the one that used to refuse to fold at all —
  // its comparison lived in the header — and the one whose switcher is the
  // second header row.
  await page.locator(`[data-path="${TABLE_FILE}"]`).click();
  const card = page.locator(`[data-file-card="${TABLE_FILE}"]`);
  await expect(card).toBeVisible();
  const switcher = card.getByRole('group', { name: new RegExp(`Compare ${TABLE_FILE}`) });
  await expect(switcher).toBeVisible();
  await expect(page.locator(`[data-file-body="${TABLE_FILE}"]`)).toBeVisible();

  const open = (await card.boundingBox())?.height ?? 0;

  await card.getByRole('checkbox', { name: new RegExp(TABLE_FILE) }).check();

  // The body goes, the switcher goes with it, and the card is shorter for it.
  await expect(page.locator(`[data-file-body="${TABLE_FILE}"]`)).toHaveCount(0);
  await expect(switcher).toHaveCount(0);
  const folded = (await card.boundingBox())?.height ?? 0;
  expect(folded).toBeLessThan(open);
  // Back to the one row `CodeView` models every header as.
  expect(folded).toBeLessThanOrEqual(HEADER_BUDGET);

  // And the way back is still on the card, or the fold would be a trap.
  await card.getByRole('button', { name: /expand/i }).click();
  await expect(switcher).toBeVisible();
  await expect(page.locator(`[data-file-body="${TABLE_FILE}"]`)).toBeVisible();

  expect(api.operations).toContain('MarkViewed');
});

test('a file that was already viewed opens folded on the next load', async ({
  context,
  extensionId,
  api,
}) => {
  // The reload half of the same claim, and the only honest way to ask it: the
  // mark is made through the UI, kept by the fake the way GitHub keeps it, and
  // read back on a fresh page — which also proves the worker drops its cached
  // copy of the pull request when the reviewer changes it.
  //
  // `MARKDOWN_FILE` rather than the table above, and not by preference:
  // `IMAGE_FILE` and `TABLE_FILE` are deliberately absent from the pull
  // request's own file list — see `FILES` — so they have no `viewerViewedState`
  // to come back as anything. This one is in the list *and* is a rich card,
  // so the switcher is in the question too.
  const page = await context.newPage();
  await openReview(page, extensionId);

  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();
  const first = page.locator(`[data-file-card="${MARKDOWN_FILE}"]`);
  await expect(first).toBeVisible();
  await first.getByRole('checkbox', { name: new RegExp(MARKDOWN_FILE) }).check();
  await expect.poll(() => api.viewedPaths.has(MARKDOWN_FILE)).toBe(true);

  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();

  const card = page.locator(`[data-file-card="${MARKDOWN_FILE}"]`);
  await expect(card).toBeVisible();
  // Folded, with no body and no switcher, without the reviewer touching it.
  await expect(card.getByRole('button', { name: /expand/i })).toBeVisible();
  await expect(page.locator(`[data-file-body="${MARKDOWN_FILE}"]`)).toHaveCount(0);
  await expect(
    card.getByRole('group', { name: new RegExp(`Compare ${MARKDOWN_FILE}`) }),
  ).toHaveCount(0);
  expect((await card.boundingBox())?.height ?? 0).toBeLessThanOrEqual(HEADER_BUDGET);

  // A file they have not finished with is untouched by any of this.
  await page.locator('[data-path="src/app.ts"]').click();
  await expect(
    page.locator('[data-file-card="src/app.ts"]').getByRole('button', {
      name: /collapse/i,
    }),
  ).toBeVisible();
});

test('no card header is taller than the height the viewer assumes', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // Every card, not just the first screen: the column virtualizes, and the
  // tall ones are the rich comparisons near the bottom.
  //
  // Driven through the tree rather than by scrolling to a handful of fractions.
  // Fractions only sample, so which cards a run happened to catch depended on
  // how many files the fixture had — adding one moved the sampling off the
  // Markdown card and the test failed for a reason that had nothing to do with
  // header heights. A row per file misses none of them.
  const tallest = new Map<string, number>();
  for (const path of COLUMN_ORDER) {
    await page.locator(`[data-path="${path}"]`).click();
    await expect(page.locator(`[data-file-card="${path}"]`)).toBeVisible();
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

  // Every one of them, which is what walking the tree buys over sampling.
  expect([...COLUMN_ORDER].filter((path) => !tallest.has(path))).toEqual([]);

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
  //
  // Scoped to the prose. The document also carries a Mermaid diagram whose
  // source changed, and its marks are inside a `<pre>` — a different claim,
  // asserted by the diagram test below.
  await expect(card.locator('.markdown-rendered p ins')).toContainText('structured');
  await expect(card.locator('.markdown-rendered p del')).toContainText('plain');

  // Nothing that can fetch, run, or navigate survived into the document.
  //
  // The image assertion is by `src`, not by tag, and the distinction is the
  // whole rule rather than a loosening of it. `FORBIDDEN_TAGS` strips every
  // `<img>` the pull request wrote, whatever it points at — the payload's own
  // `<img src="x" onerror=…>` is in the fixture to prove it. The only images
  // that can be here are the ones this page built itself for the Mermaid
  // diagrams, and those hold a `data:` URL, which is not a request. What was
  // ever being defended is "no fetch to anywhere from a `.md` file", and
  // counting by `src` says that where counting by tag only stood in for it.
  const rendered = card.locator('.markdown-rendered');
  await expect(rendered.locator('img:not([src^="data:"])')).toHaveCount(0);
  await expect(rendered.locator('script')).toHaveCount(0);
  await expect(rendered.locator('iframe')).toHaveCount(0);
  await expect(rendered.locator('[onerror]')).toHaveCount(0);
  await expect(rendered.locator('a[href^="javascript:"]')).toHaveCount(0);

  // And the payload's own report: it sets this from three different places.
  expect(await page.evaluate(() => (globalThis as { __pwned?: boolean }).__pwned)).toBe(
    undefined,
  );
});

/**
 * Mermaid, in a real browser, on the production build.
 *
 * The only honest check there is. Mermaid measures text with `getBBox` and
 * `getComputedTextLength`, neither of which jsdom implements, so every unit
 * test of this draws through a mock — which says nothing about whether the
 * real renderer loads its chunk inside an MV3 extension page, or whether
 * anything comes out of it. Both are settled here.
 */
test('a Mermaid diagram in a .md file is drawn rather than left as its source', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();
  const card = fileBody(page, MARKDOWN_FILE);
  await expect(card.locator('.markdown-rendered')).toBeVisible();

  // Both diagrams drawn. The chunk is lazy, so this is also the assertion
  // that it is fetchable from the packaged extension at all.
  const drawn = card.locator('.md-diagram img');
  await expect(drawn).toHaveCount(2);

  // Into an image holding a `data:` URL — never inlined as SVG into an origin
  // that holds a GitHub token. See the note in `ui/markdownHtml.ts`.
  await expect(drawn.first()).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await expect(card.locator('.markdown-rendered svg')).toHaveCount(0);

  /** The SVG behind one of the drawn images. */
  const sourceOf = (index: number): Promise<string> =>
    drawn.nth(index).evaluate((node) => {
      const { src } = node as HTMLImageElement;
      return atob(src.slice(src.indexOf(',') + 1));
    });

  // A real drawing rather than an empty frame: the labels from the source
  // came through.
  const first = await sourceOf(0);
  expect(first).toContain('<svg');
  expect(first).toContain('Render');

  // The unchanged diagram folds its source away, because the source is then
  // the picture written out longhand.
  await expect(card.locator('pre.md-diagram-drawn')).toHaveCount(1);

  // The changed one keeps it, because a drawn diagram carries no marks and
  // the old version is not on screen — the marked-up source below it is the
  // only place the change is visible.
  const kept = card.locator('pre.md-diagram-source');
  await expect(kept).toHaveCount(1);
  await expect(kept.locator('ins')).toContainText('Accept');
  await expect(kept.locator('del')).toContainText('Reject');

  // And it is the *new* version that was drawn. The block holds both sides
  // interleaved by then, so reconstructing this one is the whole job of
  // `mermaidBlocks.ts`.
  const second = await sourceOf(1);
  expect(second).toContain('Accept');
  expect(second).not.toContain('Reject');
});

/**
 * The other `.md` file in the column, and the one nothing here presses.
 *
 * Named here rather than in the fixture because nothing else wants it. Its
 * whole job is to be a Markdown card the reviewer never touched, which is what
 * tells a preference apart from a choice about one file. `MARKDOWN_FILE` is
 * served real Markdown and this one is not, and that is fine: the claim made
 * of it is about which button is pressed, not about what the body draws.
 */
const SECOND_MARKDOWN_FILE = 'docs/changelog.md';

/**
 * The Markdown mode, across a reload.
 *
 * The only honest check there is of it. The preference lives in
 * `browser.storage.local`, and every unit test of that hands the code a fake —
 * so "it persists" has so far been a claim about a `Map` in the test process
 * rather than about a browser profile. The pair that has never run is the one
 * that matters: a write from an extension page, and a read back by a page that
 * was loaded from nothing.
 */
test('the markdown mode outlives the page', async ({ context, extensionId, api }) => {
  void api;
  const page = await context.newPage();
  await openReview(page, extensionId);

  // Through the tree rather than by scrolling. The column virtualizes and this
  // card is far enough down it that nothing has mounted it yet, so there is no
  // card to scroll into view until a row puts one there.
  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();
  const raw = page
    .locator(`[data-file-card="${MARKDOWN_FILE}"]`)
    .getByRole('button', { name: 'Raw', exact: true });
  // Scoped to the body, which is a separate element from the card — see
  // `fileBody`. Looked for inside the card, `.markdown-rendered` is absent in
  // either mode, and every assertion below would hold without testing one.
  const prose = fileBody(page, MARKDOWN_FILE).locator('.markdown-rendered');

  // Where a `.md` card opens when nobody has ever said otherwise.
  await expect(raw).toHaveAttribute('aria-pressed', 'false');
  await expect(prose).toBeVisible();

  await raw.click();
  await expect(raw).toHaveAttribute('aria-pressed', 'true');
  await expect(prose).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  await page.locator(`[data-path="${MARKDOWN_FILE}"]`).click();

  // Nothing was pressed on this page, and the card is raw anyway.
  await expect(raw).toHaveAttribute('aria-pressed', 'true');
  await expect(prose).toHaveCount(0);

  // And so is the `.md` file that was never pressed on either page, which is
  // the half a per-file memory would fail: remembering the *file* would bring
  // this one back rendered and still satisfy everything above.
  await page.locator(`[data-path="${SECOND_MARKDOWN_FILE}"]`).click();
  await expect(
    page
      .locator(`[data-file-card="${SECOND_MARKDOWN_FILE}"]`)
      .getByRole('button', { name: 'Raw', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the syntax theme is the reviewer\'s, and choosing one lets it colour the diff', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The only honest check of this. The theme is resolved by Shiki at runtime
  // and painted into a shadow root as inline token colours, so nothing short of
  // a real browser on the production build can say whether a choice took.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const tokenColours = () =>
    page.evaluate(() => {
      const root = document.querySelector('diffs-container')?.shadowRoot;
      const spans = [...(root?.querySelectorAll('[style*="--diffs-token"]') ?? [])];
      return {
        // Deduplicated: what matters is the palette, not how many spans wear it.
        colours: [
          ...new Set(
            spans.map((span) => span.getAttribute('style') ?? '').filter(Boolean),
          ),
        ].sort(),
        // Set only once a theme has been chosen, and what releases this page's
        // Primer overrides on the added and removed lines.
        chosen: document.documentElement.getAttribute('data-syntax-theme'),
        addition: getComputedStyle(document.documentElement).getPropertyValue(
          '--diffs-addition-color-override',
        ),
      };
    });

  // Waited for rather than read straight off. The diff is on screen well before
  // Shiki has highlighted it — the highlighter and the theme are both lazy
  // chunks — so a bare read here finds no tokens at all on a machine that is
  // busy, which is what a full suite run is and a single test is not.
  await expect
    .poll(async () => (await tokenColours()).colours.length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const before = await tokenColours();
  // Untouched, the page still overrides Pierre's green with Primer's.
  expect(before.chosen).toBeNull();
  expect(before.addition.trim()).not.toBe('');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#diffTheme').selectOption('github-light-high-contrast');
  await options.close();

  // Polled on the colours rather than on the attribute, and that distinction is
  // the test. The attribute is set synchronously by an effect the moment the
  // setting lands; the theme itself is a lazy chunk Shiki fetches and resolves
  // afterwards. Waiting on the attribute and then reading the colours passes
  // whenever the machine is quick and fails whenever it is busy — which is
  // exactly how this behaved, green alone and red in a full run.
  await expect
    .poll(async () => (await tokenColours()).colours.join('|'), { timeout: 15_000 })
    .not.toBe(before.colours.join('|'));

  const after = await tokenColours();
  // Reaches a review that is already open, like every other preference here.
  expect(after.chosen).toBe('github-light-high-contrast');
  // And the additions and deletions are the theme's now, not Primer's. This is
  // the half that matters for the colour-vision themes: leaving the override on
  // would put a red and a green back on the only rows that carry meaning.
  expect(after.addition.trim()).toBe('');
});

test('a chosen theme reaches the page around the diff, and can be taken back off', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The companion to the test above, and it needs a real browser for a
  // different reason: the palette is applied as inline custom properties over
  // a `light-dark()` default, and only a browser resolves `light-dark()`.
  // jsdom reports the declaration, not the colour.
  const page = await context.newPage();
  await openReview(page, extensionId);

  const chrome = () =>
    page.evaluate(() => {
      const root = document.documentElement;
      const computed = getComputedStyle(root);
      return {
        canvas: computed.getPropertyValue('--canvas-default').trim(),
        scheme: computed.colorScheme,
        // The value that actually reaches a pixel, rather than the token it
        // came from. A token can be set and still be overridden downstream.
        body: getComputedStyle(document.body).backgroundColor,
      };
    });

  await expect.poll(async () => (await chrome()).body).toBe('rgb(255, 255, 255)');
  const before = await chrome();
  // Primer's pair, unresolved by any choice: the page follows the OS.
  expect(before.scheme).toBe('light dark');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#diffTheme').selectOption('dracula');

  // Dracula's own editor background, and the whole point of the feature: the
  // reviewer chose a dark theme on a light machine and got a dark page.
  await expect.poll(async () => (await chrome()).body).toBe('rgb(40, 42, 54)');
  const themed = await chrome();
  expect(themed.canvas).toBe('#282a36');
  expect(themed.scheme).toBe('dark');

  // The options page is the other half of 'everywhere', and it is the screen
  // the reviewer is standing on while they choose.
  await expect
    .poll(async () => options.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(40, 42, 54)');

  // Back to the default, which has to be a real removal rather than a second
  // palette that happens to hold Primer's values — otherwise a later change to
  // `ui/tokens.css` would never reach anyone who had ever chosen a theme.
  await options.locator('#diffTheme').selectOption('');
  await expect.poll(async () => (await chrome()).body).toBe('rgb(255, 255, 255)');
  const reset = await chrome();
  expect(reset.scheme).toBe('light dark');
  await options.close();
});

/**
 * The error page, against the real worker.
 *
 * The only honest check that the diagnosis survives the trip: the refusal is
 * raised inside the production service worker, classified there, probed there,
 * and crosses `runtime.sendMessage` — which is JSON, and would quietly flatten
 * anything in the diagnosis that was not.
 *
 * The failure it guards is the one this whole path was built for. A token with
 * no access to a repository used to arrive here as "Something went wrong" over
 * `GitHub request failed: 404`, with the button that fixes it hidden.
 */
test('names a repository the token cannot see, and offers the way to fix it', async ({
  page,
  context,
  extensionId,
  api,
}) => {
  api.refuseRepository = true;

  await page.goto(reviewUrl(extensionId));

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(
    /can’t see acme\/widgets/i,
  );

  // Proof the token itself is accepted, which is what stops someone
  // regenerating a perfectly good one. It can only come from the probe, so its
  // presence is the probe having actually run in the worker.
  await expect(main).toContainText('@fixture-user');
  expect(api.operations).toContain('Diagnose');

  // The evidence, transcribed rather than summarised.
  await expect(main.getByRole('heading', { name: /what we saw/i })).toBeVisible();
  await expect(main).toContainText('Could not resolve to a Repository');

  // Offered on every failure now, and not behind a regular expression over the
  // error text.
  const update = main.getByRole('button', { name: /update token/i });
  await expect(update).toBeVisible();

  const opened = context.waitForEvent('page');
  await update.click();
  const options = await opened;
  await expect(options).toHaveURL(new RegExp(`chrome-extension://${extensionId}/options.html`));
});
