/**
 * The dashboard, in a real Chromium, against the production build.
 *
 * The only honest check for the things the jsdom suite cannot see: that the
 * `action` key is really in the built manifest, that the worker answers the
 * four-search document, and that the route renders out of a bundle rather than
 * out of a module graph Vitest assembled.
 *
 * Every test takes `api`, even the ones that never read the log. That fixture
 * is what routes github.com away from the network *and* seeds the token — a
 * test without it renders the setup screen and times out looking for a heading
 * that was never going to be there.
 */

import { expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { DASHBOARD_RESPONSE } from './fixture';
import { dashboardUrl, reviewUrl, test } from './extension';

/**
 * Opt repositories in, the way the picker would have.
 *
 * Written straight into the extension's own storage rather than clicked,
 * because what these tests are about is what the dashboard does once something
 * is ticked. The ticking itself is covered by the picker's own tests and by
 * `first run` below.
 */
async function watch(context: BrowserContext, ...repos: string[]): Promise<void> {
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async (names: string[]) => {
    const api = (globalThis as unknown as {
      chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    }).chrome;
    await api.storage.local.set({ settings: { watchedRepos: names } });
  }, repos);
}

/**
 * Choose a theme, the way the options page would have.
 *
 * Merged rather than written flat, unlike `watch` above: every test that wants
 * a theme also wants repositories opted in, and a second flat write would take
 * the first one's back out.
 */
async function choose(context: BrowserContext, themeId: string): Promise<void> {
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error('the extension worker never started');
  await worker.evaluate(async (diffTheme: string) => {
    const api = (globalThis as unknown as {
      chrome: {
        storage: {
          local: {
            get(key: string): Promise<Record<string, unknown>>;
            set(items: Record<string, unknown>): Promise<void>;
          };
        };
      };
    }).chrome;
    const stored = await api.storage.local.get('settings');
    const settings = (stored.settings ?? {}) as Record<string, unknown>;
    await api.storage.local.set({ settings: { ...settings, diffTheme } });
  }, themeId);
}

test.describe('the dashboard', () => {
  test('lists every bucket the fixture can reach', async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    for (const heading of [
      'Waiting on you',
      'Blocked on you',
      'Ready to merge',
      'Waiting on others',
      'Quiet',
      'Drafts',
    ]) {
      await expect(
        page.getByRole('heading', { name: new RegExp(heading, 'i') }),
      ).toBeVisible();
    }
  });

  test('puts an unanswered review request at the top', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(
      /waiting on you/i,
    );
  });

  test('says the push that happened after a review', async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByText('Pushed since your review')).toBeVisible();
  });

  test('counts only the conversations somebody else spoke in last', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    // The fixture gives PR 495 three threads: two unresolved and last answered
    // by dana, one resolved by the viewer. Only the two count.
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByText('2 unresolved conversations')).toBeVisible();
  });

  test('admits the search stopped short of what it counted', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByText(/Showing 5 of 86/)).toBeVisible();
  });

  test('opens the review page from a row', async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));

    await page.getByRole('link', { name: 'Retry the upload when S3 answers 503' }).click();

    await expect(page).toHaveURL(/#\/pr\/acme\/widgets\/512$/);
  });

  test('asks the worker once, with the four searches', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    expect(api.operations.filter((op) => op === 'Dashboard')).toHaveLength(1);
    expect(Object.keys(api.variables[api.operations.indexOf('Dashboard')] ?? {})).toEqual([
      'requested',
      'mine',
      'involved',
      'reviewed',
    ]);
  });

  test('moves a row when the reviewer says so, and offers to put it back', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    const row = page.getByRole('listitem').filter({ hasText: 'Retry the upload' });
    await row.getByRole('combobox').selectOption('quiet');

    const quiet = page.getByRole('region', { name: /quiet/i });
    await expect(quiet.getByText('Retry the upload when S3 answers 503')).toBeVisible();
    await expect(
      quiet.getByRole('listitem').filter({ hasText: 'Retry the upload' }).getByRole('button'),
    ).toHaveText('Put back');
  });

  test('reaches the list from a review with g p', async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(reviewUrl(extensionId));
    // Wait for the review to be up before pressing anything, or the keydown
    // lands on a page that has no listener yet.
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toHaveCount(0);
    await page.waitForSelector('.topbar');

    await page.keyboard.press('g');
    await page.keyboard.press('p');

    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
  });
});

test.describe('the dashboard fixture', () => {
  test('reaches every derivation rule', () => {
    // A guard on the fixture rather than on the product: if somebody trims it,
    // the bucket assertions above start passing vacuously.
    const all = [
      ...DASHBOARD_RESPONSE.requested.nodes,
      ...DASHBOARD_RESPONSE.mine.nodes,
      ...DASHBOARD_RESPONSE.involved.nodes,
      ...DASHBOARD_RESPONSE.reviewed.nodes,
    ];

    expect(all).toHaveLength(9);
  });
});

test.describe('the rail', () => {
  test('carries a way to the list, and it is not a fourth view', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(reviewUrl(extensionId));
    await page.waitForSelector('.topbar');

    const link = page.getByRole('link', { name: 'Pull requests' });
    await expect(link).toBeVisible();

    // Outside the tablist, so the arrow keys that walk the views cannot land
    // on it and nothing about it reads as a view.
    await expect(
      page.getByRole('tablist').getByRole('link', { name: 'Pull requests' }),
    ).toHaveCount(0);
  });

  test('opens the list when pressed', async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(reviewUrl(extensionId));
    await page.waitForSelector('.topbar');

    await page.getByRole('link', { name: 'Pull requests' }).click();

    await expect(page).toHaveURL(/#\/prs$/);
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
  });

  test('does not underline on hover, as nothing else in the rail does', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets', 'acme/gears');
    await page.goto(reviewUrl(extensionId));
    await page.waitForSelector('.topbar');

    const link = page.getByRole('link', { name: 'Pull requests' });
    await link.hover();

    await expect(link).toHaveCSS('text-decoration-line', 'none');
  });
});

test.describe('first run', () => {
  test('reads no pull requests until a repository is opted in', async ({
    page,
    extensionId,
    api,
  }) => {
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: /pick the repositories/i })).toBeVisible();

    // The one request a fresh install makes names repositories. It does not
    // read a pull request out of any of them.
    expect(api.operations).toContain('ContributedRepos');
    expect(api.operations).not.toContain('Dashboard');
  });

  test('fetches once a repository is ticked', async ({ page, extensionId, api }) => {
    await page.goto(dashboardUrl(extensionId));
    // `click`, not `check`: ticking the first repository is what takes the
    // page off the picker and onto the list, so the box unmounts and `check`
    // would wait forever for a checked state nothing is left to report.
    await page.getByRole('checkbox', { name: /acme\/widgets/ }).click();

    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
    expect(api.operations).toContain('Dashboard');
  });

  test('remembers the choice across a reload', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));
    // `click`, not `check`: ticking the first repository is what takes the
    // page off the picker and onto the list, so the box unmounts and `check`
    // would wait forever for a checked state nothing is left to report.
    await page.getByRole('checkbox', { name: /acme\/widgets/ }).click();
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /pick the repositories/i })).toHaveCount(0);
  });
});

test.describe('scope and window', () => {
  test('asks only for the opted-in repositories, and only ninety days', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    const sent = api.variables[api.operations.indexOf('Dashboard')] ?? {};
    for (const query of Object.values(sent) as string[]) {
      expect(query).toContain('repo:acme/widgets');
      expect(query).not.toContain('repo:acme/gears');
      expect(query).toMatch(/updated:>=\d{4}-\d{2}-\d{2}/);
    }
  });

  test('says what it is reading, without a total it was never told', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    // Discovery is lazy, so on a load where nothing asked for it the panel
    // knows what is watched and not what exists. It says the first and stays
    // quiet about the second rather than printing "1 of 0".
    void api;
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));

    await expect(
      page.getByRole('button', { name: /reading 1 repository, last 90 days/i }),
    ).toBeVisible();
  });

  test('learns the total when the panel is opened', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));
    expect(api.operations).not.toContain('ContributedRepos');

    await page.getByRole('button', { name: /reading 1 repository/i }).click();

    // Asked for only once somebody actually looked, and the sentence gains its
    // denominator now that there is one.
    await expect(
      page.getByRole('button', { name: /reading 1 of 3 repositories/i }),
    ).toBeVisible();
    expect(api.operations).toContain('ContributedRepos');
  });
});

test.describe('the title search', () => {
  test('reaches a merged pull request the window excludes', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await page.getByRole('searchbox').fill('cache');
    await page.getByRole('searchbox').press('Enter');

    await expect(page.getByText('Cache the diff on head SHA, first attempt')).toBeVisible();
    await expect(page.getByText('Merged')).toBeVisible();
  });

  test('quotes what was typed, so a qualifier cannot escape the scope', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await page.getByRole('searchbox').fill('repo:acme/secrets');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('heading', { name: /matching/i })).toBeVisible();

    const sent = api.variables[api.operations.indexOf('TitleSearch')] ?? {};
    expect(String(sent.q)).toContain('"repo:acme/secrets"');
    expect(String(sent.q)).toContain('repo:acme/widgets');
  });

  test('gives a way back to the list', async ({ page, context, extensionId, api }) => {
    void api;
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await page.getByRole('searchbox').fill('cache');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('heading', { name: /matching/i })).toBeVisible();

    await page.getByRole('button', { name: /clear search/i }).click();

    await expect(page.getByRole('heading', { name: /waiting on you/i })).toBeVisible();
  });
});

test.describe('the picker, drawn inside a full page', () => {
  /**
   * The first run draws the picker inside `FullPage`, where
   * `.fullpage label { display: block; font-weight: 600; margin: 1rem 0 }`
   * outranks `.repos-label` on specificity. Left alone it takes the row's
   * layout, bolds every repository name and spaces the rows by its own margin
   * — a control that looks like a different control depending on which screen
   * reached it. Only a browser can catch this; jsdom applies no stylesheet.
   */
  test('keeps its own row layout', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));
    const label = page.locator('.repos-label').first();
    await expect(label).toBeVisible();

    await expect(label).toHaveCSS('display', 'flex');
  });

  test('does not let the unlock form bold the repository names', async ({
    page,
    extensionId,
    api,
  }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));
    const name = page.locator('.repos-name').first();
    await expect(name).toBeVisible();

    // 600 is the unlock form leaking in. These are list rows, not field labels.
    await expect(name).not.toHaveCSS('font-weight', '600');
  });

  test('gives the private tag a pill to sit in', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));
    const tag = page.getByText('Private');
    await expect(tag).toBeVisible();

    // An inline box with no vertical padding takes its height from the font's
    // ascent and descent, so the border ends up against the letters. The pill
    // has to be taller than the text it holds.
    const box = await tag.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThan(17);
  });
});

test.describe('the picker, on the options page', () => {
  /**
   * The picker is drawn on two documents now, and they load different
   * stylesheets. Its rules lived in the review page's sheet, so on
   * options.html it had none at all and fell back to that page's
   * `label { display: block; font-weight: 600 }` — a bulleted list of bold
   * names with the private tag run onto the end of one of them.
   *
   * Only a browser can see this. jsdom applies no stylesheet, so the unit
   * suite was green throughout.
   */
  const optionsUrl = (extensionId: string) =>
    `chrome-extension://${extensionId}/options.html`;

  test('keeps its own row layout there too', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(optionsUrl(extensionId));
    const label = page.locator('.repos-label').first();
    await expect(label).toBeVisible();

    await expect(label).toHaveCSS('display', 'flex');
  });

  test('does not let the settings form bold the repository names', async ({
    page,
    extensionId,
    api,
  }) => {
    void api;
    await page.goto(optionsUrl(extensionId));
    const name = page.locator('.repos-name').first();
    await expect(name).toBeVisible();

    await expect(name).not.toHaveCSS('font-weight', '600');
  });

  test('gives the private tag a pill there too', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(optionsUrl(extensionId));
    const tag = page.getByText('Private');
    await expect(tag).toBeVisible();

    const box = await tag.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(17);
  });
});

test.describe('the page rail', () => {
  test('reaches the dashboard from options', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Pull requests' }).click();

    // An absolute extension URL, not a bare fragment: options.html and
    // review.html are two documents.
    await expect(page).toHaveURL(/\/review\.html#\/prs$/);
  });

  test('marks the page you are on, on both of them', async ({
    page,
    extensionId,
    api,
  }) => {
    void api;
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(
      page.getByRole('navigation', { name: 'Pages' }).locator('[aria-current="page"]'),
    ).toHaveText('Options');

    await page.goto(dashboardUrl(extensionId));
    await expect(
      page.getByRole('navigation', { name: 'Pages' }).locator('[aria-current="page"]'),
    ).toHaveText('Pull requests');
  });

  test('stays put when the page scrolls', async ({ page, extensionId, api }) => {
    // The options page is a couple of thousand pixels of settings. A rail whose
    // items live at the top of that is one you cannot reach from the bottom,
    // which is exactly where somebody stands when they finish configuring.
    void api;
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    await expect(nav.getByRole('link', { name: 'Pull requests' })).toBeInViewport();
  });
});

/**
 * The chosen theme, on the two routes that are not a loaded pull request.
 *
 * Both claims here are only checkable in a real browser. The first is that the
 * dashboard wears the theme at all — it used to be applied by `Shell`, which
 * this route never mounts, so a reviewer leaving a dark options page for their
 * pull request list landed on a page following the operating system instead.
 *
 * The second is *when*. `storage.local` is asynchronous, so a theme applied
 * from a React effect arrives a frame after the paint, and that frame is the
 * flicker. `ui/pageTheme.ts` mirrors the id into `localStorage` and reads it
 * back synchronously at module load; what proves it is that the attribute is
 * already there at `DOMContentLoaded`, before React has rendered anything at
 * all, let alone run an effect.
 */
test.describe('the chosen theme', () => {
  const THEME = 'github-dark';

  test('dresses the dashboard, which Shell never mounts on', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets');
    await choose(context, THEME);
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('data-syntax-theme', THEME);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe(
      'dark',
    );
  });

  test('is already on before the document has finished parsing', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets');
    await choose(context, THEME);

    // The first visit is what fills the mirror; it cannot help itself.
    await page.goto(dashboardUrl(extensionId));
    await expect(page.locator('html')).toHaveAttribute('data-syntax-theme', THEME);

    // The second is the one under test. Recorded from inside the page rather
    // than polled from outside it, because by the time an assertion could run
    // the frame in question is long gone.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as { themeAtParse: string | null }).themeAtParse =
          document.documentElement.getAttribute('data-syntax-theme');
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    expect(
      await page.evaluate(
        () => (window as unknown as { themeAtParse: string | null }).themeAtParse,
      ),
    ).toBe(THEME);
  });

  test('leaves the page in Primer when no theme has been chosen', async ({
    page,
    context,
    extensionId,
    api,
  }) => {
    void api;
    await watch(context, 'acme/widgets');
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    // The default has to be the *absence* of the mechanism rather than
    // something equivalent to it, or `ui/tokens.css` is no longer the default.
    await expect(page.locator('html')).not.toHaveAttribute('data-syntax-theme', /.*/);
  });
});
