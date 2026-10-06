/**
 * The funnel at the end of the rail's filter row.
 *
 * What is pinned here is the translation between the menu and the filter
 * state, because it runs two ways at once: the five toggles at the top are
 * ticked to *hide* (or to narrow to) something, and the kinds and types below
 * them are ticked to *show* it. Each row's label says which, and each has to do
 * what its label says.
 */

import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type FileFacets, type FileFilters, NO_FILTERS, fileFacets } from '@/lib/review/fileFilters';
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
    // Under what sort of file each is: Code, then Docs, then Other.
    expect(screen.getByRole('group', { name: 'File type' }).textContent).toMatch(
      /Code.*\.ts2.*Docs.*\.md1.*Other.*Dotfiles1/,
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

/**
 * Longer types, and reading types last.
 *
 * `.spec.tsx` sits one step in under `.tsx`, because hiding `.tsx` hides the
 * specs too: the row underneath cannot be shown while the one above it is
 * hidden, so it says so rather than pretending. The same types are listed a
 * second time to be read last, and each tick there sends its type to the very
 * end, after any already there.
 */
describe('the filter menu, with longer types', () => {
  const at = (path: string) => ({
    path,
    changeType: 'MODIFIED' as const,
    additions: 1,
    deletions: 1,
    isBinary: false,
  });
  const NESTED = fileFacets([
    at('src/a.spec.tsx'),
    at('src/b.spec.tsx'),
    at('src/c.tsx'),
    at('assets/logo.png'),
  ]);

  function mountNested(
    props: { filters?: FileFilters; last?: readonly string[] } = {},
  ) {
    const onChange = vi.fn<(next: FileFilters) => void>();
    const onLast = vi.fn<(next: readonly string[]) => void>();
    render(
      <FilterMenu
        filters={props.filters ?? NO_FILTERS}
        facets={NESTED}
        onChange={onChange}
        active={props.filters !== undefined}
        last={props.last ?? []}
        onLast={onLast}
      />,
    );
    return { onChange, onLast };
  }

  it('lists a longer type one step in, under its extension', async () => {
    mountNested();
    await userEvent.click(trigger());

    const types = within(screen.getByRole('group', { name: 'File type' }))
      .getAllByRole('menuitemcheckbox')
      .map((item) => [item.textContent, item.getAttribute('data-indent')]);
    // Code before Images, and the specs under `.tsx` within Code.
    expect(types).toEqual([
      ['.tsx3', null],
      ['.spec.tsx2', 'true'],
      ['.png1', null],
    ]);
  });

  it('shows a longer type as hidden, and will not take it, while its extension is hidden', async () => {
    const { onChange } = mountNested({ filters: { ...NO_FILTERS, hiddenTypes: new Set(['.tsx']) } });
    await userEvent.click(trigger());

    const spec = within(screen.getByRole('group', { name: 'File type' })).getByRole(
      'menuitemcheckbox',
      { name: /^\.spec\.tsx/ },
    );
    expect(spec.getAttribute('aria-checked')).toBe('false');
    expect(spec.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(spec);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lists the same types to read last, ticked for the ones already at the end', async () => {
    mountNested({ last: ['.png'] });
    await userEvent.click(trigger());

    const last = screen.getByRole('group', { name: 'Read last' });
    expect(within(last).getByRole('menuitemcheckbox', { name: 'Read .png last' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      within(last).getByRole('menuitemcheckbox', { name: 'Read .spec.tsx last' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('sends a type to the very end, after any already there, and stays open', async () => {
    const { onLast } = mountNested({ last: ['.png'] });
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Read .spec.tsx last' }));

    expect(onLast).toHaveBeenLastCalledWith(['.png', '.spec.tsx']);
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('takes a type back from the end', async () => {
    const { onLast } = mountNested({ last: ['.png', '.spec.tsx'] });
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Read .png last' }));

    expect(onLast).toHaveBeenLastCalledWith(['.spec.tsx']);
  });

  it('offers nothing to read last without somewhere to send it', async () => {
    render(<FilterMenu filters={NO_FILTERS} facets={NESTED} onChange={vi.fn()} active={false} />);
    await userEvent.click(trigger());

    expect(screen.queryByRole('group', { name: 'Read last' })).toBeNull();
  });
});

/**
 * Showing only some types, with Ctrl.
 *
 * A Ctrl-click shows that type alone, and every Ctrl-click after it, before
 * Ctrl is let go, adds one more. Let go and Ctrl-click again, and it starts
 * from one type again. The menu is held by a parent here, as it is by the
 * shell, so each press sees what the last one did.
 */
describe('the filter menu, showing only some types', () => {
  function Held({ facets, onFilters }: { facets: FileFacets; onFilters: (next: FileFilters) => void }) {
    const [filters, setFilters] = useState<FileFilters>(NO_FILTERS);
    return (
      <FilterMenu
        filters={filters}
        facets={facets}
        onChange={(next) => {
          setFilters(next);
          onFilters(next);
        }}
        active={filters !== NO_FILTERS}
      />
    );
  }

  const typeRow = (name: RegExp) =>
    within(screen.getByRole('group', { name: 'File type' })).getByRole('menuitemcheckbox', { name });
  const shown = (onFilters: ReturnType<typeof vi.fn>) =>
    [...((onFilters.mock.calls.at(-1)?.[0] as FileFilters | undefined)?.onlyTypes ?? [])];

  it('says how, under the File type heading', async () => {
    mount();
    await userEvent.click(trigger());

    const describedBy = screen.getByRole('group', { name: 'File type' }).getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Ctrl-click to show only the ones you pick',
    );
  });

  it('shows only the type Ctrl-clicked, and each one after it while Ctrl is held', async () => {
    const onFilters = vi.fn();
    const user = userEvent.setup();
    render(<Held facets={FACETS} onFilters={onFilters} />);
    await user.click(trigger());

    await user.keyboard('{Control>}');
    await user.click(typeRow(/^\.ts/));
    await user.click(typeRow(/^\.md/));
    await user.keyboard('{/Control}');

    expect(shown(onFilters)).toEqual(['.ts', '.md']);
    expect(typeRow(/^\.ts/).getAttribute('aria-checked')).toBe('true');
    expect(typeRow(/^Dotfiles/).getAttribute('aria-checked')).toBe('false');
  });

  it('starts again from one type once Ctrl has been let go', async () => {
    const onFilters = vi.fn();
    const user = userEvent.setup();
    render(<Held facets={FACETS} onFilters={onFilters} />);
    await user.click(trigger());
    await user.keyboard('{Control>}');
    await user.click(typeRow(/^\.ts/));
    await user.click(typeRow(/^\.md/));
    await user.keyboard('{/Control}');

    await user.keyboard('{Control>}');
    await user.click(typeRow(/^Dotfiles/));
    await user.keyboard('{/Control}');

    expect(shown(onFilters)).toEqual(['dotfile']);
  });

  it('adds a type back with a plain click while only some are shown', async () => {
    const onFilters = vi.fn();
    const user = userEvent.setup();
    render(<Held facets={FACETS} onFilters={onFilters} />);
    await user.click(trigger());
    await user.keyboard('{Control>}');
    await user.click(typeRow(/^\.ts/));
    await user.keyboard('{/Control}');

    await user.click(typeRow(/^\.md/));

    expect(shown(onFilters)).toEqual(['.ts', '.md']);
  });

  it('groups the types to read last the same way', async () => {
    render(
      <FilterMenu filters={NO_FILTERS} facets={FACETS} onChange={vi.fn()} active={false} last={[]} onLast={vi.fn()} />,
    );
    await userEvent.click(trigger());

    const last = screen.getByRole('group', { name: 'Read last' });
    expect(within(last).getByRole('group', { name: 'Code' })).toBeDefined();
    expect(within(last).getByRole('group', { name: 'Docs' })).toBeDefined();
  });
});

