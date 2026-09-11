/**
 * The help overlay, held to the map it is generated from.
 *
 * The point of generating it is that it cannot drift. This is the test that
 * makes that true rather than merely intended: add a binding to `SHORTCUTS`
 * without a description or a group and it fails here, before a reviewer meets
 * a shortcut nothing tells them about.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SHORTCUTS, resolveMod, shortcutLabel } from '@/lib/keymap';
import { ShortcutHelp } from './ShortcutHelp';

describe('ShortcutHelp', () => {
  it('shows every binding in the map, spelled the way it is typed', () => {
    render(<ShortcutHelp onClose={() => {}} />);

    const help = screen.getByRole('dialog', { name: /keyboard shortcuts/i });
    const mod = resolveMod('');

    // Paired with the action so a failure names the binding that is missing
    // rather than just a count.
    const listed = SHORTCUTS.map((shortcut) => [
      shortcut.action,
      within(help).queryAllByText(shortcutLabel(shortcut, mod)).length,
      help.textContent?.includes(shortcut.description) ?? false,
    ]);

    expect(listed).toEqual(
      SHORTCUTS.map((shortcut) => [shortcut.action, 1, true]),
    );
  });

  it('lists an action with two bindings once, showing both', () => {
    // `search-in-diff` is bound to `/` and to Mod+F. They are one thing the
    // reviewer can do, and two rows would read as two features.
    render(<ShortcutHelp onClose={() => {}} />);

    const rows = document.querySelectorAll('.shortcut-row');
    const search = [...rows].find((row) => row.textContent?.includes('Search the diff'));
    if (search === undefined) throw new Error('the diff search is not listed');

    expect(search.querySelectorAll('kbd')).toHaveLength(2);
    expect(search.textContent).toContain('/');
    expect(search.textContent).toContain('Ctrl+F');
  });

  it('groups the bindings, and names every group it uses', () => {
    render(<ShortcutHelp onClose={() => {}} />);

    for (const group of new Set(SHORTCUTS.map((shortcut) => shortcut.group))) {
      expect(screen.getByRole('heading', { name: group })).toBeDefined();
    }
  });

  it('closes from the backdrop, and not from a click inside it', async () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutHelp onClose={onClose} />);

    const panel = screen.getByRole('dialog');
    panel.click();
    expect(onClose).not.toHaveBeenCalled();

    (container.querySelector('.overlay-backdrop') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes the keyboard when it opens, and gives it back on Escape', async () => {
    const onClose = vi.fn();
    render(<ShortcutHelp onClose={onClose} />);

    // Focused on mount, which is what makes the key below land here rather
    // than on whatever the reviewer was reading behind it.
    const panel = screen.getByRole('dialog');
    expect(document.activeElement).toBe(panel);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns the keyboard to wherever it came from', () => {
    // The reviewer pressed `?` from somewhere in a long diff. Closing used to
    // drop focus on <body>, so the next Tab restarted at the top of the page.
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(<ShortcutHelp onClose={() => {}} />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps Tab inside itself, because it claims to be modal', async () => {
    render(<ShortcutHelp onClose={() => {}} />);
    const panel = screen.getByRole('dialog');

    // Close is the only focusable thing in here, so Tab in either direction has
    // nowhere else to go and must not leave. `aria-modal` tells a screen reader
    // the page behind does not exist; Tab walking out into it made that a lie.
    await userEvent.tab();
    expect(panel.contains(document.activeElement)).toBe(true);

    await userEvent.tab();
    expect(panel.contains(document.activeElement)).toBe(true);

    await userEvent.tab({ shift: true });
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});
