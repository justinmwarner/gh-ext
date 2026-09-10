/**
 * The vertical view switcher.
 *
 * A real `tablist`, not a column of buttons that looks like one. Arrow keys
 * move between views, only the active one is in the tab order, and each tab
 * names the view it controls — none of which comes for free.
 *
 * The unresolved badge is not decoration. Putting the threads behind a view
 * means a reviewer can be looking at the diff with outstanding comments they
 * cannot see; the count is what keeps that from being silent.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReviewView, ViewSwitcher } from './ViewSwitcher';
import { openOptions } from './openOptions';

vi.mock('./openOptions', () => ({ openOptions: vi.fn() }));

const openOptionsMock = openOptions as unknown as Mock;

beforeEach(() => {
  openOptionsMock.mockReset();
});

function mount(active: ReviewView = 'files', unresolved = 0) {
  const onSelect = vi.fn();
  const view = render(
    <ViewSwitcher active={active} unresolved={unresolved} onSelect={onSelect} />,
  );
  return { ...view, onSelect };
}

const tabNames = () =>
  screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'));

describe('ViewSwitcher', () => {
  it('offers one tab per view, in reading order', () => {
    mount();

    expect(tabNames()).toEqual(['Files', 'Conversations', 'Overview']);
  });

  it('says it is vertical, because the arrow keys follow that', () => {
    mount();

    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe(
      'vertical',
    );
  });

  it('marks the active view as selected and no other', () => {
    mount('conversations');

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(selected.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Conversations',
    ]);
  });

  it('names the view each tab controls', () => {
    mount();

    expect(
      screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-controls'),
    ).toBe('review-view-files');
  });

  it('keeps only the active tab in the tab order', () => {
    mount('files');

    expect(
      screen.getAllByRole('tab').map((tab) => tab.getAttribute('tabindex')),
    ).toEqual(['0', '-1', '-1']);
  });

  it('asks for the view the reviewer clicked', async () => {
    const { onSelect } = mount();

    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

    expect(onSelect).toHaveBeenCalledWith('overview');
  });

  it('moves down the column with ArrowDown', async () => {
    const { onSelect } = mount('files');

    screen.getByRole('tab', { name: 'Files' }).focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(onSelect).toHaveBeenCalledWith('conversations');
  });

  it('wraps from the last view back to the first', async () => {
    const { onSelect } = mount('overview');

    screen.getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(onSelect).toHaveBeenCalledWith('files');
  });

  it('jumps to either end on Home and End', async () => {
    const { onSelect } = mount('conversations');

    screen.getByRole('tab', { name: 'Conversations' }).focus();
    await userEvent.keyboard('{End}');

    expect(onSelect).toHaveBeenCalledWith('overview');
  });

  it('counts the unresolved threads on the Conversations tab', () => {
    mount('files', 3);

    const tab = screen.getByRole('tab', { name: /conversations/i });
    expect(tab.textContent).toContain('3');
    // And says what the number means, since a bare digit beside an icon does
    // not read as anything on its own.
    expect(tab.getAttribute('aria-label')).toBe('Conversations, 3 unresolved');
  });

  it('says nothing at all when there is nothing outstanding', () => {
    mount('files', 0);

    const tab = screen.getByRole('tab', { name: 'Conversations' });
    expect(tab.querySelector('.view-badge')).toBeNull();
  });

  it('stops counting past ninety-nine rather than widening the rail', () => {
    mount('files', 120);

    expect(screen.getByRole('tab', { name: /conversations/i }).textContent).toContain(
      '99+',
    );
  });
});

/**
 * The way out of the rail.
 *
 * Two settings now decide what a diff looks like, so the options page stopped
 * being a once-per-install errand — and until this it was reachable only
 * through the browser's own extension menu, which is two menus deep and not
 * somewhere anyone thinks to look.
 *
 * Most of what is pinned here is what it must *not* be. A fourth tab would be
 * one that never becomes selected, controls no panel, and that the arrow keys
 * would walk into as though it were a view.
 */
describe('the options button', () => {
  const optionsButton = () => screen.getByRole('button', { name: 'Options' });

  it('is in the rail', () => {
    mount();

    expect(optionsButton()).toBeDefined();
  });

  it('opens the options page rather than changing the view', async () => {
    const { onSelect } = mount();

    await userEvent.click(optionsButton());

    expect(openOptionsMock).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is not a tab', () => {
    // Structural, not cosmetic: it is outside the `tablist`, so nothing about
    // it can be mistaken for a fourth view.
    mount();

    expect(tabNames()).toEqual(['Files', 'Conversations', 'Overview']);
    expect(
      within(screen.getByRole('tablist')).queryByRole('button', { name: 'Options' }),
    ).toBeNull();
    expect(optionsButton().getAttribute('aria-selected')).toBeNull();
    expect(optionsButton().getAttribute('aria-controls')).toBeNull();
  });

  it('is not somewhere the arrow keys can land', async () => {
    // The tabs wrap, so pressing Down on the last one goes back to the first.
    // If this were inside the list it would be in that cycle, and the reviewer
    // would arrow past a control that does not show them anything.
    const { onSelect } = mount('overview');

    screen.getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(onSelect).toHaveBeenCalledWith('files');
  });

  it('is reachable by keyboard, which the inactive tabs are not', async () => {
    // Only the active tab is in the tab order — that is what makes Tab reach
    // the view rather than walking the rail. This is a button and keeps its
    // own stop, or it would be reachable by pointer alone.
    mount();

    expect(optionsButton().getAttribute('tabindex')).toBeNull();

    optionsButton().focus();
    await userEvent.keyboard('{Enter}');

    expect(openOptionsMock).toHaveBeenCalledOnce();
  });
});
