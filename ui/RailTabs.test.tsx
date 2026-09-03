/**
 * The rail's tab strip.
 *
 * A real `tablist`, not a row of buttons that look like one. The difference is
 * entirely in what a screen reader and the keyboard get: arrow keys move
 * between tabs, only the active one is in the tab order, and each tab names
 * the panel it controls.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RAIL_TABS, RailTabs } from './RailTabs';

function mount(active: (typeof RAIL_TABS)[number]['id'] = 'overview') {
  const onSelect = vi.fn();
  const view = render(<RailTabs active={active} onSelect={onSelect} />);
  return { ...view, onSelect };
}

describe('RailTabs', () => {
  it('offers one tab per page', () => {
    mount();

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Conversations',
    ]);
  });

  it('marks the active tab as selected and no other', () => {
    mount('conversations');

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(selected.map((tab) => tab.textContent)).toEqual(['Conversations']);
  });

  it('names the panel each tab controls', () => {
    // Without this the panel is associated with the tab by nothing but DOM
    // order, which is not something a screen reader can announce.
    mount();

    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-controls')).toBe(
      'rail-panel-overview',
    );
  });

  it('asks for the page the reviewer clicked', async () => {
    const { onSelect } = mount();

    await userEvent.click(screen.getByRole('tab', { name: 'Conversations' }));

    expect(onSelect).toHaveBeenCalledWith('conversations');
  });

  it('keeps only the active tab in the tab order', () => {
    // A roving tabindex. Otherwise Tab walks every tab before reaching the
    // panel, which is the thing the reviewer actually wanted to get to.
    mount('overview');

    expect(
      screen.getAllByRole('tab').map((tab) => tab.getAttribute('tabindex')),
    ).toEqual(['0', '-1']);
  });

  it('moves between tabs with the arrow keys', async () => {
    const { onSelect } = mount('overview');

    screen.getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(onSelect).toHaveBeenCalledWith('conversations');
  });

  it('wraps around rather than stopping at the ends', async () => {
    const { onSelect } = mount('overview');

    screen.getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowLeft}');

    expect(onSelect).toHaveBeenCalledWith('conversations');
  });

  it('jumps to either end on Home and End', async () => {
    const { onSelect } = mount('conversations');

    screen.getByRole('tab', { name: 'Conversations' }).focus();
    await userEvent.keyboard('{Home}');

    expect(onSelect).toHaveBeenCalledWith('overview');
  });
});
