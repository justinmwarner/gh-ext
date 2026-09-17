/**
 * Jumping to a file by name.
 *
 * `Mod+K`, and only `Mod+K`. This used to be two modes of one panel, with `/`
 * opening it against the diff — that half is now `ui/FindPanel.tsx`, a panel in
 * the rail that stays open while its results are walked. The split is the one
 * VS Code makes between quick-open and find-in-files, and it is a split about
 * what the reviewer is doing rather than about what is being searched: this one
 * *finds one thing*. It ranks candidates, jumps to the best and closes, which
 * is the right shape for "take me to the file I am thinking of" and the wrong
 * shape for "show me everywhere this appears".
 *
 * The file tree's own filter is a third thing again: it *narrows*, staying on
 * and keeping the tree's order while the reviewer works down what is left. All
 * three ask `lib/review/search` what counts as a match, so a query that finds a
 * file in one finds it in the others.
 *
 * Everything matched is already in the page — `filterPaths` is a pure function
 * over paths the payload already carried. Nothing here asks GitHub anything, so
 * results appear as fast as they are typed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalFocus } from './useModalFocus';
import { filterPaths } from '@/lib/review/search';
import type { ReviewFile } from './reviewFiles';

/** Where a chosen result sends the reviewer. */
export interface SearchTarget {
  path: string;
  /** Null for a whole-file result, which has no particular line. */
  side: 'additions' | 'deletions' | null;
  line: number | null;
}

export interface SearchPanelProps {
  files: readonly ReviewFile[];
  onChoose: (target: SearchTarget) => void;
  onClose: () => void;
}

const TITLE = 'Jump to a file';
const PLACEHOLDER = 'File name…';

/** How many results to build. Beyond this nobody is reading, they are retyping. */
const LIMIT = 100;

/** One row's text with the matched span marked. */
function Highlighted({
  text,
  start,
  end,
}: {
  text: string;
  start: number;
  end: number;
}) {
  if (end <= start) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

interface Row {
  key: string;
  target: SearchTarget;
  path: string;
  start: number;
  end: number;
}

export function SearchPanel({ files, onChoose, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const paths = useMemo(() => files.map((file) => file.path), [files]);

  const rows = useMemo(
    (): Row[] =>
      filterPaths(paths, query, { limit: LIMIT }).map((match) => ({
        key: match.path,
        target: { path: match.path, side: null, line: null },
        path: match.path,
        start: match.start,
        end: match.end,
      })),
    [paths, query],
  );

  // A new query is a new list, and the old highlight would be pointing at a
  // row that is no longer there.
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Trap Tab inside the dialog, and hand the keyboard back on close.
  useModalFocus(panel);

  const choose = (row: Row | undefined): void => {
    if (row === undefined) return;
    onChoose(row.target);
    onClose();
  };

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        className="overlay search-panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={TITLE}
        onClick={(event) => event.stopPropagation()}
        // On the panel rather than on the input, so Escape still closes once
        // Tab has moved into the results — they are real buttons, and from one
        // of them a handler bound to the input never sees the key. It reaches
        // `document`, matches nothing in the keymap, and is dropped, leaving a
        // dialog the keyboard cannot leave. Every other overlay binds here.
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          // The page behind is still listening; a modal's Escape is its own.
          event.stopPropagation();
          onClose();
        }}
      >
        <input
          ref={input}
          type="search"
          className="search-input"
          aria-label={TITLE}
          placeholder={PLACEHOLDER}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((at) => Math.min(at + 1, rows.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((at) => Math.max(at - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(rows[active]);
            }
          }}
        />

        {rows.length === 0 ? (
          <p className="search-empty" role="status">
            {query.trim() === '' ? 'Type to filter the changed files.' : 'No matches.'}
          </p>
        ) : (
          <ul className="search-results" aria-label="Results">
            {rows.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  className={index === active ? 'search-result active' : 'search-result'}
                  onClick={() => choose(row)}
                >
                  <span className="search-result-path">
                    <Highlighted text={row.path} start={row.start} end={row.end} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
