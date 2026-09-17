/**
 * Finding something in the review, in the rail rather than over it.
 *
 * This replaced a modal, and the reason is what a modal cannot do: stay. The
 * old panel ranked candidates, sent the reviewer to the best one and closed,
 * which is the right shape for "take me to the file I am thinking of" — that is
 * `Mod+K`, and it is still a modal — and the wrong shape for the other question
 * a reviewer asks a diff, which is *where does this appear, and let me walk all
 * of them.* A list that closes on the first answer cannot answer the second.
 *
 * So it lives where the file tree lives and swaps with it. Three consequences
 * worth stating:
 *
 * - **Moving is arriving.** Arrowing onto a result scrolls the diff and leaves
 *   the keyboard here, because `goToLine` only scrolls. Walking twenty hits is
 *   twenty presses of one key, with the code moving underneath.
 * - **The query and the toggles are held above**, in `FilesView`, so switching
 *   to the file tree and back does not silently reset a search. Only the folds
 *   are local, because they are about a result list that no longer exists once
 *   the query changes.
 * - **It searches context too.** The diff search deliberately does not — a hit
 *   on a line nobody touched is not a change — but a reviewer arriving from an
 *   editor expects find-in-files to find what is in the files, and a panel that
 *   quietly declined half of them would read as broken rather than as focused.
 *
 * Everything matched is already in the page. Nothing here asks GitHub anything.
 */

import { type KeyboardEvent, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  type MatchOptions,
  compileMatcher,
  parseFiles,
  searchParsed,
} from '@/lib/review/search';
import { SearchTree, type SearchTreeHandle } from './SearchTree';
import type { ReviewFile } from './reviewFiles';
import { type SearchRow, searchRows } from './searchRows';

/**
 * How many matches to build.
 *
 * Twenty times what the modal collected, because that number was sized for a
 * list nobody scrolls and this is a tree the reviewer walks. Past this the
 * panel says it is showing a prefix rather than presenting one as the whole
 * answer.
 */
const LIMIT = 2000;

/** The query and what the three toggles are doing. Owned by the caller. */
export interface FindState extends MatchOptions {
  query: string;
}

export const DEFAULT_FIND: FindState = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** Where a chosen result sends the reviewer. */
export interface FindTarget {
  path: string;
  side: 'additions' | 'deletions' | null;
  /** Null for a whole-file result, which has no particular line. */
  line: number | null;
  /** Take the keyboard to the diff, rather than leaving it in the panel. */
  focusDiff: boolean;
}

export interface FindPanelHandle {
  /** Put the cursor in the box and select what is in it, for a second `Mod+F`. */
  focusQuery(): void;
}

export interface FindPanelProps {
  files: readonly ReviewFile[];
  state: FindState;
  onState: (next: FindState) => void;
  onGoTo: (target: FindTarget) => void;
  /** Escape on an already-empty query. Hands the rail back to the file tree. */
  onClose: () => void;
  ref?: React.Ref<FindPanelHandle>;
}

/** No folds, shared so a new result list does not allocate one per keystroke. */
const NOTHING_FOLDED: ReadonlySet<string> = new Set();

/** The three toggles, as the row of buttons draws them. */
const TOGGLES = [
  { key: 'caseSensitive', label: 'Match case', glyph: 'Aa' },
  { key: 'wholeWord', label: 'Whole word', glyph: 'ab' },
  { key: 'regex', label: 'Use regular expression', glyph: '.*' },
] as const;

/**
 * What was found, in words.
 *
 * It exists for the reason the file tree's narrowing line exists: a panel
 * quietly showing a prefix of the truth is worse than one that says so. The
 * four states are the four things that can be true — nothing typed, a pattern
 * that will not compile, nothing found, and a count that may be capped.
 */
function summarise(
  query: string,
  error: string | null,
  matches: number,
  files: number,
  capped: boolean,
): string {
  if (query.trim() === '') return '';
  if (error !== null) return `Invalid pattern: ${error}`;
  if (matches === 0) return 'No results';

  const plural = files === 1 ? 'file' : 'files';
  return capped
    ? `First ${matches} results in ${files} ${plural}`
    : `${matches} ${matches === 1 ? 'result' : 'results'} in ${files} ${plural}`;
}

export function FindPanel({
  files,
  state,
  onState,
  onGoTo,
  onClose,
  ref,
}: FindPanelProps) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(NOTHING_FOLDED);
  const input = useRef<HTMLInputElement>(null);
  const tree = useRef<SearchTreeHandle>(null);

  useImperativeHandle(
    ref,
    (): FindPanelHandle => ({
      focusQuery() {
        input.current?.focus();
        // Selected rather than merely focused: a second `Mod+F` almost always
        // means a new search, and leaving the caret at the end would make the
        // reviewer clear the box by hand first.
        input.current?.select();
      },
    }),
    [],
  );

  /**
   * The patches, walked once.
   *
   * Against `files` rather than against the query, which is the whole reason
   * this is split from the sweep: with context lines in scope the corpus is
   * several times what the diff search used to look at, and re-walking it on
   * every keystroke would spend the speed budget PRODUCT.md sets.
   */
  const parsed = useMemo(() => parseFiles(files), [files]);

  const matcher = useMemo(
    () =>
      compileMatcher(state.query, {
        caseSensitive: state.caseSensitive,
        wholeWord: state.wholeWord,
        regex: state.regex,
      }),
    [state.query, state.caseSensitive, state.wholeWord, state.regex],
  );

  const matches = useMemo(
    () => searchParsed(parsed, matcher, { includeContext: true, limit: LIMIT }),
    [parsed, matcher],
  );

  const rows = useMemo(() => searchRows(matches, folded), [matches, folded]);

  const matchedFiles = useMemo(
    () => new Set(matches.map((match) => match.path)).size,
    [matches],
  );

  const said = summarise(
    state.query,
    matcher.ok ? null : matcher.error,
    matches.length,
    matchedFiles,
    matches.length >= LIMIT,
  );

  const set = (patch: Partial<FindState>): void => onState({ ...state, ...patch });

  const fold = (path: string, shut: boolean): void => {
    setFolded((open) => {
      const next = new Set(open);
      if (shut) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  /** Where a row sends the diff. A file row goes to the file and no line. */
  const targetFor = (row: SearchRow, focusDiff: boolean): FindTarget | null => {
    if (row.kind === 'directory') return null;
    if (row.kind === 'file') return { path: row.path, side: null, line: null, focusDiff };
    return {
      path: row.path,
      side: row.match.side,
      line: row.match.line,
      focusDiff,
    };
  };

  const reveal = (row: SearchRow): void => {
    const target = targetFor(row, false);
    if (target !== null) onGoTo(target);
  };

  const commit = (row: SearchRow): void => {
    const target = targetFor(row, true);
    if (target !== null) onGoTo(target);
  };

  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      // Clear first, close second. The same two-step the file tree's filter
      // does, so the two boxes in this rail answer the key the same way.
      if (state.query !== '') set({ query: '' });
      else onClose();
    } else if (event.key === 'ArrowDown') {
      // Straight into what was found, without reaching for the mouse. The tree
      // does the focusing: which element carries which row is its business.
      if (rows.length === 0) return;
      tree.current?.focusFirst();
    } else return;

    event.preventDefault();
    // A modal's Escape is its own; the page behind is still listening.
    event.stopPropagation();
  };

  return (
    <>
      <div className="filetree-filter">
        <div className="find-box">
          <input
            ref={input}
            type="search"
            className="filetree-search find-input"
            aria-label="Search the diff"
            placeholder="Search the diff…"
            value={state.query}
            onChange={(event) => set({ query: event.target.value })}
            onKeyDown={onQueryKeyDown}
          />

          <div className="find-toggles">
            {TOGGLES.map((toggle) => (
              <button
                key={toggle.key}
                type="button"
                className="find-toggle"
                aria-label={toggle.label}
                aria-pressed={state[toggle.key] === true}
                title={toggle.label}
                onClick={() => set({ [toggle.key]: state[toggle.key] !== true })}
              >
                {/* Text rather than a drawing, for three glyphs that are
                    already legible as text and that every editor draws the
                    same way. `aria-hidden` because the button is named by its
                    label — "Aa" read aloud is not a control. */}
                <span aria-hidden="true">{toggle.glyph}</span>
              </button>
            ))}
          </div>
        </div>

        {said !== '' && (
          /* Rendered only when it has something to say, like the file tree's
             count. A live region that is permanently present and permanently
             empty is furniture, and says nothing to a reviewer either. */
          <p className="filetree-count" role="status">
            {said}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="search-empty">
          {state.query.trim() === ''
            ? 'Type to search paths, changed lines and the code around them.'
            : ''}
        </p>
      ) : (
        <SearchTree
          ref={tree}
          rows={rows}
          onFold={fold}
          onReveal={reveal}
          onCommit={commit}
        />
      )}
    </>
  );
}
