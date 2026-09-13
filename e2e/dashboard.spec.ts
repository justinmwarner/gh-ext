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
import { DASHBOARD_RESPONSE } from './fixture';
import { dashboardUrl, test } from './extension';

test.describe('the dashboard', () => {
  test('lists every bucket the fixture can reach', async ({ page, extensionId, api }) => {
    void api;
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
    extensionId,
    api,
  }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();

    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(
      /waiting on you/i,
    );
  });

  test('says the push that happened after a review', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByText('Pushed since your review')).toBeVisible();
  });

  test('counts only the conversations somebody else spoke in last', async ({
    page,
    extensionId,
    api,
  }) => {
    // The fixture gives PR 495 three threads: two unresolved and last answered
    // by dana, one resolved by the viewer. Only the two count.
    void api;
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByText('2 unresolved conversations')).toBeVisible();
  });

  test('admits the search stopped short of what it counted', async ({
    page,
    extensionId,
    api,
  }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));

    await expect(page.getByText(/Showing 5 of 86/)).toBeVisible();
  });

  test('opens the review page from a row', async ({ page, extensionId, api }) => {
    void api;
    await page.goto(dashboardUrl(extensionId));

    await page.getByRole('link', { name: 'Retry the upload when S3 answers 503' }).click();

    await expect(page).toHaveURL(/#\/pr\/acme\/widgets\/512$/);
  });

  test('asks the worker once, with the four searches', async ({
    page,
    extensionId,
    api,
  }) => {
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
    extensionId,
    api,
  }) => {
    void api;
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

  test('reaches the list from a review with g p', async ({ page, extensionId, api }) => {
    void api;
    const { reviewUrl } = await import('./extension');
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
