/**
 * The Files view: the file tree, the diff column, and the seam between them.
 *
 * The same shape as GitHub's Files-changed tab, deliberately. A reviewer who
 * arrives here from that page should not have to find anything twice.
 *
 * It owns two things that used to be somewhere else. The tree is here rather
 * than in a rail of its own, because there is no longer a rail — the view
 * switcher took that job and this view is what it switches to. And the
 * comparison toggle is here rather than in the top bar, where it sat beside the
 * pull request's title as though it described the pull request; it describes
 * what this column is showing.
 *
 * Both Pierre surfaces virtualize against a scrollport they measure, so this is
 * a flex row with `min-height: 0` throughout — an unconstrained host measures
 * zero and renders nothing at all.
 */

import type { Ref } from 'react';
import { useCallback, useMemo } from 'react';
import type { PrPayload } from '@/lib/messages';
import { DiffColumn, type DiffColumnHandle, type ThreadJump } from './DiffColumn';
import { FileTree } from './FileTree';
import { Resizer } from './Resizer';
import type { BlobRefs } from './blobLoader';
import type { AnchorableSides } from '@/lib/review/diffScope';
import type { CurrentFile } from './currentFile';
import { fileComments } from './fileTreeData';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession } from './reviewSession';
import { useDragSize } from './useDragSize';

/** Wide enough for a deep path, narrow enough to leave the diff its width. */
const RAIL = { axis: 'x', min: 180, max: 560, initial: 296 } as const;

/**
 * How much is on screen, which is not always how much is in the pull request.
 *
 * Counted from the list the column is actually drawing, so while a narrowed
 * diff is showing this describes that. Totalling the whole pull request here
 * would contradict the diff directly underneath it.
 */
function Summary({ files }: { files: readonly ReviewFile[] }) {
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  return (
    <p className="filesview-summary">
      {`${files.length} ${files.length === 1 ? 'file' : 'files'} changed`}
      <span className="filesview-counts">
        <span className="additions">{`+${totals.additions}`}</span>
        <span className="deletions">{`−${totals.deletions}`}</span>
      </span>
    </p>
  );
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
  columnRef?: Ref<DiffColumnHandle>;
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
  columnRef,
}: FilesViewProps) {
  const session = useReviewSession();
  const rail = useDragSize(RAIL);

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

  const toggleViewed = useCallback(
    (path: string) => {
      const current = viewed.get(path);
      if (current === undefined) return;
      // `current`, not the payload's value: what goes back on failure is what
      // the reviewer was actually looking at — including DISMISSED, which
      // rolling back to UNVIEWED would quietly erase.
      void session.setViewed(path, current !== 'VIEWED', current);
    },
    [session, viewed],
  );

  return (
    <div className="filesview">
      <div className="filesview-bar">
        <Summary files={files} />
      </div>

      <div className="filesview-body">
        <nav
          className="filetree"
          aria-label="Changed files"
          style={{ width: `${rail.size}px` }}
        >
          <FileTree
            files={files}
            comments={comments}
            viewed={viewed}
            current={current}
            onSelect={onSelectFromTree}
            onToggleViewed={toggleViewed}
          />
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
          current={current}
          onScrollTo={onSelectFromScroll}
          jump={jump}
          blobs={blobs}
        />
      </div>
    </div>
  );
}
