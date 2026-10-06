/**
 * The funnel at the end of the rail's filter row.
 *
 * What is pinned here is the translation between the menu and the filter
 * state, because it runs two ways at once: the five toggles at the top are
 * ticked to *hide* (or to narrow to) something, and the kinds and types below
 * them are ticked to *show* it. Each row's label says which, and each has to do
 * what its label says.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type FileFilters, NO_FILTERS, fileFacets } from '@/lib/review/fileFilters';
import { FilterMenu } from './FilterMenu';

const FACETS = fileFacets([
  { path: 'src/a.ts', changeType: 'MODIFIED', additions: 1, deletions: 1, isBinary: false },
  { path: 'src/b.ts', changeType: 'ADDED', additions: 1, deletions: 0, isBinary: false },
  { path: 'old.md', changeType: 'DELETED', additions: 0, deletions: 4, isBinary: false },
  { path: '.gitignore', changeType: 'MODIFIED', additions: 1, deletions: 0, isBinary: false },
]);

function mount(filters: FileFilters = NO_FILTERS, active = false) {
  const onChange = vi.fn<(next: FileFilters) => void>();
  render(<FilterMenu filters={filters} facets={FACETS} onChange={onChange} active={active} />);
  return { onChange };
}

const trigger = () => screen.getByRole('button', { name: 'File filters' });
const row = (name: RegExp | string) => screen.getByRole('menuitemcheckbox', { name });
const lastChange = (onChange: ReturnType<typeof mount>['onChange']): FileFilters => {
  const call = onChange.mock.calls.at(-1);
  if (call === undefined) throw new Error('onChange was not called');
  return call[0];
};

describe('the filter menu', () => {
  it('lists the kinds and the types this list has, with how many of each', async () => {
    mount();
    await userEvent.click(trigger());

    expect(screen.getByRole('group', { name: 'Change type' }).textContent).toMatch(
      /Added1.*Modified2.*Deleted1/,
    );
    // No "Renamed": this list has none, and a row for nothing is a row to ignore.
    expect(screen.queryByRole('menuitemcheckbox', { name: /Renamed/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'File type' }).textContent).toMatch(
      /\.md1.*\.ts2.*Dotfiles1/,
    );
  });

  it('ticks every kind and type while nothing is hidden, since ticked means shown', async () => {
    mount();
    await userEvent.click(trigger());

    expect(row(/^Deleted/).getAttribute('aria-checked')).toBe('true');
    expect(row(/^\.ts/).getAttribute('aria-checked')).toBe('true');
    expect(row('Hide viewed files').getAttribute('aria-checked')).toBe('false');
  });

  it('hides a kind when its box is unticked, and keeps the menu open for the next', async () => {
    const { onChange } = mount();
    await userEvent.click(trigger());

    await userEvent.click(row(/^Deleted/));

    expect([...lastChange(onChange).hiddenKinds]).toEqual(['deleted']);
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('shows a type again when its box is ticked back', async () => {
    const { onChange } = mount({ ...NO_FILTERS, hiddenTypes: new Set(['.ts', '.md']) }, true);
    await userEvent.click(trigger());

    expect(row(/^\.ts/).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(row(/^\.ts/));

    expect([...lastChange(onChange).hiddenTypes]).toEqual(['.md']);
  });

  it('turns a toggle on and off', async () => {
    const { onChange } = mount();
    await userEvent.click(trigger());

    await userEvent.click(row('Hide viewed files'));
    expect(lastChange(onChange).hideViewed).toBe(true);

    await userEvent.click(row('Hide files that were only moved'));
    expect(lastChange(onChange).hideMoved).toBe(true);
  });

  it('puts everything back from one command, which is off while nothing is filtered', async () => {
    const { onChange } = mount();
    await userEvent.click(trigger());

    const all = screen.getByRole('menuitem', { name: 'Show all files' });
    expect(all.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(all);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears every filter at once when something is filtered', async () => {
    const { onChange } = mount({ ...NO_FILTERS, hideViewed: true, hiddenKinds: new Set(['deleted']) }, true);
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitem', { name: 'Show all files' }));

    expect(lastChange(onChange)).toEqual(NO_FILTERS);
  });

  it('says why the ownership row cannot be ticked, on the row', async () => {
    render(
      <FilterMenu
        filters={NO_FILTERS}
        facets={FACETS}
        onChange={vi.fn()}
        active={false}
        ownership={{ available: false, note: 'This repository has no CODEOWNERS file.' }}
      />,
    );
    await userEvent.click(trigger());

    const owned = row(/Show only files you own/);
    expect(owned.getAttribute('aria-disabled')).toBe('true');
    expect(owned.textContent).toContain('This repository has no CODEOWNERS file.');
  });

  it('draws the trigger as on while anything is filtered, and says so to a screen reader', () => {
    mount({ ...NO_FILTERS, hideViewed: true }, true);

    expect(trigger().getAttribute('data-active')).toBe('true');
    const describedBy = trigger().getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('A filter is on');
  });

  it('describes nothing while nothing is filtered', () => {
    mount();

    expect(trigger().getAttribute('aria-describedby')).toBeNull();
  });

  it('offers most changed first, and asks for folder order back when it is unticked', async () => {
    const onOrder = vi.fn();
    const menu = (order: 'folders' | 'changes') => (
      <FilterMenu
        filters={NO_FILTERS}
        facets={FACETS}
        onChange={vi.fn()}
        active={false}
        order={order}
        onOrder={onOrder}
      />
    );
    const view = render(menu('folders'));
    await userEvent.click(trigger());
    const sort = () => screen.getByRole('menuitemcheckbox', { name: 'Most changed first' });

    expect(sort().getAttribute('aria-checked')).toBe('false');
    await userEvent.click(sort());
    expect(onOrder).toHaveBeenLastCalledWith('changes');

    // Still open, like the filter rows, so the next press is one away.
    view.rerender(menu('changes'));
    expect(sort().getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sort());
    expect(onOrder).toHaveBeenLastCalledWith('folders');
  });

  it('leaves the order out of "Show all files", which is about what is hidden', async () => {
    const onOrder = vi.fn();
    const onChange = vi.fn();
    render(
      <FilterMenu
        filters={{ ...NO_FILTERS, hideViewed: true }}
        facets={FACETS}
        onChange={onChange}
        active
        order="changes"
        onOrder={onOrder}
      />,
    );
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitem', { name: 'Show all files' }));

    expect(onChange).toHaveBeenCalledWith(NO_FILTERS);
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('puts a dot on the funnel while anything is filtered, and takes it off after', () => {
    const { unmount } = render(
      <FilterMenu filters={{ ...NO_FILTERS, hideMoved: true }} facets={FACETS} onChange={vi.fn()} active />,
    );
    expect(trigger().querySelector('.filter-dot')).not.toBeNull();
    unmount();

    mount();
    expect(trigger().querySelector('.filter-dot')).toBeNull();
  });
});
