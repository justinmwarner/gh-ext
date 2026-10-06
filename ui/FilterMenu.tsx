/**
 * The funnel at the end of the rail's filter row, and the menu behind it.
 *
 * The other half of the box beside it. The box narrows the tree while the
 * reviewer looks for something; this narrows the *review* — tree, column and
 * `j`/`k` together — for as long as they leave it set. That is why it is a
 * menu of standing choices rather than a query, and why what it is doing is
 * said in words in two other places: the line under the box, and the bar above
 * the diff. See `lib/review/fileFilters.ts` for what each choice means.
 *
 * The rows run two ways, and the labels are what keep that honest. The five
 * at the top are ticked to hide something ("Hide viewed files") or to narrow to
 * it ("Show only files you own"). The kinds and types below them are ticked to
 * *show* — every box starts ticked, and unticking "Deleted" is how deleted
 * files go away — which is GitHub's own arrangement for the same list and the
 * one a reviewer arriving from there already knows.
 *
 * The types include the longer ones, `.spec.tsx` one step in under `.tsx`,
 * wherever a group of files shares one; `fileFacets` decides which. They are
 * listed under what sort of file they are, Code, Images, Fonts and the rest,
 * so a long list can be read by its headings (`lib/review/fileCategories.ts`).
 * A plain click on a type flips it. A Ctrl-click (⌘ on a Mac) shows only that
 * type, and further Ctrl-clicks before the key comes up add more, which is
 * `onlyType` and the run below. Each category's heading is a row too, which
 * does the same to every type in it at once (`withTypesShown`, `showOnly`),
 * and "Show all types" puts the types back without touching anything else.
 *
 * Two sections are not filters. "Sort" has a single row, "Most changed first",
 * and "Read last" lists the types again, to send to the end of the review
 * rather than out of it. They live here because this is where a reviewer
 * shapes the list. Neither hides anything, though, so neither draws the funnel
 * on, and "Show all files" leaves both alone. `lib/review/readingOrder.ts` has
 * the order itself.
 */

import { type Ref, useEffect, useRef } from 'react';
import { resolveMod } from '@/lib/keymap';
import { CATEGORY_LABELS, type FileCategory, byCategory } from '@/lib/review/fileCategories';
import {
  type ChangeKind,
  DOTFILE,
  type FileFacets,
  type FileFilters,
  NO_EXTENSION,
  NO_FILTERS,
  onlyType,
  parentType,
  showOnly,
  toggleType,
  typeLabel,
  typeShown,
  typesShown,
  withTypesShown,
} from '@/lib/review/fileFilters';
import type { ReadingOrder } from '@/lib/review/readingOrder';
import { MenuButton, type MenuButtonHandle, type MenuGroup, type MenuItem } from './MenuButton';
import { platformString } from './platform';

/** What the ownership row can offer, and what to say about it. */
export interface OwnershipNote {
  /** False when there is nothing to check against — no CODEOWNERS file. */
  available: boolean;
  /** A sentence for the row, or null for none. */
  note: string | null;
}

/** What the modifier for "only this type" is called on this machine: ⌘ on a Mac, Ctrl elsewhere. */
const MOD_LABEL = resolveMod(platformString()) === 'Meta' ? '⌘' : 'Ctrl';

/** Nothing known yet and nothing to say, which is the state before it is asked. */
const UNASKED: OwnershipNote = { available: true, note: null };

const KIND_LABELS: Record<ChangeKind, string> = {
  added: 'Added',
  modified: 'Modified',
  renamed: 'Renamed',
  deleted: 'Deleted',
};

/**
 * What a screen reader calls a type's row in "Read last".
 *
 * The row draws the same `.png` as the one in "File type" above it, and the
 * heading is what tells a sighted reviewer which list they are in. The name
 * has to carry that on its own.
 */
const lastName = (type: string): string =>
  type === DOTFILE
    ? 'Read dotfiles last'
    : type === NO_EXTENSION
      ? 'Read files with no extension last'
      : `Read ${type} last`;

/** What a screen reader calls a category's heading in "Read last". */
const lastCategoryName = (category: FileCategory): string =>
  category === 'other'
    ? 'Read other types last'
    : `Read ${CATEGORY_LABELS[category].toLowerCase()} last`;

/** One more or one fewer, without touching the set the caller holds. */
function flipped<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * A funnel, outlined while nothing is filtered and solid while something is.
 *
 * The change of shape is the state; the trigger's border and tint repeat it.
 * Drawn rather than imported, like every other glyph on the page.
 */
function Funnel({ solid }: { solid: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M2 2.75h12l-4.5 5.5v4.5l-3 1.5v-6z"
        fill={solid ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface FilterMenuProps {
  filters: FileFilters;
  /** Counted over the whole list, so the figures hold still as boxes are unticked. */
  facets: FileFacets;
  onChange: (next: FileFilters) => void;
  /** Anything is being filtered: `isFiltering`, which the caller already holds. */
  active: boolean;
  ownership?: OwnershipNote;
  /** The menu opened or shut. One visit is one change — see `useFileFilter`. */
  onOpenChange?: (open: boolean) => void;
  /** Which order the review is read in. */
  order?: ReadingOrder;
  /**
   * Ask for the other order. No Sort section is drawn without it, which is the
   * state of a component test that mounts the menu on its own.
   */
  onOrder?: (next: ReadingOrder) => void;
  /** The types read last, in the order they were sent there. */
  last?: readonly string[];
  /** Change them. No "Read last" section is drawn without it. */
  onLast?: (next: readonly string[]) => void;
  ref?: Ref<MenuButtonHandle>;
}

const NOTHING_LAST: readonly string[] = [];

export function FilterMenu({
  filters,
  facets,
  onChange,
  active,
  ownership = UNASKED,
  onOpenChange,
  order = 'folders',
  onOrder,
  last = NOTHING_LAST,
  onLast,
  ref,
}: FilterMenuProps) {
  /**
   * Whether a run of Ctrl-clicks is under way: from the first Ctrl-click on a
   * type until Ctrl is let go.
   *
   * A ref rather than state, because nothing is drawn from it. It only
   * decides whether the next Ctrl-click starts again or adds to the last one.
   * The run ends when the key comes up, and when the window loses focus,
   * since the key can come up somewhere this page does not hear. It also ends
   * when the menu shuts.
   */
  const run = useRef(false);
  useEffect(() => {
    const end = (event: KeyboardEvent): void => {
      if (event.key === 'Control' || event.key === 'Meta') run.current = false;
    };
    const lost = (): void => {
      run.current = false;
    };
    window.addEventListener('keyup', end);
    window.addEventListener('blur', lost);
    return () => {
      window.removeEventListener('keyup', end);
      window.removeEventListener('blur', lost);
    };
  }, []);

  const toggle = (
    key: 'hideViewed' | 'hideGenerated' | 'hideMoved' | 'onlyUnresolved' | 'onlyOwned',
    label: string,
    extra: Partial<MenuItem> = {},
  ): MenuItem => ({
    id: key,
    label,
    checked: filters[key],
    keepOpen: true,
    onSelect: () => onChange({ ...filters, [key]: !filters[key] }),
    ...extra,
  });

  /** Nothing to reset: no only-list, and every type listed here is shown. */
  const everyTypeShown =
    filters.onlyTypes === null && typesShown(filters, [...facets.types.keys()]) === 'all';

  const groups: MenuGroup[] = [
    {
      id: 'toggles',
      items: [
        toggle('hideViewed', 'Hide viewed files'),
        toggle('hideGenerated', 'Hide generated files'),
        toggle('hideMoved', 'Hide files that were only moved'),
        toggle('onlyUnresolved', 'Show only files with unresolved conversations'),
        toggle('onlyOwned', 'Show only files you own', {
          // Refused rather than left pressable when there is nothing to own
          // against: ticked, it would narrow to nothing and call that the
          // answer. The note says which of the two reasons it is.
          disabled: !ownership.available,
          ...(ownership.note === null ? {} : { note: ownership.note }),
        }),
      ],
    },
    // The order lives here because this is where the reviewer is already
    // shaping the list. But it hides nothing, so it has its own heading, does
    // not turn the funnel on, and is left alone by "Show all files". It sits
    // above the kinds and types, whose lists can be long, so it never needs
    // scrolling to.
    ...(onOrder === undefined
      ? []
      : [
          {
            id: 'sort',
            label: 'Sort',
            items: [
              {
                id: 'sort:changes',
                label: 'Most changed first',
                checked: order === 'changes',
                keepOpen: true,
                onSelect: () => onOrder(order === 'changes' ? 'folders' : 'changes'),
              },
            ],
          } satisfies MenuGroup,
        ]),
    {
      id: 'kinds',
      label: 'Change type',
      items: [...facets.kinds].map(
        ([kind, count]): MenuItem => ({
          id: `kind:${kind}`,
          label: KIND_LABELS[kind],
          detail: `${count}`,
          checked: !filters.hiddenKinds.has(kind),
          keepOpen: true,
          onSelect: () => onChange({ ...filters, hiddenKinds: flipped(filters.hiddenKinds, kind) }),
        }),
      ),
    },
    {
      id: 'types',
      label: 'File type',
      hint: `${MOD_LABEL}-click to show only the ones you pick`,
      items: [
        {
          id: 'types:all',
          label: 'Show all types',
          // Every type, and only the types: the other filters stay as they
          // were, which is the difference from "Show all files" at the foot.
          // Kept open, because a reviewer resetting the types is usually about
          // to pick some again.
          keepOpen: true,
          onSelect: () => onChange({ ...filters, hiddenTypes: new Set(), onlyTypes: null }),
          ...(everyTypeShown ? { disabled: true, title: 'Every type is shown.' } : {}),
        },
      ],
      // Under what sort of file each type is, so `.woff2` is found under
      // Fonts rather than by reading thirty rows. `.spec.tsx` stays under
      // `.tsx`, which is where its category comes from.
      subgroups: byCategory(facets.types.keys()).map((group) => {
        const state = typesShown(filters, group.types);
        return {
          id: `types:${group.category}`,
          label: CATEGORY_LABELS[group.category],
          // The heading is a box for the whole category: ticked when every type
          // in it is shown, partly when some are. A press shows them all, or
          // hides them all when they all show already; a Ctrl-press shows only
          // this category, as it shows only one type on a type's row.
          header: {
            id: `types:${group.category}:all`,
            label: CATEGORY_LABELS[group.category],
            checked: state === 'all' ? true : state === 'none' ? false : 'mixed',
            keepOpen: true,
            onSelect: ({ mod }) => {
              if (!mod) {
                onChange(withTypesShown(filters, group.types, state !== 'all'));
                return;
              }
              const extend = run.current;
              run.current = true;
              onChange(showOnly(filters, group.types, extend));
            },
          },
          items: group.types.map((type): MenuItem => {
            const parent = parentType(type);
            // Hiding `.tsx` hides the specs too, so `.spec.tsx` cannot be shown
            // while it is. Drawn unticked and refused rather than left ticked
            // over files that are not on screen, with the reason in its title.
            const hiddenAbove = parent !== null && filters.hiddenTypes.has(parent);
            return {
              id: `type:${type}`,
              label: typeLabel(type),
              detail: `${facets.types.get(type) ?? 0}`,
              checked: typeShown(filters, type),
              indent: parent !== null,
              keepOpen: true,
              ...(hiddenAbove ? { disabled: true, title: `Hidden along with ${parent}.` } : {}),
              onSelect: ({ mod }) => {
                if (!mod) {
                  onChange(toggleType(filters, type));
                  return;
                }
                // The first Ctrl-click of a run shows this type alone; the
                // rest of the run, until Ctrl is let go, add to it.
                const extend = run.current;
                run.current = true;
                onChange(onlyType(filters, type, extend));
              },
            };
          }),
        };
      }),
    },
    // The same types again, to send to the end of the review rather than out
    // of it. Each tick puts its type after every type already there, so the
    // order they were ticked in is the order they are read in.
    ...(onLast === undefined
      ? []
      : [
          {
            id: 'last',
            label: 'Read last',
            items: [],
            subgroups: byCategory(facets.types.keys()).map((group) => {
              const sent = group.types.filter((type) => last.includes(type)).length;
              return {
                id: `last:${group.category}`,
                label: CATEGORY_LABELS[group.category],
                // Every type in the category sent to the end at once, in the
                // order they are listed, or all of them taken back once they
                // are all there.
                header: {
                  id: `last:${group.category}:all`,
                  label: CATEGORY_LABELS[group.category],
                  ariaLabel: lastCategoryName(group.category),
                  checked: sent === group.types.length ? true : sent === 0 ? false : 'mixed',
                  keepOpen: true,
                  onSelect: () =>
                    onLast(
                      sent === group.types.length
                        ? last.filter((type) => !group.types.includes(type))
                        : [...last, ...group.types.filter((type) => !last.includes(type))],
                    ),
                },
                items: group.types.map(
                  (type): MenuItem => ({
                    id: `last:${type}`,
                    label: typeLabel(type),
                    ariaLabel: lastName(type),
                    detail: `${facets.types.get(type) ?? 0}`,
                    checked: last.includes(type),
                    indent: parentType(type) !== null,
                    keepOpen: true,
                    onSelect: () =>
                      onLast(
                        last.includes(type) ? last.filter((each) => each !== type) : [...last, type],
                      ),
                  }),
                ),
              };
            }),
          } satisfies MenuGroup,
        ]),
    {
      id: 'reset',
      items: [
        {
          id: 'show-all',
          label: 'Show all files',
          // Everything, including a type unticked on another scope that this
          // list does not have: "all" should not leave a choice lying in wait
          // for the next commit the reviewer opens.
          onSelect: () => onChange(NO_FILTERS),
          disabled: !active,
          title: active ? undefined : 'Nothing is filtered.',
        },
      ],
    },
  ];

  return (
    <MenuButton
      ref={ref}
      label="File filters"
      groups={groups}
      icon={
        <>
          <Funnel solid={active} />
          {/* The mark a reviewer is looking for. A funnel that fills in is
              a state you see only if you already know to look for it. A blue
              dot on the corner is how GitHub shows that something is on, and
              it can be read at a glance. The line under the box still says how
              many files are left. Hidden from a screen reader, which already
              gets the same fact from `description`. */}
          {active && <span className="filter-dot" aria-hidden="true" />}
        </>
      }
      active={active}
      // The solid funnel's words, for a reader who cannot see it fill.
      description={active ? 'A filter is on' : undefined}
      className="filter-menu-host"
      // The rail clips everything inside it, and the longest row here is
      // wider than the rail is allowed to be dragged down to.
      placement="escape"
      onOpenChange={(open) => {
        if (!open) run.current = false;
        onOpenChange?.(open);
      }}
    />
  );
}
