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
 */

import type { Ref } from 'react';
import {
  type ChangeKind,
  DOTFILE,
  type FileFacets,
  type FileFilters,
  NO_EXTENSION,
  NO_FILTERS,
} from '@/lib/review/fileFilters';
import { MenuButton, type MenuButtonHandle, type MenuGroup, type MenuItem } from './MenuButton';

/** What the ownership row can offer, and what to say about it. */
export interface OwnershipNote {
  /** False when there is nothing to check against — no CODEOWNERS file. */
  available: boolean;
  /** A sentence for the row, or null for none. */
  note: string | null;
}

/** Nothing known yet and nothing to say, which is the state before it is asked. */
const UNASKED: OwnershipNote = { available: true, note: null };

const KIND_LABELS: Record<ChangeKind, string> = {
  added: 'Added',
  modified: 'Modified',
  renamed: 'Renamed',
  deleted: 'Deleted',
};

/** The two types that are not an extension get words; an extension is its own name. */
const typeLabel = (type: string): string =>
  type === DOTFILE ? 'Dotfiles' : type === NO_EXTENSION ? 'No extension' : type;

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
  ref?: Ref<MenuButtonHandle>;
}

export function FilterMenu({
  filters,
  facets,
  onChange,
  active,
  ownership = UNASKED,
  onOpenChange,
  ref,
}: FilterMenuProps) {
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
      items: [...facets.types].map(
        ([type, count]): MenuItem => ({
          id: `type:${type}`,
          label: typeLabel(type),
          detail: `${count}`,
          checked: !filters.hiddenTypes.has(type),
          keepOpen: true,
          onSelect: () => onChange({ ...filters, hiddenTypes: flipped(filters.hiddenTypes, type) }),
        }),
      ),
    },
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
      icon={<Funnel solid={active} />}
      active={active}
      // The solid funnel's words, for a reader who cannot see it fill.
      description={active ? 'A filter is on' : undefined}
      className="filter-menu-host"
      // The rail clips everything inside it, and the longest row here is
      // wider than the rail is allowed to be dragged down to.
      placement="escape"
      onOpenChange={onOpenChange}
    />
  );
}
