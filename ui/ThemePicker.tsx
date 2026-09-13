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
 * **The groups fold, and the list opens on the one the reviewer is already in.**
 * Seventy-six rows inside a 17rem box is four screens of scrolling, most of it
 * past themes nobody is considering: a reviewer on Nord who wants the next dark
 * theme along should not have to travel through thirty-five light ones to reach
 * it. So the list arrives with one group open — the one holding the chosen
 * theme — and the other two shut behind a count.
 *
 * **The fold is a pointer affordance and a key, never a control.** The header
 * cannot be a `<button>`: a focusable child inside a `listbox` takes the
 * keyboard away from the `combobox` that owns it, and this control's whole
 * arrangement is that focus never leaves the search box. So pointer users click
 * the header, keyboard users get ArrowLeft and ArrowRight on the group the
 * cursor is in, and the two arrive at the same place. That is the tree's
 * bargain, and `ui/FileTree.tsx` argues the same trade for its own rows.
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

/**
 * The group a list with no theme chosen opens on.
 *
 * Named rather than spelled twice, because the seed below points at it and the
 * reason it points here is worth reading next to the name. See
 * {@link openingGroup}.
 */
const FIRST_GROUP = 'Made for colour vision deficiency';

/** The groups, in the order they are offered. */
const GROUPS: readonly { name: string; themes: readonly DiffTheme[] }[] = [
  { name: FIRST_GROUP, themes: ACCESSIBLE_THEMES },
  { name: 'Light', themes: LIGHT_THEMES },
  { name: 'Dark', themes: DARK_THEMES },
];

/** Every id the list can offer, for the count and for the opening position. */
const ALL_IDS: readonly string[] = [
  THEME_FOLLOWS_PAGE,
  ...DIFF_THEMES.map((theme) => theme.id),
];

/** Which group a theme sits in, so a keystroke does not search three arrays. */
const GROUP_OF: ReadonlyMap<string, string> = new Map(
  GROUPS.flatMap((group) => group.themes.map((theme) => [theme.id, group.name] as const)),
);

/**
 * No folds, shared so a filtered render does not allocate one per keystroke.
 *
 * What a narrowed list is drawn with, and the argument is the one
 * `ui/FileTree.tsx` makes at its own `NOTHING_COLLAPSED`: a group the reviewer
 * shut still holds whatever matched, and leaving it shut would have the count
 * under the list claim themes the list is not showing — which reads as the
 * filter being broken rather than as the group being closed.
 *
 * The reviewer's own fold set is untouched underneath rather than rewritten, so
 * clearing the filter puts the list back exactly as it was left. A filter is
 * something picked up and put down between one look and the next; it is not a
 * decision about how the list is arranged.
 */
const NOTHING_FOLDED: ReadonlySet<string> = new Set();

/**
 * The group the list opens on, and the rule for a value that is in none.
 *
 * A chosen theme answers it: open the group holding it, so the first ArrowDown
 * goes to its neighbour and the swatch beside it is on screen without a scroll.
 *
 * "Match the page" is in no group — it is the absence of a theme, pinned above
 * all three — so it needs a rule of its own, and the choice is the first group
 * rather than nothing at all. Opening none would leave a fresh install looking
 * at a filter box over three grey headings with no themes under any of them,
 * which reads as a list that failed to load rather than as one that is folded.
 * Of the three, this is both the smallest — four rows, so opening it costs
 * almost nothing — and the one PRODUCT.md already says should be met first:
 * the themes built for colour vision deficiency are why this setting is worth
 * having rather than a nicety, and they are offered first for that reason.
 */
function openingGroup(value: string): string {
  return GROUP_OF.get(value) ?? FIRST_GROUP;
}

/**
 * Where the cursor starts, counted in the list the seed above will draw.
 *
 * Not `ALL_IDS.indexOf(value)`, which is the position in a list with every
 * group open and is wrong by thirty-nine rows the moment two of them are shut.
 * With one group open the whole list is the pinned default followed by that
 * group's themes, so the arithmetic is that and nothing more.
 */
function openingIndex(value: string): number {
  const home = GROUPS.find((group) => group.name === openingGroup(value));
  const at = home === undefined ? -1 : home.themes.findIndex((theme) => theme.id === value);
  // Row zero is the pinned default. A value that is not in the group that just
  // opened is the default — or an id storage should not have had, which the
  // default is also the right answer to.
  return at === -1 ? 0 : at + 1;
}

/** One theme, or however many, said the way a label has to say it. */
const themeCount = (many: number): string =>
  `${many} ${many === 1 ? 'theme' : 'themes'}`;

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

  /**
   * The folds, seeded once from the theme in use and the reviewer's after that.
   *
   * Once is the whole of it, and it is the same argument `ui/FileTree.tsx`
   * makes above its `seeded` ref: a reviewer who tries four themes in a row has
   * arranged these folds themselves by the third, and a seed that re-applied
   * itself on every change would shut the group they were working through to
   * tell them something they had just said. The tree's ref exists because its
   * file list arrives long after it mounts, so there is no first render with
   * the real thing in hand; here there is one. `entrypoints/options/main.tsx`
   * draws nothing at all until `readSettings` has resolved, so the very first
   * `value` this component sees is the stored theme rather than a default that
   * is about to be replaced — which is what lets a lazy initialiser, which
   * React runs exactly once per mount, stand in for the ref and the comment
   * that would have to explain it.
   */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => {
    const home = openingGroup(value);
    return new Set(
      GROUPS.filter((group) => group.name !== home).map((group) => group.name),
    );
  });

  // Opens on whatever is already chosen, so the first Down goes to its
  // neighbour rather than to the top of a list of seventy-six.
  const [active, setActive] = useState(() => openingIndex(value));
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

  const filtering = query.trim() !== '';

  /** What is shut on screen, which while the filter is on is nothing. */
  const folds = filtering ? NOTHING_FOLDED : folded;

  /**
   * What the arrow keys walk: every row that is on screen, in the order it is
   * drawn.
   *
   * A shut group contributes nothing, and it has to be that way round rather
   * than filtered later: an id in here that is not drawn is a cursor walking
   * into rows nobody can see, with `aria-activedescendant` naming an element
   * that is not in the document.
   */
  const order = useMemo(() => {
    const ids: string[] = shown.pinned ? [THEME_FOLLOWS_PAGE] : [];
    for (const group of shown.groups) {
      if (folds.has(group.name)) continue;
      for (const theme of group.themes) ids.push(theme.id);
    }
    return ids;
  }, [shown, folds]);

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

  /**
   * The seam: where a group's rows begin, counted in the list as it stands.
   *
   * The group's own rows are not counted, which is what makes this one number
   * the answer to both directions. Shut a group and the seam is the row that
   * has just taken its place; open one and the seam is the first row it
   * brought with it. Leaving the cursor there is what makes ArrowRight an
   * exact undo of the ArrowLeft before it, and it is also the only position
   * from which a reviewer can reach a group that is already shut.
   */
  const startOf = (name: string): number => {
    let at = shown.pinned ? 1 : 0;
    for (const group of shown.groups) {
      if (group.name === name) return at;
      if (!folds.has(group.name)) at += group.themes.length;
    }
    return at;
  };

  const fold = (name: string, shut: boolean): void => {
    setFolded((open) => {
      const next = new Set(open);
      if (shut) next.add(name);
      else next.delete(name);
      return next;
    });
    // Past the end when the last group shuts, which the clamp above answers.
    setActive(startOf(name));
  };

  /**
   * The shut group ArrowRight opens: the nearest one above the cursor, and
   * failing that the nearest one below.
   *
   * Above comes first because that is where the seam points. Shutting a group
   * leaves the cursor on the first row *after* it, so the group the reviewer
   * has just folded is the shut one immediately above wherever they now are,
   * and searching that way round is what makes the two keys undo each other.
   *
   * Below is the half that keeps the list operable. Two groups arrive shut,
   * and without a search in that direction a reviewer sitting above both of
   * them has no key that reaches either — a third of the themes unreachable
   * without a pointer, which is the kind of gap PRODUCT.md calls a product bug
   * rather than an accessibility footnote. With it, ArrowRight opens something
   * whenever anything is shut, and pressing it until it stops opens the lot.
   *
   * The one case it cannot be an undo is shutting the last open group: there
   * is then no row left at the seam, the cursor falls back to the pinned
   * default above all three, and the nearest shut group below it is the first.
   * That is a reviewer who has just folded away every theme in the list, and
   * one more press of the same key is a cheaper answer than a second piece of
   * state remembering where they meant to be.
   */
  const nextFolded = (): string | null => {
    const from = activeId === undefined ? undefined : GROUP_OF.get(activeId);
    const at = from === undefined ? -1 : GROUPS.findIndex((group) => group.name === from);
    const shut = GROUPS.map((group, position) => ({ name: group.name, position })).filter(
      (entry) => folds.has(entry.name),
    );
    const above = shut.filter((entry) => entry.position < at).at(-1);
    const below = shut.find((entry) => entry.position > at);
    return (above ?? below)?.name ?? null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const key = event.key;
    if (key === 'ArrowDown') move(index + 1);
    else if (key === 'ArrowUp') move(index - 1);
    else if (key === 'Home') move(0);
    else if (key === 'End') move(order.length - 1);
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      // Only over an empty box. There is a caret in this input and these two
      // keys are what moves it, so taking them from a reviewer halfway through
      // typing a name would be dismantling the text box to reach a fold the
      // filter has already opened anyway.
      if (query !== '') return;
      const group =
        key === 'ArrowLeft'
          ? activeId === undefined
            ? undefined
            : GROUP_OF.get(activeId)
          : (nextFolded() ?? undefined);
      // The pinned default is in no group, so ArrowLeft on it has nothing to
      // shut, and ArrowRight has nothing to open once every group is open.
      if (group === undefined) return;
      fold(group, key === 'ArrowLeft');
    } else if (key === 'Enter') {
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
        {shown.groups.map((group) => {
          if (group.themes.length === 0) return null;
          const shut = folds.has(group.name);

          return (
            <div
              className="theme-group"
              role="group"
              // Open, the options are there to be counted and the reader hears
              // the group's name on the way into them, so the name is the whole
              // of what the label has to carry. Shut, there is nothing inside
              // at all — no option, no count, no state — and a group that has
              // quietly stopped holding thirty-five themes is the one thing
              // this fold could take away from a reader that it takes from
              // nobody else. So that case, and only that case, says both.
              aria-label={
                shut
                  ? `${group.name}, ${themeCount(group.themes.length)}, collapsed`
                  : group.name
              }
              data-open={shut ? undefined : 'true'}
              key={group.name}
            >
              {/* Hidden from the reader, which already hears the group's name
                  and its state from `aria-label`, and drawn for everyone else.
                  It is a `<div>` and stays one: a `<button>` in here would be a
                  focusable child inside a listbox, and the box above would lose
                  the keyboard to it on the first Tab. Under a filter it is not
                  a control at all, because every group is open and a header
                  that recorded a fold nobody could see would be acting off
                  screen. The chevron stays, and stays down, because that is
                  still a true report of the group it is on. */}
              <div
                className="theme-group-name"
                aria-hidden="true"
                data-foldable={filtering ? undefined : 'true'}
                // The keyboard belongs to the box above; a click must not take
                // it away and leave the arrow keys pointing at nothing.
                onMouseDown={(event) => event.preventDefault()}
                onClick={filtering ? undefined : () => fold(group.name, !shut)}
              >
                <span className="theme-chevron" />
                <span className="theme-group-label">{group.name}</span>
                {/* Text plus a muted count, which is how every other grouping
                    heading in this product is set. It is also the only thing on
                    a shut group that says how much is behind it. */}
                <span className="theme-group-count">{group.themes.length}</span>
              </div>
              {!shut && group.themes.map((theme) => row(theme.id, theme.label))}
            </div>
          );
        })}
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
