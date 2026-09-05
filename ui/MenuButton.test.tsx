/**
 * The kebab menu.
 *
 * A menu exists to get controls off a row that has something better to do with
 * the width. That is only a trade worth making if what goes behind it stays
 * reachable — so most of what is here is about the ways out: escape, a click
 * somewhere else, and a keyboard that can walk the items without a pointer.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton, type MenuItem } from './MenuButton';

const trigger = () => screen.getByRole('button', { name: 'Commit options' });
const open = () => userEvent.click(trigger());

function mount(items: readonly MenuItem[]) {
  return render(<MenuButton label="Commit options" items={items} />);
}

const chose = vi.fn;

describe('the trigger', () => {
  it('says it opens a menu, and that the menu is shut', () => {
    mount([{ id: 'a', label: 'Choose commits…', onSelect: chose() }]);

    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the menu when clicked', async () => {
    mount([{ id: 'a', label: 'Choose commits…', onSelect: chose() }]);

    await open();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Choose commits…' })).toBeDefined();
  });

  it('draws nothing at all when there is nothing behind it', () => {
    // A kebab that opens onto an empty menu is a control that appears broken.
    const { container } = mount([]);

    expect(container.firstChild).toBeNull();
  });
});

describe('the items', () => {
  it('runs the one that is chosen, and shuts the menu behind it', async () => {
    const onSelect = vi.fn();
    mount([{ id: 'a', label: 'Choose commits…', onSelect }]);

    await open();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Choose commits…' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('makes a toggle a checkbox rather than a command', async () => {
    // "Since my last review" is a state the reviewer is in, not an action they
    // take once, and a plain menuitem cannot say which way it is set.
    mount([{ id: 'a', label: 'Since my last review', onSelect: chose(), checked: true }]);

    await open();

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Since my last review' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('refuses a disabled item and keeps the menu open', async () => {
    // The reason it is disabled is on its title, which is only readable while
    // the menu it lives in is still on screen.
    const onSelect = vi.fn();
    mount([
      { id: 'a', label: 'Choose commits…', onSelect, disabled: true, title: 'No commits' },
    ]);

    await open();
    const item = screen.getByRole('menuitem', { name: 'Choose commits…' });
    await userEvent.click(item);

    expect(onSelect).not.toHaveBeenCalled();
    expect(item.getAttribute('title')).toBe('No commits');
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('lets the keyboard reach a disabled item, since the reason is on it', async () => {
    // A `disabled` element is not focusable, so arrowing onto one silently
    // leaves focus where it was — and takes the menu's single tab stop with
    // it. The reason an item is off is the thing the reviewer came to read.
    mount([
      { id: 'a', label: 'Choose commits…', onSelect: chose() },
      { id: 'b', label: 'Since my last review', onSelect: chose(), disabled: true, title: 'Never reviewed' },
    ]);

    await open();
    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement?.textContent).toBe('Since my last review');
    expect(document.activeElement?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the ways out', () => {
  it('shuts on escape and hands focus back to the trigger', async () => {
    // Otherwise focus is left on an element that no longer exists, which sends
    // the keyboard back to the top of the document.
    mount([{ id: 'a', label: 'Choose commits…', onSelect: chose() }]);

    await open();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('shuts when something else on the page is clicked', async () => {
    mount([{ id: 'a', label: 'Choose commits…', onSelect: chose() }]);

    await open();
    await userEvent.click(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open when the click lands on the menu itself', async () => {
    // The watcher that closes on an outside click sees every press on the
    // page, including the ones inside the menu. Left alone it takes the menu
    // down on the press half of a click and the item never hears the release.
    mount([{ id: 'a', label: 'Choose commits…', onSelect: chose() }]);

    await open();
    await userEvent.click(screen.getByRole('menu'));

    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});

describe('the keyboard', () => {
  it('lands on the first item so the pointer is never required', async () => {
    mount([
      { id: 'a', label: 'Choose commits…', onSelect: chose() },
      { id: 'b', label: 'Since my last review', onSelect: chose() },
    ]);

    await open();

    expect(document.activeElement?.textContent).toBe('Choose commits…');
  });

  it('walks the items with the arrow keys', async () => {
    mount([
      { id: 'a', label: 'Choose commits…', onSelect: chose() },
      { id: 'b', label: 'Since my last review', onSelect: chose() },
    ]);

    await open();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Since my last review');

    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('Choose commits…');
  });

  it('jumps to the ends with Home and End', async () => {
    mount([
      { id: 'a', label: 'Choose commits…', onSelect: chose() },
      { id: 'b', label: 'Since my last review', onSelect: chose() },
    ]);

    await open();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Since my last review');

    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.textContent).toBe('Choose commits…');
  });

  it('keeps the menu out of the tab sequence', async () => {
    // Tab is how you leave a menu, not how you move inside one.
    mount([
      { id: 'a', label: 'Choose commits…', onSelect: chose() },
      { id: 'b', label: 'Since my last review', onSelect: chose() },
    ]);

    await open();

    expect(
      screen.getAllByRole('menuitem').map((item) => item.getAttribute('tabindex')),
    ).toEqual(['0', '-1']);
  });
});
