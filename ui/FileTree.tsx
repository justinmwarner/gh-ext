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
 * **The filter narrows, it does not find.** `Mod+K` already finds a file and
 * jumps to it; the box at the top of this rail is the other half — it stays on,
 * keeps the tree's order and nesting, and leaves a reviewer working down an
 * area of the change. It narrows *this rail only*: the diff column keeps every
 * file, because a control in the sidebar that quietly removed files from a
 * review is the thing `lib/settings.ts` argues at length against. What it is
 * doing is said in words above the rows, so it cannot be left on by accident.
 *
 * Structure, order, and what a folder's checkbox acts on are all in
 * `treeRows`. What is here is only how a row is drawn and which key does what.
 */

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileViewedState, PatchStatus } from '@/lib/github/types';
import { pathMatches } from '@/lib/review/search';
import { type CurrentFile, shouldSelectInTree } from './currentFile';
import type { FileComments } from './fileTreeData';
import type { ReviewFile } from './reviewFiles';
import { type TreeRow, checkState, directoryPaths, treeRows } from './treeRows';

/** U+2212 MINUS SIGN, which is what GitHub uses and what aligns with `+`. */
const MINUS = '−';

/**
 * No folds, shared so a filtered render does not allocate one per keystroke.
 *
 * What a narrowed tree is built with. A folder the reviewer shut still holds
 * whatever matched, and leaving it shut would have the count claim a file the
 * tree is not showing — which reads as the filter being broken rather than as
 * the folder being closed.
 */
const NOTHING_COLLAPSED: ReadonlySet<string> = new Set();

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
 * Past this the number stops being a count and starts being a width.
 *
 * The rail's Conversations badge draws the line in the same place. A row has
 * less room than that badge rather than more: the rail is resizable down to
 * 180px, and everything the row gains is taken off the file name, which is the
 * only part of it licensed to truncate. What is said out loud keeps the real
 * figure — the cap is about what fits, not about what is true.
 */
const COMMENT_LIMIT = 99;

/** What a row draws for its conversations, and what it says they are. */
interface CommentMark {
  tone: 'open' | 'resolved';
  /** The figure as drawn, which above `COMMENT_LIMIT` is not the figure. */
  count: string;
  said: string;
}

/**
 * How much conversation a file is carrying, in a number and in a sentence.
 *
 * The number is the unresolved count while there is one and the total once
 * there is not, which is the split the two tones have drawn since the mark was
 * a dot. A reviewer working down this rail is asking what is left of the
 * review, so what is left is the number; on a file where nothing is left, the
 * useful figure is how much was said, because that is what decides whether the
 * file is worth reading again before approving.
 *
 * The sentence is built here rather than at the two attributes that carry it,
 * so the tooltip and the accessible name cannot drift apart. They are one
 * fact, and a reviewer with a pointer and a reviewer with a screen reader
 * should be told it in the same words.
 */
function commentMark(talk: FileComments): CommentMark {
  const open = talk.unresolved > 0;
  const count = open ? talk.unresolved : talk.total;
  const noun = count === 1 ? 'comment' : 'comments';

  return {
    tone: open ? 'open' : 'resolved',
    count: count > COMMENT_LIMIT ? `${COMMENT_LIMIT}+` : `${count}`,
    said: open ? `${count} unresolved ${noun}` : `${count} ${noun}, all resolved`,
  };
}

/**
 * A speech bubble, at the size a 26px row has for it.
 *
 * The same silhouette the rail draws for the Conversations view, because a
 * product that means one thing by a speech bubble should draw one bubble — but
 * deliberately not the same path. That one is a compound path, an outer
 * contour with a counter cut out of it, which is how it reads as an outline at
 * 20px; at 12px the counter is a hairline hole inside a hairline ring and the
 * whole glyph silts up on any display not drawing at 2x. This is that path's
 * outer contour on its own, with the hole left out.
 *
 * The hole is what the two tones now spend instead: filled while something is
 * outstanding, and the same contour drawn as an outline once everything on the
 * file is settled. `fill` and `stroke` are set from the stylesheet rather than
 * declared here, because which of the two a tone uses is a colour decision and
 * colours live in one place.
 *
 * Drawn rather than imported, for the reason the rail's five glyphs are: this
 * project takes no new dependencies, and a sixth 16px glyph is not a reason to
 * break that.
 */
function CommentGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.75 2h10.5A1.75 1.75 0 0 1 15 3.75v7A1.75 1.75 0 0 1 13.25 12.5H8.06l-3.03 2.28A.75.75 0 0 1 3.83 14.2V12.5h-1.08A1.75 1.75 0 0 1 1 10.75v-7A1.75 1.75 0 0 1 2.75 2Z" />
    </svg>
  );
}

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
  /**
   * Open with every directory shut, for the monorepo case.
   *
   * Read once, when the first file list arrives, and never again — see the
   * seed below. It is where the tree *starts*, not a switch the tree obeys,
   * and the difference matters: a reviewer forty minutes into a review has
   * arranged these folds themselves, and a setting that reapplied itself
   * would throw that away to tell them something they already knew.
   */
  collapseTree?: boolean;
}

export function FileTree({
  files,
  comments,
  viewed,
  current,
  onSelect,
  onSetViewed,
  collapseTree = false,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NOTHING_COLLAPSED);
  const [focused, setFocused] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const [query, setQuery] = useState('');

  const paths = useMemo(() => files.map((file) => file.path), [files]);

  /**
   * Shut every directory, once, if that is how the reviewer asked for the tree.
   *
   * Two things about the timing, and both are load-bearing.
   *
   * It waits for a file list rather than running on mount, because settings
   * arrive from `storage.local` and storage is asynchronous — `useSettings`
   * starts on the defaults and replaces them a tick later. A seed at mount
   * would therefore read `collapseTree` as off for every reviewer who had
   * turned it on. The first render that has paths to fold is the one whose
   * setting is real: `useSettings` resolves long before the pull request
   * itself arrives over the wire, which is what puts these files here.
   *
   * And it runs once, guarded by a ref rather than by the value it read. A
   * reviewer who changes the setting with a review open has forty minutes of
   * their own folding on screen, and reapplying this would throw it away to
   * tell them something they had just said. The same ref is why turning the
   * setting *off* mid-review does not fling every folder open either.
   *
   * During render rather than in an effect, which is the pattern `DiffColumn`
   * uses for the same reason: the rows below are built from `collapsed` in
   * this same pass, and an effect would paint one frame of a fully open tree
   * before shutting it.
   */
  const seeded = useRef(false);
  if (!seeded.current && paths.length > 0) {
    seeded.current = true;
    if (collapseTree) setCollapsed(directoryPaths(paths));
  }

  /**
   * What the filter leaves, or `paths` itself when there is no filter.
   *
   * The same array rather than a copy in the common case, so the rows below are
   * rebuilt only when something actually moved.
   */
  const filtering = query.trim() !== '';
  const shown = useMemo(
    () => (filtering ? paths.filter((path) => pathMatches(path, query)) : paths),
    [filtering, paths, query],
  );

  const rows = useMemo(
    () => treeRows(shown, filtering ? NOTHING_COLLAPSED : collapsed),
    [shown, filtering, collapsed],
  );
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

  /**
   * What the filter did, in words, and empty when it is not doing anything.
   *
   * It exists so that a filter cannot be forgotten. The tree is the reviewer's
   * map of the change, and one silently showing four of forty files is a map
   * that lies — the same objection `lib/settings.ts` makes to a preference that
   * hides lines without saying it is on.
   */
  const narrowed = !filtering
    ? ''
    : shown.length === 0
      ? `No file matches “${query.trim()}”`
      : `${shown.length} of ${paths.length} files`;

  return (
    <>
      <div className="filetree-filter">
        <input
          type="search"
          className="filetree-search"
          aria-label="Filter files"
          placeholder="Filter files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape rather than selecting the text and deleting it. This box
            // is meant to be picked up and put down between one look and the
            // next, and `lib/keymap.ts` already ignores keys typed in an input,
            // so the single-letter shortcuts are not at risk either way.
            if (event.key === 'Escape') setQuery('');
            // Straight into what was found, without reaching for the mouse.
            else if (event.key === 'ArrowDown') move(rows[0]);
            else return;
            event.preventDefault();
          }}
        />
        {narrowed !== '' && (
          /* Rendered only when it has something to say. A live region that is
             permanently present and permanently empty is a node every other
             surface's `role="status"` has to be told apart from, and it says
             nothing to a reviewer either. */
          <p className="filetree-count" role="status">
            {narrowed}
          </p>
        )}
      </div>

      <div className="filetree-rows" role="tree" aria-label="Changed files" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const file = byPath.get(row.path);
        const state = checkState(row, states);
        const talk = row.kind === 'file' ? comments?.get(row.path) : undefined;
        const mark = talk === undefined || talk.total === 0 ? null : commentMark(talk);

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

            {mark !== null && (
              /* `role="img"` carrying the sentence, where this used to be
                 `aria-hidden`. Hiding it was right while it was a 7px dot: a
                 dot is decoration, the `title` was a pointer affordance, and
                 the row's name lost nothing by not mentioning it. A number is
                 not decoration. Left hidden it would be a fact only sighted
                 reviewers get, and left plain it would land in the row's
                 accessible name as a bare digit — "app.ts 2 +12 −3", three
                 numbers running together, two of them about lines and one
                 about conversations, with nothing to say which is which. So
                 the bubble and the digit are declared as one image and the
                 label replaces both with what they mean. `ReviewerAvatars`
                 does the same for an avatar that is a letter.

                 The `title` stays, because `aria-label` is not a tooltip and
                 a pointer user reading a capped "99+" has nowhere else to
                 find the real number. */
              <span
                className="tree-comment"
                data-tone={mark.tone}
                title={mark.said}
                role="img"
                aria-label={mark.said}
              >
                <CommentGlyph />
                {mark.count}
              </span>
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
    </>
  );
}
