/**
 * The left column's file tree.
 *
 * Ours, and the reason is the checkbox. A file tree in a review is a checklist
 * — the reviewer works down it ticking things off — and the previous library
 * rendered each row as a `<button>` with a single inert decoration slot, so a
 * checkbox was not something it could be asked for. Six workarounds had
 * accumulated around that one fact: a refresh driven by re-setting the icons
 * because there was no `refresh()`, clicks matched on glyph text and stopped in
 * the capture phase, hover handlers writing a `title` into someone else's
 * shadow DOM. All of that is gone.
 *
 * **`aria-checked` on the row, not a nested `<input>`.** A `treeitem` must not
 * contain focusable content — the same constraint the library was up against —
 * but ARIA answers it directly rather than by exclusion: a checkable tree item
 * carries its own state, `mixed` included, and Space toggles it. The visible
 * box is an `aria-hidden` span, so pointer users click a box and keyboard users
 * press a key, and neither is a second tab stop on every row.
 *
 * **No virtualization, deliberately.** `content-visibility: auto` in the
 * stylesheet lets the browser skip layout and paint for rows that are off
 * screen, which is the whole of what a virtualized list buys and none of what
 * it costs — no measured heights, no scroll anchoring, no rows that exist for
 * the reviewer but not for `Ctrl+F`.
 *
 * Structure, order, and what a folder's checkbox acts on are all in
 * `treeRows`. What is here is only how a row is drawn and which key does what.
 */

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileViewedState, PatchStatus } from '@/lib/github/types';
import { type CurrentFile, shouldSelectInTree } from './currentFile';
import type { FileComments } from './fileTreeData';
import type { ReviewFile } from './reviewFiles';
import { type TreeRow, checkState, treeRows } from './treeRows';

/** U+2212 MINUS SIGN, which is what GitHub uses and what aligns with `+`. */
const MINUS = '−';

/**
 * Linguist's own colours, for the dot that stands in for a file-type icon.
 *
 * A dozen values rather than a vendored icon set: the row already carries a
 * checkbox, a name, two counts and a conversation mark, and a second detailed
 * glyph on top of that is noise rather than information. Anything not listed
 * falls back to the muted foreground, which is the honest answer for a file
 * type we have nothing to say about.
 */
const LANGUAGE: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f1e05a',
  jsx: '#f1e05a',
  json: '#cbcb41',
  md: '#519aba',
  css: '#563d7c',
  scss: '#c6538c',
  html: '#e34c26',
  py: '#3572a5',
  go: '#00add8',
  rs: '#dea584',
  rb: '#701516',
  java: '#b07219',
  sh: '#89e051',
  yml: '#cb171e',
  yaml: '#cb171e',
  svg: '#ff9900',
  png: '#a074c4',
  jpg: '#a074c4',
  gif: '#a074c4',
};

const languageColour = (name: string): string | undefined =>
  LANGUAGE[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];

/**
 * A copy is a new file at its destination, so it reads as `added`; `CHANGED` is
 * GitHub's word for a content change it declined to classify further, which is
 * `modified`. Everything else maps across by name.
 */
const STATUS: Record<PatchStatus, string> = {
  ADDED: 'added',
  DELETED: 'deleted',
  RENAMED: 'renamed',
  COPIED: 'added',
  MODIFIED: 'modified',
  CHANGED: 'modified',
};

/** The directory a path sits in, or null at the top level. */
function parentOf(path: string): string | null {
  const body = path.endsWith('/') ? path.slice(0, -1) : path;
  const cut = body.lastIndexOf('/');
  return cut === -1 ? null : body.slice(0, cut + 1);
}

export interface FileTreeProps {
  files: readonly ReviewFile[];
  /** How much conversation each file is carrying, by path. */
  comments?: ReadonlyMap<string, FileComments>;
  /**
   * Viewed state per path as the session holds it, which is ahead of the
   * payload for as long as an optimistic toggle is in flight. Falls back to
   * what the file itself arrived with.
   */
  viewed?: ReadonlyMap<string, FileViewedState>;
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  /** The reviewer selected or arrow-keyed onto a file. */
  onSelect: (path: string) => void;
  /**
   * Mark these files viewed, or unmark them. One path for a file's own box,
   * every file beneath it for a folder's.
   */
  onSetViewed?: (paths: readonly string[], next: boolean) => void;
}

export function FileTree({
  files,
  comments,
  viewed,
  current,
  onSelect,
  onSetViewed,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const rows = useMemo(() => treeRows(paths, collapsed), [paths, collapsed]);
  const byPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );

  /** The session's answer where it has one, and the payload's everywhere else. */
  const states = useMemo(() => {
    const merged = new Map<string, FileViewedState>();
    for (const file of files) {
      merged.set(file.path, viewed?.get(file.path) ?? file.viewedState);
    }
    return merged;
  }, [files, viewed]);

  /**
   * Open whatever is folded over the file the review is on.
   *
   * The column can be scrolled anywhere, including into a file inside a folder
   * the reviewer closed. A tree that left it hidden would be pointing at
   * nothing while claiming to follow along.
   */
  const currentPath = current.path;
  useEffect(() => {
    if (currentPath === null) return;
    setCollapsed((open) => {
      let next: Set<string> | null = null;
      let prefix = '';
      for (const segment of currentPath.split('/').slice(0, -1)) {
        prefix += `${segment}/`;
        if (open.has(prefix)) {
          next ??= new Set(open);
          next.delete(prefix);
        }
      }
      return next ?? open;
    });
  }, [currentPath]);

  /**
   * Follow the diff column, and only the diff column.
   *
   * `scrollIntoView` rather than `focus()`: the reviewer is reading the diff,
   * and taking DOM focus would take their keyboard with it.
   */
  const follows = shouldSelectInTree(current);
  useEffect(() => {
    if (!follows || currentPath === null) return;
    setFocused(currentPath);
    elements.current.get(currentPath)?.scrollIntoView({ block: 'nearest' });
  }, [follows, currentPath]);

  // Exactly one row is in the tab order. The focused one, unless it has been
  // folded away or the file list changed underneath it.
  const tabbable =
    rows.find((row) => row.path === focused)?.path ?? rows[0]?.path ?? null;

  const move = useCallback(
    (to: TreeRow | undefined) => {
      if (to === undefined) return;
      setFocused(to.path);
      elements.current.get(to.path)?.focus();
      // Directories have no diff card. Reporting one would ask the column to
      // scroll to something that does not exist.
      if (to.kind === 'file') onSelect(to.path);
    },
    [onSelect],
  );

  const fold = useCallback((path: string, shut: boolean) => {
    setCollapsed((open) => {
      const next = new Set(open);
      if (shut) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const toggleViewed = useCallback(
    (row: TreeRow) => {
      const targets = row.kind === 'file' ? [row.path] : row.files;
      if (targets.length === 0) return;
      // A part-viewed folder reads as mixed, and the useful thing to do to one
      // is finish it rather than undo it — so only a fully ticked row unticks.
      onSetViewed?.(targets, checkState(row, states) !== 'checked');
    },
    [onSetViewed, states],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const element = (event.target as HTMLElement).closest('[data-path]');
    const path = element?.getAttribute('data-path');
    if (path === null || path === undefined) return;
    const index = rows.findIndex((row) => row.path === path);
    const row = rows[index];
    if (row === undefined) return;

    const key = event.key;
    if (key === 'ArrowDown') move(rows[index + 1]);
    else if (key === 'ArrowUp') move(rows[index - 1]);
    else if (key === 'Home') move(rows[0]);
    else if (key === 'End') move(rows[rows.length - 1]);
    else if (key === 'ArrowRight') {
      if (row.kind === 'directory' && !row.expanded) fold(row.path, false);
      else if (row.kind === 'directory') move(rows[index + 1]);
      else return;
    } else if (key === 'ArrowLeft') {
      if (row.kind === 'directory' && row.expanded) fold(row.path, true);
      else {
        const parent = parentOf(row.path);
        if (parent === null) return;
        move(rows.find((candidate) => candidate.path === parent));
      }
    } else if (key === ' ') toggleViewed(row);
    else if (key === 'Enter') {
      if (row.kind === 'directory') fold(row.path, row.expanded);
      else onSelect(row.path);
    } else return;

    event.preventDefault();
  };

  if (files.length === 0) {
    return <p className="placeholder">No changed files.</p>;
  }

  return (
    <div className="filetree-rows" role="tree" aria-label="Changed files" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const file = byPath.get(row.path);
        const state = checkState(row, states);
        const talk = row.kind === 'file' ? comments?.get(row.path) : undefined;

        return (
          <div
            key={row.path}
            ref={(node) => {
              if (node === null) elements.current.delete(row.path);
              else elements.current.set(row.path, node);
            }}
            className="tree-row"
            role="treeitem"
            data-path={row.path}
            data-status={file === undefined ? undefined : STATUS[file.changeType]}
            data-noise={file?.noise === true ? 'true' : undefined}
            // The name is the basename, which is all a narrow column fits. The
            // path is what says which of four `index.ts` this one is.
            title={row.path.endsWith('/') ? row.path.slice(0, -1) : row.path}
            aria-level={row.depth + 1}
            aria-selected={row.path === current.path}
            aria-checked={state === 'mixed' ? 'mixed' : state === 'checked'}
            aria-expanded={row.kind === 'directory' ? row.expanded : undefined}
            tabIndex={row.path === tabbable ? 0 : -1}
            style={{ paddingLeft: `${row.depth * 14 + 4}px` }}
            onClick={() => {
              setFocused(row.path);
              if (row.kind === 'directory') fold(row.path, row.expanded);
              else onSelect(row.path);
            }}
          >
            <span
              className="tree-check"
              data-check={state}
              aria-hidden="true"
              onClick={(event) => {
                // The row selects; the box does not. A tick that also navigated
                // would move the diff column out from under the reviewer every
                // time they ticked something off.
                event.stopPropagation();
                setFocused(row.path);
                toggleViewed(row);
              }}
            />

            {row.kind === 'directory' ? (
              <span className="tree-chevron" aria-hidden="true">
                {row.expanded ? '▾' : '▸'}
              </span>
            ) : (
              <span
                className="tree-dot"
                aria-hidden="true"
                style={{ background: languageColour(row.name) }}
              />
            )}

            <span className="tree-name">{row.name}</span>

            {talk !== undefined && talk.total > 0 && (
              <span
                className="tree-comment"
                data-tone={talk.unresolved > 0 ? 'open' : 'resolved'}
                title={
                  talk.unresolved > 0
                    ? `${talk.unresolved} unresolved ${talk.unresolved === 1 ? 'comment' : 'comments'}`
                    : `${talk.total} ${talk.total === 1 ? 'comment' : 'comments'}, all resolved`
                }
                aria-hidden="true"
              />
            )}

            {file !== undefined && (
              <span className="tree-status" aria-hidden="true">
                {STATUS[file.changeType].charAt(0).toUpperCase()}
              </span>
            )}

            {file !== undefined && (
              <span className="tree-counts">
                <span className="additions">{`+${file.additions}`}</span>
                <span className="deletions">{`${MINUS}${file.deletions}`}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
