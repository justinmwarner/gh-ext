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

import { FILES, THREADS } from './fixture';
import { expect, reviewUrl, test } from './extension';
import type { Page } from '@playwright/test';

/** The scrollport `CodeView` was handed. */
const VIEW = '.diff-view';

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

test('opens the review from the button the content script injects', async ({
  context,
  extensionId,
  api,
}) => {
  void api;
  // The whole entry path, in order: the content script finds the header on a
  // pull request page, injects its button, and the worker navigates the tab —
  // which it has to do itself, because a page on github.com cannot reach an
  // extension resource that is not web-accessible, and making review.html
  // web-accessible would let github.com fingerprint the extension.
  const page = await context.newPage();
  await page.goto('https://github.com/acme/widgets/pull/42');

  const button = page.locator('#fast-review-open-button');
  await expect(button).toBeVisible();
  await button.click();

  await page.waitForURL(new RegExp(`^chrome-extension://${extensionId}/review\.html#`));
  expect(page.url()).toBe(reviewUrl(extensionId));
  await expect(page.locator('.shell')).toBeVisible();
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
  // in their own file's card instead, which is the whole safety net. Each file
  // is selected in the tree before it is looked for — the column virtualizes,
  // so what is mounted depends on how much of it fits, and this used to depend
  // on the exact height of everything above it.
  await expect(
    page.getByLabel('Diff').getByText('This allocates on every call.'),
  ).toBeVisible();
  for (const [path, reason] of [
    ['src/beta.ts', 'out-of-hunk'],
    ['src/gamma.ts', 'outdated'],
  ] as const) {
    await page.locator(`[data-item-path="${path}"]`).click();
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
    await expect(page.locator(`[data-item-path="${path}"]`)).toHaveCount(1);
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

  const row = (path: string) => page.locator(`[data-item-path="${path}"]`);

  // Every file in the fixture carries exactly one open thread except src/app.ts,
  // which carries an open one and a resolved one — so all four read as open.
  await expect(row('src/beta.ts')).toContainText('●');
  await expect(row('src/app.ts')).toContainText('●');
  // And a file nobody has commented on says nothing at all.
  await expect(row('src/epsilon.ts')).not.toContainText('●');
  await expect(row('src/epsilon.ts')).not.toContainText('○');

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

  await expect(row('src/beta.ts')).toContainText('○');
  await expect(row('src/beta.ts')).not.toContainText('●');
  expect(api.operations).toContain('ResolveThread');

  // Every run in the decoration has to measure. The library renders each part
  // as its own `<span>` inside a flex container, so a part holding an ordinary
  // space is a flex item whose whole content is collapsible whitespace: it lays
  // out at zero width, and the counts meet as `+1−1`. Only a layout engine can
  // see that, which is why it survived from the day the counts shipped.
  const widths = await page.evaluate(() => {
    const outer = document
      .querySelector('file-tree-container')
      ?.shadowRoot?.querySelector(
        '[data-item-path="src/app.ts"] [data-item-section="decoration"] span',
      );
    return [...(outer?.children ?? [])].map(
      (part) => part.getBoundingClientRect().width,
    );
  });
  expect(widths).toHaveLength(5);
  expect(widths.filter((width) => width > 0)).toHaveLength(5);
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

  const order = new Map<string, number>(FILES.map((path, index) => [path, index]));
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
  // rather than inferred. The nudge re-fires the handler against the layout as
  // it finally settled — `CodeView` remeasures item heights as real content
  // replaces its estimates, and the reported file is otherwise one render
  // behind that.
  await page.evaluate((selector) => {
    const view = document.querySelector(selector);
    if (view !== null) view.scrollTop += 1;
  }, VIEW);
  await page.waitForTimeout(300);

  const tops = await cardTops(page);
  const reached = tops
    .filter((card) => card.top <= 1)
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
  const row = page.locator('[data-item-path="lib/util/debounce.ts"]');
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
  const mutations = api.operations.filter(
    (name) => name !== 'PullRequestReview' && name !== 'ViewerPendingReview',
  );
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

  const reply = page.locator('[data-reply-for]').first();
  await reply.scrollIntoViewIfNeeded();
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
  const expander = card.locator('[data-expand-button]').first();
  await expander.scrollIntoViewIfNeeded();
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

  // And the two Pierre surfaces resolve to the same background as the page.
  // They render into shadow roots, so this cannot be checked anywhere but a
  // real browser — and left alone the seams show three colours meeting: the
  // page at #0d1117, the tree at #141415 and the diff at pure black.
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
      // The two libraries paint at different depths: the diff on the first
      // element inside its shadow root, the tree on the host itself.
      diff: bg(diffHost?.shadowRoot?.firstElementChild ?? null),
      tree: bg(document.querySelector('file-tree-container')),
    };
  });

  expect(seams.diff).toBe(seams.page);
  expect(seams.tree).toBe(seams.page);

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

  // Expand, so the comment moves out of the list and into the diff.
  const expander = card.locator('[data-expand-button]').first();
  await expander.scrollIntoViewIfNeeded();
  await expander.click();
  await expect(page.getByLabel('Diff').getByText('Out of hunk comment.')).toBeVisible();
  await expect(listed).toHaveCount(0);

  // Narrow to what landed since the last review. That patch's only hunk covers
  // lines 1-3, so line 10 is out of hunk again and the comment belongs back in
  // the list.
  await page.getByRole('button', { name: 'Since my last review' }).click();
  await expect(page.getByRole('button', { name: 'Since my last review' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  await page.getByRole('button', { name: 'Since my last review' }).click();
  await expect(page.getByRole('button', { name: 'Since my last review' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Drawn this time rather than listed, and that is right: the blobs are warm
  // from the expansion above, so the column's standing request for the line is
  // granted immediately. Either surface is correct — being on neither is not.
  await expect(page.getByLabel('Diff').getByText('Out of hunk comment.')).toBeVisible();
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

  // Signing out, written where the options page writes it.
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async () => {
    const api = (globalThis as unknown as {
      chrome: { storage: { local: { remove(keys: string): Promise<void> } } };
    }).chrome;
    await api.storage.local.remove('github-token');
  });

  await page.reload();

  // The setup screen, not the diff — and the worker did not answer it from
  // cache, which is the part that would have been silent.
  await expect(page.getByRole('button', { name: 'Open options' })).toBeVisible();
  await expect(page.locator('[data-file-card]')).toHaveCount(0);
  expect(api.urls.length).toBe(before);
});

test('the corner-button fallback comes back after leaving a pull request', async ({
  context,
  extensionId,
  api,
}) => {
  void extensionId;
  void api;
  // The day GitHub changes its header markup, the fallback is the whole
  // feature. It used to mount once per tab: navigating away removed the
  // button, and coming back found no anchor and a latch that refused to run
  // again — so the extension had no entry point at all until a hard reload,
  // which is not a thing anyone thinks to try.
  await context.route('https://github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      // No `.gh-header-actions`, and nothing else the injector looks for.
      body: '<!doctype html><html><head><title>acme/widgets</title></head><body></body></html>',
    }),
  );

  const page = await context.newPage();
  await page.goto('https://github.com/acme/widgets/pull/42');

  const button = page.locator('#fast-review-open-button');
  await expect(button).toBeVisible({ timeout: 10_000 });

  // Soft-navigate off the pull request, the way GitHub's own router does. The
  // DOM change is what wakes the observer that drives the resync.
  await page.evaluate(() => {
    history.pushState({}, '', '/acme/widgets/issues');
    document.body.append(document.createElement('span'));
  });
  await expect(button).toHaveCount(0);

  // And back.
  await page.evaluate(() => {
    history.pushState({}, '', '/acme/widgets/pull/42');
    document.body.append(document.createElement('span'));
  });
  await expect(button).toBeVisible({ timeout: 10_000 });
});
