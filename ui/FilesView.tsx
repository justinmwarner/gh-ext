/**
 * The Files view: the file tree, the diff column, and the seam between them.
 *
 * The same shape as GitHub's Files-changed tab, deliberately. A reviewer who
 * arrives here from that page should not have to find anything twice.
 *
 * The tree is here rather than in a rail of its own, because there is no longer
 * a rail — the view switcher took that job and this view is what it switches
 * to. What the column is showing, and how much of it, is said by `ScopeBar`
 * directly above this: one row rather than the two it used to take, sitting on
 * the diff it describes.
 *
 * Both Pierre surfaces virtualize against a scrollport they measure, so this is
 * a flex row with `min-height: 0` throughout — an unconstrained host measures
 * zero and renders nothing at all.
 */

import type { Ref } from 'react';
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PrPayload } from '@/lib/messages';
import {
  DiffColumn,
  type DiffColumnHandle,
  type DiffStyle,
  type ThreadJump,
} from './DiffColumn';
import { FileTree } from './FileTree';
import {
  DEFAULT_FIND,
  FindPanel,
  type FindPanelHandle,
  type FindState,
  type FindTarget,
} from './FindPanel';
import { Resizer } from './Resizer';
import type { BlobRefs } from './blobLoader';
import type { AnchorableSides } from '@/lib/review/diffScope';
import type { CurrentFile } from './currentFile';
import { fileComments } from './fileTreeData';
import type { GeneratedRule } from '@/lib/review/generated';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession } from './reviewSession';
import { useDragSize } from './useDragSize';
import type { LineDiff } from '@/lib/settings';
import { readRailWidth, writeRailWidth } from '@/lib/settings-store';

/** Wide enough for a deep path, narrow enough to leave the diff its width. */
const RAIL = { axis: 'x', min: 180, max: 560, initial: 296 } as const;

/** Which of the rail's two trees is showing. */
type RailTab = 'files' | 'search';

export interface FilesViewHandle {
  /**
   * Show the find panel and put the cursor in its box.
   *
   * What `Mod+F` and `/` call. A handle rather than a prop, mirroring
   * `columnRef` one layer up: opening the panel is an event rather than a
   * state the shell has an opinion about, and a boolean prop would have to be
   * unset again afterwards by whoever set it.
   */
  openFind(): void;
}

export interface FilesViewProps {
  payload: PrPayload;
  files: readonly ReviewFile[];
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  onSelectFromTree: (path: string) => void;
  onSelectFromScroll: (path: string) => void;
  jump: ThreadJump | null;
  blobs: BlobRefs | null;
  diff: { source: PrPayload['diff']['source']; truncated: boolean };
  /**
   * Which sides of what is on screen number their lines the way the pull
   * request's own diff does. Passed straight through: the column is what has
   * to refuse an anchor on a side that does not.
   */
  sides: AnchorableSides;
  /** Unified or side by side. Passed straight through, like `sides`. */
  diffStyle: DiffStyle;
  /** Which syntax theme the diff draws in. Empty means Pierre chooses. */
  syntaxTheme: string;
  /** Draw every file without its whitespace-only changes. Also passed through. */
  ignoreWhitespace: boolean;
  /** Fold away the diff of a file nobody wrote. Also passed through. */
  hideGenerated: boolean;
  /**
   * What the repository declared about its own generated files.
   *
   * Outranks {@link generatedPatterns}, which is `isGenerated`'s rule and not
   * this component's — everything here only carries the two to it.
   */
  gitAttributes: readonly GeneratedRule[];
  /**
   * The three below are optional where the ones above are required, because
   * each one's absence has a single obvious meaning — the value
   * `DEFAULT_SETTINGS` gives it — and `DiffColumn` already declares them that
   * way one layer down.
   */
  /** How much of a changed line is picked out inside it. Passed through. */
  lineDiff?: LineDiff;
  /** Paths the reviewer calls generated, on top of the built-in list. */
  generatedPatterns?: readonly string[];
  /** Open the tree with its directories shut. Read once, by the tree. */
  collapseTree?: boolean;
  columnRef?: Ref<DiffColumnHandle>;
  ref?: Ref<FilesViewHandle>;
  /**
   * Send the review to a find result.
   *
   * Handled above rather than here, because arriving somewhere is a whole-page
   * move: it selects a file, scrolls the column, and sometimes hands over the
   * keyboard, and only the shell holds all three.
   */
  onFindResult?: (target: FindTarget) => void;
}

export function FilesView({
  payload,
  files,
  current,
  onSelectFromTree,
  onSelectFromScroll,
  jump,
  blobs,
  diff,
  sides,
  diffStyle,
  syntaxTheme,
  ignoreWhitespace,
  hideGenerated,
  gitAttributes,
  lineDiff,
  generatedPatterns,
  collapseTree,
  columnRef,
  ref,
  onFindResult,
}: FilesViewProps) {
  const session = useReviewSession();

  /**
   * Which tree the rail is showing, and what the find panel has been asked.
   *
   * Both held here rather than inside `FindPanel`, so that looking at the file
   * tree and coming back does not silently throw away a search. The panel keeps
   * only its folds, which are about a result list that stops existing the
   * moment the query changes.
   */
  const [tab, setTab] = useState<RailTab>('files');
  const [find, setFind] = useState<FindState>(DEFAULT_FIND);
  const panel = useRef<FindPanelHandle>(null);

  useImperativeHandle(
    ref,
    (): FilesViewHandle => ({
      openFind() {
        setTab('search');
        // After the swap, so the box exists to be focused. A second `Mod+F`
        // with the panel already open lands here too and selects what is in
        // it, which is almost always what the reviewer meant by pressing it
        // again.
        queueMicrotask(() => panel.current?.focusQuery());
      },
    }),
    [],
  );

  /**
   * The rail's width, kept between sessions.
   *
   * Its own storage key rather than a field on `Settings`, and with no control
   * on the options page at all — `RAIL_WIDTH_KEY` carries both arguments. The
   * short version of the second one is that a drag has already said this, and a
   * number field asking again would be the same answer in a worse form.
   *
   * `RAIL.min` and `RAIL.max` are handed to the read rather than kept beside
   * the key, so a stored width from a wider monitor is clamped to the range
   * this resizer actually enforces instead of drawing a rail that leaves no
   * room for the diff and cannot be grabbed to fix.
   *
   * Inline rather than memoized: `useDragSize` holds it in a ref and reads it
   * only from a listener, so a new identity each render costs nothing.
   */
  const rail = useDragSize(RAIL, {
    read: () => readRailWidth(RAIL.min, RAIL.max),
    // Fire and forget. Nothing on screen waits for this, and a failed write
    // means the next session opens at the default — which is the state the
    // reviewer would have been in anyway.
    write: (width) => {
      void writeRailWidth(width).catch(() => {});
    },
  });

  // Memoized on the threads themselves, not on the session: the tree redraws
  // on this map's *identity*, so a fresh one each render would re-render every
  // visible row on every keystroke anywhere on the page.
  const comments = useMemo(() => fileComments(session.threads), [session.threads]);

  /**
   * What each file's tick should show, which is not always what the payload
   * says: the session holds an optimistic value for as long as a toggle is in
   * flight, and puts back exactly what it displaced if GitHub refuses.
   */
  const viewed = useMemo(
    () =>
      new Map(
        files.map((file) => [file.path, session.viewed.get(file.path) ?? file.viewedState]),
      ),
    [files, session.viewed],
  );

  /**
   * Mark a set of files viewed, or unmark them.
   *
   * One path when a file's own box is ticked, every file beneath it when a
   * folder's is — and a folder can hold fifty. `markFileAsViewed` is per file
   * and there is no bulk form, so this is fifty mutations however it is
   * dressed up; what it must not be is fifty at once. Four at a time keeps a
   * large folder responsive without opening the throttle on GitHub.
   *
   * Files already in the target state are skipped, so finishing a half-viewed
   * folder does not re-send the half that was already done.
   */
  const setViewedMany = useCallback(
    (paths: readonly string[], next: boolean) => {
      const todo = paths.filter((path) => {
        const state = viewed.get(path);
        return state !== undefined && (state === 'VIEWED') !== next;
      });
      if (todo.length === 0) return;

      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < todo.length) {
          const path = todo[cursor];
          cursor += 1;
          if (path === undefined) return;
          const from = viewed.get(path);
          if (from === undefined) continue;
          // `from`, not the payload's value: what goes back on failure is what
          // the reviewer was actually looking at — including DISMISSED, which
          // rolling back to UNVIEWED would quietly erase.
          await session.setViewed(path, next, from);
        }
      };

      void Promise.all(
        Array.from({ length: Math.min(4, todo.length) }, () => worker()),
      );
    },
    [session, viewed],
  );

  return (
    <div className="filesview">
      <div className="filesview-body">
        <nav
          className="filetree"
          aria-label="Changed files"
          style={{ width: `${rail.size}px` }}
        >
          {/* Two trees, one rail. A real `tablist`, so the panel is reachable
              by pointer rather than only by a shortcut the reviewer has to
              already know about — the same argument `ViewSwitcher` makes for
              the three views one level out. */}
          <div className="rail-tabs" role="tablist" aria-label="Sidebar">
            {(['files', 'search'] as const).map((which) => (
              <button
                key={which}
                type="button"
                role="tab"
                id={`rail-tab-${which}`}
                aria-controls={`rail-panel-${which}`}
                aria-selected={tab === which}
                tabIndex={tab === which ? 0 : -1}
                className={tab === which ? 'rail-tab rail-tab-active' : 'rail-tab'}
                onClick={() => setTab(which)}
              >
                {which === 'files' ? 'Files' : 'Search'}
              </button>
            ))}
          </div>

          {/* Both mounted, swapped with `visibility` — the pattern `.views`
              already uses, and for the same reason. Unmounting would cost the
              file tree its folds and its filter, and the find panel its
              results and its scroll position, every single time the reviewer
              glanced at the other one. */}
          <div className="rail-panels">
            <div
              className="rail-panel"
              id="rail-panel-files"
              role="tabpanel"
              aria-labelledby="rail-tab-files"
              style={{ visibility: tab === 'files' ? 'visible' : 'hidden' }}
            >
              <FileTree
                files={files}
                comments={comments}
                viewed={viewed}
                current={current}
                onSelect={onSelectFromTree}
                onSetViewed={setViewedMany}
                collapseTree={collapseTree}
              />
            </div>

            <div
              className="rail-panel"
              id="rail-panel-search"
              role="tabpanel"
              aria-labelledby="rail-tab-search"
              style={{ visibility: tab === 'search' ? 'visible' : 'hidden' }}
            >
              <FindPanel
                ref={panel}
                files={files}
                state={find}
                onState={setFind}
                onGoTo={(target) => onFindResult?.(target)}
                // Escape on an empty box hands the rail back to the checklist,
                // which is where a reviewer who has finished searching wants to
                // be — and is the only way back that does not need the mouse.
                onClose={() => setTab('files')}
              />
            </div>
          </div>
        </nav>

        <Resizer
          {...rail}
          className="rail-resizer"
          orientation="vertical"
          label="Resize the sidebar"
          min={RAIL.min}
          max={RAIL.max}
        />

        <DiffColumn
          ref={columnRef}
          files={files}
          diff={diff}
          sides={sides}
          diffStyle={diffStyle}
          syntaxTheme={syntaxTheme}
          lineDiff={lineDiff}
          ignoreWhitespace={ignoreWhitespace}
          hideGenerated={hideGenerated}
          generatedPatterns={generatedPatterns}
          gitAttributes={gitAttributes}
          current={current}
          onScrollTo={onSelectFromScroll}
          jump={jump}
          blobs={blobs}
        />
      </div>
    </div>
  );
}
