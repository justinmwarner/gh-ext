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
import { DiffColumn } from './DiffColumn';
import { RailResizer } from './RailResizer';
import { SideRail } from './SideRail';
import { TopBar } from './TopBar';
import { TruncationNotice } from './TruncationNotice';
import { type CurrentFile, NO_FILE, fromScroll, fromTree } from './currentFile';
import { prPermalink } from './prNode';
import { ReviewSessionProvider } from './reviewSession';
import { reviewFiles } from './reviewFiles';
import { useRailWidth } from './useRailWidth';

export function Shell({ payload }: { payload: PrPayload }) {
  const rail = useRailWidth();

  const files = useMemo(() => reviewFiles(payload), [payload]);
  const [current, setCurrent] = useState<CurrentFile>(NO_FILE);

  // Both reducers return the state they were given when the path has not
  // moved, so an echo from the far surface is a bail-out rather than a render.
  const selectFromTree = useCallback((path: string) => {
    setCurrent((state) => fromTree(state, path));
  }, []);
  const selectFromScroll = useCallback((path: string) => {
    setCurrent((state) => fromScroll(state, path));
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
            files={files}
            current={current}
            onSelect={selectFromTree}
          />
          <RailResizer {...rail} />
          <DiffColumn
            files={files}
            diff={{ source: payload.diff.source, truncated: payload.diff.truncated }}
            current={current}
            onScrollTo={selectFromScroll}
          />
        </div>
      </div>
    </ReviewSessionProvider>
  );
}
