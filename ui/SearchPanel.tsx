/**
 * Finding something in the review, in one panel with two questions.
 *
 * `/` searches inside the diff — file paths and changed lines — and `Mod+K`
 * filters the file list. They are the same mechanism deliberately: the same
 * box, the same list, the same highlight, the same keys. The file tree runs
 * with its own search off (§16.5) so single-letter shortcuts survive, which is
 * why the file jump lives here rather than in the tree.
 *
 * Everything matched is already in the page: `searchDiff` and `filterPaths` are
 * pure functions over the parsed patch. Nothing here asks GitHub anything, so
 * results appear as fast as they are typed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { type DiffMatch, filterPaths, searchDiff } from '@/lib/review/search';
import type { ReviewFile } from './reviewFiles';

export type SearchMode = 'diff' | 'files';

/** Where a chosen result sends the reviewer. */
export interface SearchTarget {
  path: string;
  /** Null for a whole-file result, which has no particular line. */
  side: 'additions' | 'deletions' | null;
  line: number | null;
}

export interface SearchPanelProps {
  mode: SearchMode;
  files: readonly ReviewFile[];
  onChoose: (target: SearchTarget) => void;
  onClose: () => void;
}

const LABELS: Record<SearchMode, { title: string; placeholder: string }> = {
  diff: { title: 'Search the diff', placeholder: 'Paths and changed lines…' },
  files: { title: 'Jump to a file', placeholder: 'File name…' },
};

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
  /** The path, always shown: a line without its file is not a destination. */
  path: string;
  /** The line's text, or null for a whole-file result. */
  text: string | null;
  start: number;
  end: number;
  /** Where it sits, in words. Empty for a path result. */
  position: string;
}

const rowsForDiff = (matches: readonly DiffMatch[]): Row[] =>
  matches.map((match, index) => ({
    key: `${match.path}:${match.kind}:${match.line ?? 'path'}:${index}`,
    target: { path: match.path, side: match.side, line: match.line },
    path: match.path,
    text: match.kind === 'path' ? null : match.text,
    start: match.start,
    end: match.end,
    position:
      match.line === null
        ? ''
        : `${match.kind === 'addition' ? '+' : '−'}${match.line}`,
  }));

export function SearchPanel({ mode, files, onChoose, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const paths = useMemo(() => files.map((file) => file.path), [files]);

  const rows = useMemo((): Row[] => {
    if (mode === 'files') {
      return filterPaths(paths, query, { limit: LIMIT }).map((match) => ({
        key: match.path,
        target: { path: match.path, side: null, line: null },
        path: match.path,
        text: null,
        start: match.start,
        end: match.end,
        position: '',
      }));
    }
    return rowsForDiff(searchDiff(files, query, { limit: LIMIT }));
  }, [mode, files, paths, query]);

  // A new query is a new list, and the old highlight would be pointing at a
  // row that is no longer there.
  useEffect(() => {
    setActive(0);
  }, [query, mode]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const choose = (row: Row | undefined): void => {
    if (row === undefined) return;
    onChoose(row.target);
    onClose();
  };

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        className="overlay search-panel"
        role="dialog"
        aria-modal="true"
        aria-label={LABELS[mode].title}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={input}
          type="search"
          className="search-input"
          aria-label={LABELS[mode].title}
          placeholder={LABELS[mode].placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
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
            {query.trim() === ''
              ? 'Type to search the changed lines and paths.'
              : 'No matches.'}
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
                    {row.text === null ? (
                      <Highlighted text={row.path} start={row.start} end={row.end} />
                    ) : (
                      row.path
                    )}
                  </span>
                  {row.position !== '' && (
                    <span className="search-result-line">{row.position}</span>
                  )}
                  {row.text !== null && (
                    <code className="search-result-text">
                      <Highlighted text={row.text} start={row.start} end={row.end} />
                    </code>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
