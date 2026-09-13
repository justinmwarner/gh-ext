/**
 * The rail the two standalone pages share.
 *
 * The review page has its own, built around its three views. These two have no
 * views — they are destinations — so what they need is the same strip with the
 * same two names in the same order, and a mark saying which one you are on.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavRail } from './NavRail';
import { openOptions } from './openOptions';
import { extensionUrl } from './extensionUrl';

vi.mock('./openOptions', () => ({ openOptions: vi.fn() }));
vi.mock('./extensionUrl', () => ({
  extensionUrl: vi.fn((path: string) => `chrome-extension://fixture${path}`),
}));

const openOptionsMock = openOptions as unknown as Mock;

beforeEach(() => {
  openOptionsMock.mockReset();
});

describe('NavRail', () => {
  it('names both destinations, in the order the review rail uses', () => {
    render(<NavRail current="options" />);

    const names = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent?.trim());

    expect(names).toEqual(['Pull requests', 'Options']);
  });

  it('marks the page you are on', () => {
    render(<NavRail current="options" />);

    expect(screen.getByText('Options').closest('[aria-current]')).toBeTruthy();
    expect(screen.getByText('Pull requests').closest('[aria-current]')).toBeNull();
  });

  it('is a navigation landmark, so it can be skipped to and skipped over', () => {
    render(<NavRail current="options" />);

    expect(screen.getByRole('navigation', { name: /pages/i })).toBeTruthy();
  });
});

describe('NavRail, from the options page', () => {
  it('links to the dashboard by its extension URL, not a bare hash', () => {
    // The dashboard lives on review.html. A `#/prs` href from options.html
    // would set the fragment of the options page and go nowhere.
    render(<NavRail current="options" />);

    const link = screen.getByRole('link', { name: 'Pull requests' });

    expect(link.getAttribute('href')).toBe('chrome-extension://fixture/review.html#/prs');
    expect(extensionUrl).toHaveBeenCalledWith('/review.html#/prs');
  });

  it('does not link the page it is already on', () => {
    render(<NavRail current="options" />);

    expect(screen.queryByRole('link', { name: 'Options' })).toBeNull();
  });
});

describe('NavRail, from the dashboard', () => {
  it('reaches the dashboard by hash, because that is the same page', () => {
    render(<NavRail current="dashboard" />);

    // Not linked at all — it is the current page. The mark is the whole story.
    expect(screen.queryByRole('link', { name: 'Pull requests' })).toBeNull();
    expect(screen.getByText('Pull requests').closest('[aria-current]')).toBeTruthy();
  });

  it('opens options through the extension rather than by URL', async () => {
    // `runtime.openOptionsPage` reuses an options tab that is already open.
    // A plain link would make a second one every time.
    render(<NavRail current="dashboard" />);

    await userEvent.click(screen.getByRole('button', { name: 'Options' }));

    expect(openOptionsMock).toHaveBeenCalledOnce();
  });
});
