/**
 * The theme list, as a list that can be searched rather than a select that
 * cannot.
 *
 * Seventy-six entries in a native `<select>` is a scroll and a guess: the
 * control shows one row at a time, type-to-find matches only from the start of
 * a name, and nothing in it says what any theme looks like. The argument for it
 * was that it is the one control every platform already knows how to search.
 * That argument loses to the swatch — a theme's own page, text, accent, good
 * and bad colours, drawn beside its name — which no `<option>` can carry.
 *
 * **The swatch is the one place colour arrives as a value rather than a token.**
 * `lib/theme/palettes.ts` is the derived table, so the colours come out of it at
 * runtime and go on as inline styles. `ui/tokens.test.tsx` reads stylesheets, so
 * nothing here is hidden from it: there is no hex in any CSS file, and the
 * default's own swatch carries no inline colour at all — it is drawn from the
 * page's live tokens, so it is always a picture of what "match the page"
 * currently means.
 *
 * Focus is managed rather than roving, which is the difference from
 * `ui/FileTree.tsx`: the reviewer is typing, so the keyboard stays in the box
 * and `aria-activedescendant` says which row it is pointing at. The filter, the
 * arrow keys and Escape-to-clear are the conventions `ui/SearchPanel.tsx` and
 * the tree's own filter already set.
 */

import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ACCESSIBLE_THEMES,
  DARK_THEMES,
  DIFF_THEMES,
  type DiffTheme,
  LIGHT_THEMES,
  THEME_FOLLOWS_PAGE,
} from '@/lib/compare/themes';
import { chromeTheme } from '@/lib/theme/palettes';

/**
 * The default, pinned above the three groups and belonging to none of them.
 *
 * It is not a theme id — it is the absence of one — which is exactly why it is
 * written here rather than added to a list in `lib/compare/themes.ts`.
 */
const DEFAULT_LABEL = 'Match the page (default)';

/** The groups, in the order they are offered. */
const GROUPS: readonly { name: string; themes: readonly DiffTheme[] }[] = [
  { name: 'Made for colour vision deficiency', themes: ACCESSIBLE_THEMES },
  { name: 'Light', themes: LIGHT_THEMES },
  { name: 'Dark', themes: DARK_THEMES },
];

/** Every id the list can offer, for the count and for the opening position. */
const ALL_IDS: readonly string[] = [
  THEME_FOLLOWS_PAGE,
  ...DIFF_THEMES.map((theme) => theme.id),
];

/**
 * Four colours out of a palette: what text is, what is clickable, what went
 * well, what went wrong.
 *
 * Four rather than a full preview because the row is 24px tall and the name is
 * the thing being read. These four are the ones that differ most between
 * themes, and three of them are the colours a reviewer is about to spend an
 * hour looking at.
 */
const SWATCH = ['--fg-default', '--accent-fg', '--success-fg', '--danger-fg'] as const;

/** A theme's palette in miniature, or the page's own when there is no theme. */
function Swatch({ id }: { id: string }) {
  const theme = chromeTheme(id);

  // Null for the default, and it is null by design rather than by omission:
  // `ui/tokens.css` is that palette. Leaving the inline styles off lets the
  // stylesheet draw this one from the live tokens, so it repaints with the page.
  if (theme === null) {
    return (
      <span className="theme-swatch" aria-hidden="true">
        {SWATCH.map((token) => (
          <span key={token} className="theme-chip" />
        ))}
      </span>
    );
  }

  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={{
        background: theme.palette['--canvas-default'],
        borderColor: theme.palette['--border-default'],
      }}
    >
      {SWATCH.map((token) => (
        <span
          key={token}
          className="theme-chip"
          style={{ background: theme.palette[token] }}
        />
      ))}
    </span>
  );
}

export interface ThemePickerProps {
  /** A theme id, or the empty string for the default. */
  value: string;
  /** The reviewer chose one. Called with the id, or the empty string. */
  onChange: (id: string) => void;
}

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const [query, setQuery] = useState('');
  // Opens on whatever is already chosen, so the first Down goes to its
  // neighbour rather than to the top of a list of seventy-six.
  const [active, setActive] = useState(() => Math.max(0, ALL_IDS.indexOf(value)));
  const listId = useId();
  const elements = useRef(new Map<string, HTMLElement>());

  const optionId = (id: string): string =>
    `${listId}-${id === THEME_FOLLOWS_PAGE ? 'default' : id}`;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const keep = (label: string): boolean =>
      needle === '' || label.toLowerCase().includes(needle);
    return {
      pinned: keep(DEFAULT_LABEL),
      groups: GROUPS.map((group) => ({
        name: group.name,
        themes: group.themes.filter((theme) => keep(theme.label)),
      })),
    };
  }, [query]);

  /** What the arrow keys walk: every visible row, in the order it is drawn. */
  const order = useMemo(() => {
    const ids: string[] = shown.pinned ? [THEME_FOLLOWS_PAGE] : [];
    for (const group of shown.groups) {
      for (const theme of group.themes) ids.push(theme.id);
    }
    return ids;
  }, [shown]);

  // Clamped rather than stored clamped: a narrower list must not be able to
  // leave the cursor pointing past its end for the render that draws it.
  const index = Math.min(active, order.length - 1);
  const activeId = index < 0 ? undefined : order[index];

  useEffect(() => {
    if (activeId === undefined) return;
    elements.current.get(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const move = (to: number): void => {
    if (order.length === 0) return;
    setActive(Math.min(Math.max(to, 0), order.length - 1));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const key = event.key;
    if (key === 'ArrowDown') move(index + 1);
    else if (key === 'ArrowUp') move(index - 1);
    else if (key === 'Home') move(0);
    else if (key === 'End') move(order.length - 1);
    else if (key === 'Enter') {
      if (activeId === undefined) return;
      onChange(activeId);
    } else if (key === 'Escape') {
      // Escape rather than selecting the text and deleting it, which is what
      // the file tree's filter does and what a box meant to be picked up and
      // put down should do. An empty box has nothing to clear, so the key is
      // left to whatever is listening outside.
      if (query === '') return;
      setQuery('');
      setActive(0);
    } else return;

    event.preventDefault();
  };

  const choose = (id: string): void => {
    setActive(order.indexOf(id));
    onChange(id);
  };

  const row = (id: string, label: string) => (
    <div
      key={id === THEME_FOLLOWS_PAGE ? 'default' : id}
      ref={(node) => {
        if (node === null) elements.current.delete(id);
        else elements.current.set(id, node);
      }}
      id={optionId(id)}
      className="theme-option"
      role="option"
      aria-selected={id === value}
      data-active={id === activeId ? 'true' : undefined}
      // The keyboard belongs to the box above; a click must not take it away
      // and leave the arrow keys pointing at nothing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(id)}
    >
      <Swatch id={id} />
      <span className="theme-name">{label}</span>
    </div>
  );

  const filtering = query.trim() !== '';

  return (
    <div className="theme-picker">
      <input
        type="search"
        className="theme-search"
        role="combobox"
        // Always, because the list is always drawn. This is a filter over a
        // list on the page, not a popup that has to be opened first.
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId === undefined ? undefined : optionId(activeId)}
        aria-label="Filter themes"
        placeholder="Filter themes…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />

      <div className="theme-list" id={listId} role="listbox" aria-label="Theme">
        {shown.pinned && row(THEME_FOLLOWS_PAGE, DEFAULT_LABEL)}
        {shown.groups.map((group) =>
          group.themes.length === 0 ? null : (
            <div className="theme-group" role="group" aria-label={group.name} key={group.name}>
              {/* Hidden from the reader, which already hears the group's name
                  from `aria-label`, and drawn for everyone else. */}
              <div className="theme-group-name" aria-hidden="true">
                {group.name}
              </div>
              {group.themes.map((theme) => row(theme.id, theme.label))}
            </div>
          ),
        )}
      </div>

      {/* Silent until the filter is doing something, so a list nobody has
          narrowed says nothing about how long it is. */}
      <p className="theme-count" role="status">
        {!filtering
          ? ''
          : order.length === 0
            ? `No theme matches “${query.trim()}”`
            : `${order.length} of ${ALL_IDS.length}`}
      </p>
    </div>
  );
}
