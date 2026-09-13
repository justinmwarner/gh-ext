/**
 * The theme picker.
 *
 * What is being checked is the thing a `<select>` gave away for free and this
 * control has to earn: that the list can be narrowed, that it can be walked and
 * chosen from without a mouse, and that the default — the only entry whose
 * contrast is a promise rather than a preference — is still one keystroke away
 * after the list has been narrowed to something else.
 *
 * The folds add a second obligation to that list, and it is the one worth
 * writing tests for. A group that is shut is a third of the themes that are not
 * in the document: the cursor must not walk into them, the reader must be told
 * they are there, and every one of them must still be reachable by a reviewer
 * who never touches a pointer.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCESSIBLE_THEMES,
  DARK_THEMES,
  type DiffTheme,
  LIGHT_THEMES,
} from '@/lib/compare/themes';
import { ThemePicker } from './ThemePicker';

const DEFAULT_LABEL = 'Match the page (default)';

function mount(value = '') {
  const onChange = vi.fn();
  const view = render(<ThemePicker value={value} onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: 'Filter themes' });
  return { ...view, onChange, input, user: userEvent.setup() };
}

const names = (): string[] =>
  screen.getAllByRole('option').map((option) => option.textContent ?? '');

const groupLabels = (): (string | null)[] =>
  screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'));

/** The drawn heading, which is the only part of a group a pointer can reach. */
const header = (name: string): HTMLElement => {
  const head = screen
    .getByText(name, { selector: '.theme-group-label' })
    .closest('.theme-group-name');
  if (!(head instanceof HTMLElement)) throw new Error(`no heading drawn for ${name}`);
  return head;
};

const labels = (themes: readonly DiffTheme[]): string[] =>
  themes.map((theme) => theme.label);

const firstLabel = (themes: readonly DiffTheme[]): string => themes[0]?.label ?? '';

describe('ThemePicker', () => {
  it('pins the default above the groups it does not belong to', () => {
    mount();

    expect(names()[0]).toBe(DEFAULT_LABEL);
    expect(
      [...document.querySelectorAll('.theme-group-label')].map((node) => node.textContent),
    ).toEqual(['Made for colour vision deficiency', 'Light', 'Dark']);
  });

  it('offers every theme once the groups holding them are open', async () => {
    const { user } = mount();

    await user.click(header('Light'));
    await user.click(header('Dark'));

    // The three groups plus the default. The count is the contract with
    // `lib/compare/themes.ts` rather than a number worth memorising.
    expect(names().length).toBeGreaterThan(70);
    expect(names()).toContain('Dracula');
    expect(names()).toContain('Solarized light');
  });

  it('narrows the list to the themes whose name matches', async () => {
    const { input, user } = mount();

    await user.type(input, 'dracula');

    expect(names()).toEqual(['Dracula soft', 'Dracula']);
  });

  it('drops a group entirely rather than drawing an empty heading', async () => {
    const { input, user } = mount();

    await user.type(input, 'dracula');

    expect(groupLabels()).toEqual(['Dark']);
  });

  it('says so when the filter matches nothing', async () => {
    const { input, user } = mount();

    await user.type(input, 'zzz');

    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('No theme matches');
  });

  it('keeps the default reachable through the filter', async () => {
    const { input, user, onChange } = mount('dracula');

    await user.type(input, 'match');

    expect(names()).toEqual([DEFAULT_LABEL]);

    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('clears the filter on Escape rather than making it a selection to delete', async () => {
    const { input, user } = mount();

    await user.type(input, 'dracula');
    expect(names()).toHaveLength(2);

    await user.keyboard('{Escape}');

    expect((input as HTMLInputElement).value).toBe('');
    // Back to the folds it was left with, not to seventy-six rows. The filter
    // is picked up and put down; it is not a decision about the arrangement.
    expect(names()).toEqual([DEFAULT_LABEL, ...labels(ACCESSIBLE_THEMES)]);
  });

  it('points at the chosen theme when it opens, not at the top of the list', () => {
    const { input } = mount('dracula');

    const dracula = screen.getByRole('option', { name: 'Dracula' });
    expect(input.getAttribute('aria-activedescendant')).toBe(dracula.id);
  });

  it('moves the active option with the arrow keys, and keeps focus in the box', async () => {
    const { input, user } = mount();

    input.focus();
    const options = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[2]?.id);

    await user.keyboard('{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id);

    expect(document.activeElement).toBe(input);
  });

  it('does not walk off either end of the list', async () => {
    const { input, user } = mount();

    input.focus();
    const options = screen.getAllByRole('option');

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);

    await user.keyboard('{End}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      options[options.length - 1]?.id,
    );
  });

  it('chooses the active option on Enter', async () => {
    const { input, user, onChange } = mount();

    input.focus();
    await user.keyboard('{ArrowDown}{Enter}');

    // The first row under the default is the first of the four themes offered
    // to reviewers with a colour vision deficiency, which is the order
    // `lib/compare/themes.ts` puts them in on purpose.
    expect(onChange).toHaveBeenCalledWith('pierre-light-protanopia-deuteranopia');
  });

  it('chooses a row that is clicked', async () => {
    const { user, onChange } = mount();

    await user.click(header('Dark'));
    await user.click(screen.getByRole('option', { name: 'Nord' }));

    expect(onChange).toHaveBeenCalledWith('nord');
  });

  it('marks exactly the chosen theme as selected', () => {
    mount('nord');

    const selected = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true');

    expect(selected.map((option) => option.textContent)).toEqual(['Nord']);
  });

  it('draws a swatch beside every name, hidden from the reader', () => {
    mount('nord');

    const nord = screen.getByRole('option', { name: 'Nord' });
    const swatch = nord.querySelector('.theme-swatch');

    expect(swatch?.getAttribute('aria-hidden')).toBe('true');
    // Colour reaches the page as data rather than as a class, which is what
    // keeps it out of the stylesheet `ui/tokens.test.tsx` guards.
    expect(swatch?.getAttribute('style')).toContain('background');
    expect(swatch?.querySelectorAll('.theme-chip')).toHaveLength(4);
  });

  it('leaves the default swatch to the page, so it is a picture of the page', () => {
    mount();

    const swatch = screen
      .getByRole('option', { name: DEFAULT_LABEL })
      .querySelector('.theme-swatch');

    expect(swatch?.getAttribute('style')).toBeNull();
  });
});

describe('ThemePicker folds', () => {
  it('opens the group holding the chosen theme and leaves the other two shut', () => {
    mount('nord');

    expect(names()).toEqual([DEFAULT_LABEL, ...labels(DARK_THEMES)]);
    expect(groupLabels()).toEqual([
      `Made for colour vision deficiency, ${ACCESSIBLE_THEMES.length} themes, collapsed`,
      `Light, ${LIGHT_THEMES.length} themes, collapsed`,
      'Dark',
    ]);
  });

  it('opens the accessible group when the value belongs to no group at all', () => {
    mount();

    // The default is pinned above all three and is in none of them, so the
    // rule is the first group rather than nothing: three headings with no rows
    // under any of them reads as a list that failed rather than one that is
    // folded, and these four are the ones PRODUCT.md says to meet first.
    expect(names()).toEqual([DEFAULT_LABEL, ...labels(ACCESSIBLE_THEMES)]);
    expect(groupLabels()[0]).toBe('Made for colour vision deficiency');
  });

  it('tells the reader a shut group is shut and how much it holds', () => {
    mount();

    expect(groupLabels()[2]).toBe(`Dark, ${DARK_THEMES.length} themes, collapsed`);
    // And says the same thing to everybody else, in the heading it draws.
    expect(header('Dark').textContent).toContain(String(DARK_THEMES.length));
  });

  it('folds and unfolds a group when its heading is clicked', async () => {
    const { user } = mount();

    await user.click(header('Dark'));
    expect(names()).toContain('Dracula');

    await user.click(header('Dark'));
    expect(names()).not.toContain('Dracula');
  });

  it('keeps the keyboard in the search box when a heading is clicked', async () => {
    const { input, user } = mount();

    input.focus();
    await user.click(header('Dark'));

    expect(document.activeElement).toBe(input);
  });

  it('folds the group the cursor is in on ArrowLeft, and opens it on ArrowRight', async () => {
    const { input, user } = mount('nord');

    // Two groups open, so shutting one leaves a row at its seam for the cursor
    // to rest on — which is the position the two keys are inverses about.
    await user.click(header('Light'));
    input.focus();
    expect(names()).toContain('Solarized light');

    await user.keyboard('{ArrowLeft}');
    expect(names()).not.toContain('Solarized light');
    expect(names()).toContain('Nord');

    await user.keyboard('{ArrowRight}');
    expect(names()).toContain('Solarized light');
    // On the first row the group brought back with it, which is the seam the
    // cursor was left sitting on.
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: firstLabel(LIGHT_THEMES) }).id,
    );
  });

  it('opens a group again after the last one shut took the seam with it', async () => {
    const { input, user } = mount('nord');

    input.focus();
    await user.keyboard('{ArrowLeft}');

    // Every group shut, so the cursor is back on the pinned default above all
    // three and there is no seam left to point at. ArrowRight is still a key
    // that opens something rather than one that has gone dead.
    expect(names()).toEqual([DEFAULT_LABEL]);

    await user.keyboard('{ArrowRight}');
    expect(names()).toEqual([DEFAULT_LABEL, ...labels(ACCESSIBLE_THEMES)]);
  });

  it('reaches a shut group the cursor is not in', async () => {
    const { input, user } = mount();

    input.focus();
    // Two of the three arrive shut and the cursor is on the pinned default, so
    // without a search downward there is no key that reaches either of them.
    await user.keyboard('{ArrowRight}');
    expect(names()).toContain('Solarized light');

    await user.keyboard('{ArrowRight}');
    expect(names()).toContain('Dracula');
    expect(names().length).toBeGreaterThan(70);
  });

  it('never leaves the cursor on a row a fold has taken off the page', async () => {
    const { input, user } = mount('nord');

    input.focus();
    await user.keyboard('{ArrowLeft}');

    const at = input.getAttribute('aria-activedescendant');
    expect(at).not.toBeNull();
    expect(document.getElementById(at ?? '')).not.toBeNull();
  });

  it('forces every group open while filtering and restores the folds after', async () => {
    const { input, user } = mount();

    await user.type(input, 'e');
    expect(groupLabels().every((label) => label?.includes('collapsed') !== true)).toBe(
      true,
    );

    await user.keyboard('{Escape}');
    expect(groupLabels()[2]).toContain('collapsed');
  });

  it('leaves ArrowLeft and ArrowRight to the caret while there is text to move through', async () => {
    const { input, user } = mount();

    await user.type(input, 'dark');
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowRight}');
    await user.keyboard('{Escape}');

    // Unchanged, because those keystrokes went to the caret in a box the
    // reviewer was typing in rather than to folds the filter had opened anyway.
    expect(names()).toEqual([DEFAULT_LABEL, ...labels(ACCESSIBLE_THEMES)]);
  });

  it('does not re-seed when the reviewer changes theme mid-session', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ThemePicker value="" onChange={onChange} />);
    const user = userEvent.setup();

    await user.click(header('Dark'));
    expect(names()).toContain('Dracula');

    rerender(<ThemePicker value="dracula" onChange={onChange} />);

    // Both groups the reviewer had open are still open, and the one they left
    // shut is still shut. Re-seeding here would shut the group they were
    // reading to tell them something they had just said.
    expect(names()).toContain('Dracula');
    expect(names()).toContain(firstLabel(ACCESSIBLE_THEMES));
    expect(groupLabels()[1]).toContain('collapsed');
  });
});
