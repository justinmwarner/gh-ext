/**
 * The loaded layout: top bar, resizable rail, diff column.
 *
 * Deliberately the same shape as GitHub's Files-changed tab. A reviewer who
 * arrives here from that page should not have to find anything twice.
 *
 * It also owns the one piece of state the rail and the column share: which file
 * the review is on. Neither of them can own it — the tree scrolls the column
 * and the column selects in the tree, so whichever held it would be asking the
 * other to change and being told about it in the same breath. `currentFile`
 * explains the rule that keeps that from looping.
 */

import { useCallback, useMemo, useState } from 'react';
import type { PrPayload } from '@/lib/messages';
import { DiffColumn, type ThreadJump } from './DiffColumn';
import { RailResizer } from './RailResizer';
import { ReviewFooter } from './ReviewFooter';
import { SideRail } from './SideRail';
import { TopBar } from './TopBar';
import { TruncationNotice } from './TruncationNotice';
import { type CurrentFile, NO_FILE, fromScroll, fromTree } from './currentFile';
import { prPermalink, prViewerIsAuthor } from './prNode';
import { ReviewSessionProvider } from './reviewSession';
import { reviewFiles } from './reviewFiles';
import { useRailWidth } from './useRailWidth';

export function Shell({ payload }: { payload: PrPayload }) {
  const rail = useRailWidth();

  const files = useMemo(() => reviewFiles(payload), [payload]);
  const [current, setCurrent] = useState<CurrentFile>(NO_FILE);
  const [jump, setJump] = useState<ThreadJump | null>(null);

  // Both reducers return the state they were given when the path has not
  // moved, so an echo from the far surface is a bail-out rather than a render.
  const selectFromTree = useCallback((path: string) => {
    setCurrent((state) => fromTree(state, path));
  }, []);
  const selectFromScroll = useCallback((path: string) => {
    setCurrent((state) => fromScroll(state, path));
  }, []);

  /**
   * Jumping to a thread from the Overview, in two steps.
   *
   * The file first, through the same reducer the tree uses, so the column
   * scrolls its item into place. Then the thread itself, which may not have
   * been in the DOM at all a moment ago. The token is what makes a second jump
   * to a thread on the *same* file act: `fromTree` returns the state it was
   * given when the path has not moved, exactly so echoes do not re-render.
   */
  const jumpToThread = useCallback((threadId: string, path: string) => {
    setCurrent((state) => fromTree(state, path));
    setJump((previous) => ({ threadId, token: (previous?.token ?? 0) + 1 }));
  }, []);

  return (
    // The session wraps the whole shell rather than the column alone: a
    // resolve has to be visible everywhere at once, and the pending-review
    // state is hydrated here from `viewerLatestReview` before anything can
    // post a comment against the wrong target.
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
    >
      <div className="shell">
        <TopBar payload={payload} />
        <TruncationNotice
          truncated={payload.truncated}
          pr={payload.ref}
          href={prPermalink(payload.pullRequest)}
        />
        <div className="shell-body">
          <SideRail
            width={rail.width}
            payload={payload}
            files={files}
            current={current}
            onSelect={selectFromTree}
            onJumpToThread={jumpToThread}
          />
          <RailResizer {...rail} />
          <DiffColumn
            files={files}
            diff={{ source: payload.diff.source, truncated: payload.diff.truncated }}
            current={current}
            onScrollTo={selectFromScroll}
            jump={jump}
          />
        </div>
        <ReviewFooter viewerIsAuthor={prViewerIsAuthor(payload.pullRequest)} />
      </div>
    </ReviewSessionProvider>
  );
}
