/**
 * The kebab menu.
 *
 * A menu exists to get controls off a row that has something better to do with
 * the width. That is only a trade worth making if what goes behind it stays
 * reachable — so most of what is here is about the ways out: escape, a click
 * somewhere else, and a keyboard that can walk the items without a pointer.
 */

import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton, type MenuGroup, type MenuItem } from './MenuButton';

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

  it('shuts when Tab takes the keyboard out of it', async () => {
    // Escape is read on the menu, so once focus has left, nothing but a click
    // could close it — and it would sit over whatever the reviewer went to.
    render(
      <>
        <MenuButton label="Commit options" items={[{ id: 'a', label: 'Choose commits…', onSelect: chose() }]} />
        <button type="button">Next thing</button>
      </>,
    );

    await open();
    await userEvent.tab();

    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('telling the caller', () => {
  it('says when it opens and when it shuts', async () => {
    const onOpenChange = vi.fn();
    render(
      <MenuButton
        label="Commit options"
        items={[{ id: 'a', label: 'Choose commits…', onSelect: chose() }]}
        onOpenChange={onOpenChange}
      />,
    );

    await open();
    await userEvent.keyboard('{Escape}');

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('says it has shut if it goes away while open', async () => {
    const onOpenChange = vi.fn();
    const view = render(
      <MenuButton
        label="Commit options"
        items={[{ id: 'a', label: 'Choose commits…', onSelect: chose() }]}
        onOpenChange={onOpenChange}
      />,
    );

    await open();
    view.unmount();

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});

/**
 * A menu of several toggles: the file filters.
 *
 * The commit menu is a handful of commands, each of which is the whole reason
 * for opening it. A filter menu is the opposite — a reviewer opens it to set
 * three things — so what it needs is sections a reader can find their way
 * around, a count on each row that decides whether to untick it, and boxes that
 * do not throw the menu away on every press.
 */
describe('a menu of sections', () => {
  const filters = () => screen.getByRole('button', { name: 'File filters' });

  function mountGroups(groups: readonly MenuGroup[], icon?: ReactElement) {
    return render(<MenuButton label="File filters" groups={groups} icon={icon} />);
  }

  const GROUPS: readonly MenuGroup[] = [
    {
      id: 'kind',
      label: 'Change type',
      items: [
        { id: 'added', label: 'Added', detail: '4', checked: true, keepOpen: true, onSelect: chose() },
        { id: 'deleted', label: 'Deleted', detail: '12', checked: true, keepOpen: true, onSelect: chose() },
      ],
    },
    {
      id: 'type',
      label: 'File type',
      items: [{ id: '.ts', label: '.ts', detail: '30', checked: true, keepOpen: true, onSelect: chose() }],
    },
  ];

  it('names each section by its heading', async () => {
    mountGroups(GROUPS);
    await userEvent.click(filters());

    const kinds = screen.getByRole('group', { name: 'Change type' });
    expect(within(kinds).getAllByRole('menuitemcheckbox')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'File type' })).toBeDefined();
  });

  it('walks from one section into the next with the arrow keys', async () => {
    mountGroups(GROUPS);
    await userEvent.click(filters());

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    expect(document.activeElement?.textContent).toContain('.ts');
  });

  it('keeps the menu open, and the keyboard where it was, for a box that asks to', async () => {
    const onSelect = vi.fn();
    mountGroups([
      {
        id: 'kind',
        items: [
          { id: 'added', label: 'Added', checked: true, keepOpen: true, onSelect: chose() },
          { id: 'deleted', label: 'Deleted', checked: true, keepOpen: true, onSelect },
        ],
      },
    ]);
    await userEvent.click(filters());
    await userEvent.keyboard('{ArrowDown}');

    await userEvent.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Deleted');
  });

  it('says how many files a row stands for beside its name', async () => {
    mountGroups(GROUPS);
    await userEvent.click(filters());

    const deleted = screen.getByRole('menuitemcheckbox', { name: /Deleted/ });
    expect(deleted.textContent).toContain('12');
  });

  it('puts a row’s note under it, and describes the row by it', async () => {
    // Why a row is off, or what it could not check, in words on the row
    // itself — a title is a tooltip, and a tooltip is not on screen until the
    // pointer finds it.
    mountGroups([
      {
        id: 'owners',
        items: [
          {
            id: 'owned',
            label: 'Show only files you own',
            checked: false,
            disabled: true,
            note: 'This repository has no CODEOWNERS file.',
            onSelect: chose(),
          },
        ],
      },
    ]);
    await userEvent.click(filters());

    const owned = screen.getByRole('menuitemcheckbox', { name: /Show only files you own/ });
    const describedBy = owned.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      'This repository has no CODEOWNERS file.',
    );
  });

  it('draws the icon it is given where the kebab would be', async () => {
    mountGroups(GROUPS, <svg data-testid="funnel" />);

    expect(within(filters()).getByTestId('funnel')).toBeDefined();
  });

  it('can name a row in words of its own, for a label that means something else elsewhere', async () => {
    // The same `.png` is a type to show in one section and a type to read last
    // in another. Read out as ".png" twice, the two would be indistinguishable.
    mountGroups([
      {
        id: 'last',
        label: 'Read last',
        items: [
          { id: 'last:.png', label: '.png', ariaLabel: 'Read .png last', checked: false, keepOpen: true, onSelect: chose() },
        ],
      },
    ]);
    await userEvent.click(filters());

    expect(screen.getByRole('menuitemcheckbox', { name: 'Read .png last' }).textContent).toContain('.png');
  });

  it('lists a section’s runs under headings of their own, and walks into them', async () => {
    mountGroups([
      {
        id: 'type',
        label: 'File type',
        items: [],
        subgroups: [
          { id: 'code', label: 'Code', items: [{ id: '.ts', label: '.ts', checked: true, keepOpen: true, onSelect: chose() }] },
          { id: 'images', label: 'Images', items: [{ id: '.png', label: '.png', checked: true, keepOpen: true, onSelect: chose() }] },
        ],
      },
    ]);
    await userEvent.click(filters());

    const types = screen.getByRole('group', { name: 'File type' });
    expect(within(types).getByRole('group', { name: 'Images' }).textContent).toContain('.png');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('.png');
  });

  it('puts a hint under a heading, and describes the section by it', async () => {
    mountGroups([
      {
        id: 'type',
        label: 'File type',
        hint: 'Ctrl-click to show only the ones you pick',
        items: [{ id: '.ts', label: '.ts', checked: true, keepOpen: true, onSelect: chose() }],
      },
    ]);
    await userEvent.click(filters());

    const types = screen.getByRole('group', { name: 'File type' });
    const describedBy = types.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Ctrl-click to show only the ones you pick',
    );
  });

  it('says whether the platform modifier was held when an item was pressed', async () => {
    const onSelect = vi.fn();
    mountGroups([
      { id: 'type', items: [{ id: '.ts', label: '.ts', checked: true, keepOpen: true, onSelect }] },
    ]);
    const user = userEvent.setup();
    await user.click(filters());

    await user.click(screen.getByRole('menuitemcheckbox', { name: /\.ts/ }));
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('menuitemcheckbox', { name: /\.ts/ }));
    await user.keyboard('{/Control}');

    expect(onSelect.mock.calls.map(([how]) => how)).toEqual([{ mod: false }, { mod: true }]);
  });

  it('scrolls itself, rather than zooming the page, under the wheel while Ctrl is held', async () => {
    // Holding Ctrl to pick several types is exactly when a long list has to
    // scroll, and Ctrl and the wheel together zoom the whole page.
    mountGroups(GROUPS);
    await userEvent.click(filters());
    const menu = screen.getByRole('menu');
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 300 });

    const wheel = new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true });
    menu.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(menu.scrollTop).toBe(120);
  });

  it('says a box that stands for several is partly ticked', async () => {
    mountGroups([
      { id: 'type', items: [{ id: 'code', label: 'Code', checked: 'mixed', keepOpen: true, onSelect: chose() }] },
    ]);
    await userEvent.click(filters());

    expect(screen.getByRole('menuitemcheckbox', { name: /Code/ }).getAttribute('aria-checked')).toBe('mixed');
  });

  it('makes a run’s heading a row of its own when it acts on the whole run', async () => {
    const onHeader = vi.fn();
    mountGroups([
      {
        id: 'type',
        label: 'File type',
        items: [],
        subgroups: [
          {
            id: 'code',
            label: 'Code',
            header: { id: 'cat:code', label: 'Code', checked: true, keepOpen: true, onSelect: onHeader },
            items: [{ id: '.ts', label: '.ts', checked: true, keepOpen: true, onSelect: chose() }],
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    await user.click(filters());

    // Named as before, and first in the walk: the arrows reach it like any row.
    const code = screen.getByRole('group', { name: 'Code' });
    const header = within(code).getAllByRole('menuitemcheckbox')[0];
    expect(header?.getAttribute('data-header')).toBe('true');
    expect(document.activeElement).toBe(header);
    await user.keyboard('{Enter}');
    expect(onHeader).toHaveBeenCalledTimes(1);
  });

  it('marks a row that sits under the one above it', async () => {
    mountGroups([
      {
        id: 'type',
        label: 'File type',
        items: [
          { id: '.tsx', label: '.tsx', checked: true, keepOpen: true, onSelect: chose() },
          { id: '.spec.tsx', label: '.spec.tsx', indent: true, checked: true, keepOpen: true, onSelect: chose() },
        ],
      },
    ]);
    await userEvent.click(filters());

    expect(screen.getByRole('menuitemcheckbox', { name: /^\.spec\.tsx/ }).getAttribute('data-indent')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: /^\.tsx/ }).getAttribute('data-indent')).toBeNull();
  });
});
