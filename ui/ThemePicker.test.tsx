/**
 * The theme picker.
 *
 * What is being checked is the thing a `<select>` gave away for free and this
 * control has to earn: that the list can be narrowed, that it can be walked and
 * chosen from without a mouse, and that the default — the only entry whose
 * contrast is a promise rather than a preference — is still one keystroke away
 * after the list has been narrowed to something else.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

describe('ThemePicker', () => {
  it('pins the default above the groups it does not belong to', () => {
    mount();

    expect(names()[0]).toBe(DEFAULT_LABEL);
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Made for colour vision deficiency',
      'Light',
      'Dark',
    ]);
  });

  it('offers every theme when nothing has been typed', () => {
    mount();

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

    expect(
      screen.getAllByRole('group').map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Dark']);
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
    expect(names().length).toBeGreaterThan(70);
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
    mount();

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
