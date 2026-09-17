/**
 * The find panel's rows.
 *
 * The file tree's twin, and deliberately not the file tree. That one is a
 * checklist — tick boxes, viewed state, conversation marks, `+`/`−` counts —
 * and none of it belongs on a result. What the two do share is everything a
 * reviewer's eye and hand have already learned: the same indent, the same
 * chevron, the same icon slot, the same name, and the same six navigation keys,
 * which come from `treeKeys` rather than from a second copy of that logic.
 *
 * **A match is a row, not a decoration.** A file with nine hits is nine places
 * the reviewer can be sent, and stepping through them with the arrow keys while
 * the diff follows is the thing the whole panel exists to do.
 *
 * **Moving is arriving.** `ArrowDown` onto a row reports it, which scrolls the
 * diff without taking the keyboard — a `LineJump` only scrolls, which is what
 * makes this possible and what a modal over the diff could never offer.
 * `Enter` is the one that hands focus over, for a reviewer who has found the
 * line and wants to read around it.
 */

import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { STATUS_MARKS } from '@/lib/compare/archive';
import type { DiffMatch, Span } from '@/lib/review/search';
import type { SearchRow } from './searchRows';
import { type KeyRow, claimsTreeKey, resolveTreeKey } from './treeKeys';
import { useFileIcons } from './useFileIcons';

/** U+2212 MINUS SIGN, which is what the counts elsewhere on this rail use. */
const MINUS = '−';

/** One row's text with the matched run marked. */
function Highlighted({ text, span }: { text: string; span: Span | null }) {
  if (span === null || span.end <= span.start) return <>{text}</>;
  return (
    <>
      {text.slice(0, span.start)}
      <mark>{text.slice(span.start, span.end)}</mark>
      {text.slice(span.end)}
    </>
  );
}

/**
 * Where a match sits, as the gutter says it.
 *
 * Signed for a changed line and bare for context, because "did the author
 * touch this line" is the first thing a reviewer needs from a result — and
 * with context in scope it is a difference this panel has to draw.
 *
 * An archive member has no line to report, so the slot carries what happened
 * to it instead, in the character the archive card already uses for it. Same
 * column, same question answered: *is this one of the things that moved?*
 */
function position(match: DiffMatch): string {
  if (match.kind === 'entry') {
    return STATUS_MARKS[match.status as keyof typeof STATUS_MARKS] ?? '';
  }
  if (match.line === null) return '';
  if (match.kind === 'addition') return `+${match.line}`;
  if (match.kind === 'deletion') return `${MINUS}${match.line}`;
  return `${match.line}`;
}

/**
 * Where the query hit the *name*, given where it hit the path.
 *
 * The row draws the basename, and `nameMatch` is an offset into the whole path,
 * so a hit that fell in a directory has no span here — which is correct. It did
 * not match the part being drawn.
 */
function nameSpan(row: Extract<SearchRow, { kind: 'file' }>): Span | null {
  if (row.nameMatch === null) return null;
  const from = row.path.length - row.name.length;
  if (row.nameMatch.start < from) return null;
  return { start: row.nameMatch.start - from, end: row.nameMatch.end - from };
}

/** The row holding this one: the nearest thing above it that is not a match. */
function holderAbove(rows: readonly SearchRow[], index: number): SearchRow | undefined {
  for (let at = index - 1; at >= 0; at -= 1) {
    const above = rows[at];
    if (above !== undefined && above.kind !== 'match') return above;
  }
  return undefined;
}

export interface SearchTreeHandle {
  /**
   * Put the keyboard on the first row, and reveal it.
   *
   * What `ArrowDown` out of the query box calls. A handle rather than the panel
   * reaching into the DOM for a row: which element carries which row is this
   * component's business, and a `querySelector` up there would break the first
   * time a key needed escaping.
   */
  focusFirst(): void;
}

export interface SearchTreeProps {
  rows: readonly SearchRow[];
  /** Fold a file or a directory away, or open it again. */
  onFold: (path: string, shut: boolean) => void;
  /**
   * The reviewer moved onto a row.
   *
   * Called for a keyboard move as readily as for a click, which is what makes
   * the diff follow the arrow keys. Focus is not touched.
   */
  onReveal: (row: SearchRow) => void;
  /** The reviewer chose a row and wants the diff's keyboard with it. */
  onCommit: (row: SearchRow) => void;
  ref?: Ref<SearchTreeHandle>;
}

export function SearchTree({ rows, onFold, onReveal, onCommit, ref }: SearchTreeProps) {
  const [focused, setFocused] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const icons = useFileIcons();

  /**
   * The rows as the keyboard sees them.
   *
   * A match row is handed its own key as its path, so that no two leaves share
   * one and `Home`/`End`/`Arrow` stepping is unambiguous. Its `ArrowLeft` is
   * answered below rather than here, because its holder is a file rather than
   * anything `parentOf` could find in a path.
   */
  const keyRows = useMemo(
    (): KeyRow[] =>
      rows.map((row) => ({
        path: row.kind === 'match' ? row.key : row.path,
        depth: row.depth,
        kind: row.kind === 'match' ? 'file' : row.kind,
        expanded: row.kind === 'match' ? false : row.expanded,
      })),
    [rows],
  );

  // A new query is a new list, and a focus key from the old one points nowhere.
  useEffect(() => {
    if (focused !== null && !rows.some((row) => row.key === focused)) setFocused(null);
  }, [rows, focused]);

  const move = useCallback(
    (to: SearchRow | undefined) => {
      if (to === undefined) return;
      setFocused(to.key);
      elements.current.get(to.key)?.focus();
      onReveal(to);
    },
    [onReveal],
  );

  useImperativeHandle(ref, (): SearchTreeHandle => ({ focusFirst: () => move(rows[0]) }), [
    move,
    rows,
  ]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const element = (event.target as HTMLElement).closest('[data-key]');
    const key = element?.getAttribute('data-key');
    if (key === null || key === undefined) return;
    const index = rows.findIndex((row) => row.key === key);
    const row = rows[index];
    if (row === undefined) return;

    if (claimsTreeKey(event.key)) {
      event.preventDefault();

      if (event.key === 'ArrowLeft' && row.kind === 'match') {
        move(holderAbove(rows, index));
        return;
      }

      const action = resolveTreeKey(keyRows, index, event.key);
      if (action?.kind === 'move') move(rows[action.index]);
      else if (action?.kind === 'fold') onFold(action.path, action.shut);
      return;
    }

    if (event.key === 'Enter') {
      if (row.kind === 'match') onCommit(row);
      else onFold(row.path, row.expanded);
    } else return;

    event.preventDefault();
  };

  // Exactly one row is in the tab order, so Tab reaches past the tree rather
  // than walking every result in it. The rule the file tree follows.
  const tabbable = rows.find((row) => row.key === focused)?.key ?? rows[0]?.key ?? null;

  return (
    <div className="filetree-rows" role="tree" aria-label="Results" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const icon =
          row.kind === 'match' ? null : icons.urlFor(row.path, row.kind, row.expanded);

        return (
          <div
            key={row.key}
            ref={(node) => {
              if (node === null) elements.current.delete(row.key);
              else elements.current.set(row.key, node);
            }}
            className={row.kind === 'match' ? 'tree-row search-row' : 'tree-row'}
            role="treeitem"
            data-key={row.key}
            data-kind={row.kind === 'match' ? row.match.kind : undefined}
            // The whole line, which is what a clipped `<code>` cannot show and
            // what `getNodeText` cannot reassemble around a `<mark>`.
            title={row.kind === 'match' ? row.match.text : row.path.replace(/\/$/, '')}
            aria-level={row.depth + 1}
            aria-expanded={row.kind === 'match' ? undefined : row.expanded}
            tabIndex={row.key === tabbable ? 0 : -1}
            style={{ paddingLeft: `${row.depth * 14 + 4}px` }}
            onClick={() => {
              setFocused(row.key);
              // A file row goes to the file, the way clicking a file in the
              // checklist does. Only a directory folds on a plain click —
              // folding a *file* is the chevron's job, below, because a file
              // row is a destination first and a container second.
              if (row.kind === 'directory') onFold(row.path, row.expanded);
              else onReveal(row);
            }}
          >
            {row.kind === 'match' ? (
              <>
                <span className="search-row-line" aria-hidden="true">
                  {position(row.match)}
                </span>
                <code className="search-row-text">
                  <Highlighted
                    text={row.match.text}
                    span={{ start: row.match.start, end: row.match.end }}
                  />
                </code>
              </>
            ) : (
              <>
                {/* Empty, and drawn by `.tree-chevron::before` — the triangle
                    glyphs come out as specks in the fonts this page falls back
                    through. Present on files too, because it is also the
                    column that lines the icons up.

                    Here it is a target as well as a drawing, which is the one
                    thing it is not in the file tree: a result file holds rows
                    of its own, so it needs a twisty, and the row itself is
                    already spoken for by "take me there". `stopPropagation`
                    for the reason `.tree-check` does it — folding must not
                    also move the diff out from under the reviewer. */}
                <span
                  className="tree-chevron"
                  aria-hidden="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFocused(row.key);
                    onFold(row.path, row.expanded);
                  }}
                />

                <span className="tree-icon-slot" aria-hidden="true">
                  {icon !== null && (
                    <img
                      className="tree-icon"
                      src={icon}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  )}
                </span>

                <span className="tree-name">
                  {row.kind === 'file' ? (
                    <Highlighted text={row.name} span={nameSpan(row)} />
                  ) : (
                    row.name
                  )}
                </span>

                {/* The count, which a folded row keeps. Hiding the matches must
                    not make the number disagree with them, or the panel reads
                    as broken rather than as folded. */}
                <span className="search-row-count">{row.matches}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
