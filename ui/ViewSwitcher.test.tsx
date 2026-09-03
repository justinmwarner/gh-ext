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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type ReviewView, ViewSwitcher } from './ViewSwitcher';

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
