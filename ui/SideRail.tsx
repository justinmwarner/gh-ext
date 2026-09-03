/**
 * The left rail: a tab strip, the page it selects, then the file tree.
 *
 * The tree stays put whichever page is showing. It is how the reviewer moves
 * through the diff, and swapping it out to read a comment would mean losing
 * your place in the review to answer a question about it.
 *
 * Both pages are mounted and the inactive one is `hidden`, so each tab really
 * does control a panel that exists — and so a long thread list keeps its
 * scroll position across a trip to the Overview and back.
 *
 * The tree virtualizes against its own scrollport, so the rail is a flex column
 * and the tree gets what is left after the panel — an unconstrained host would
 * measure zero and render nothing. That is also why the drag sets a *cap*
 * rather than a height: an Overview with no description would otherwise leave a
 * hole above the tree that the reviewer cannot close, and dragged to its
 * maximum on a short window a fixed height would leave the tree nothing at all.
 */

import { type CSSProperties, useMemo, useState } from 'react';
import type { PrPayload } from '@/lib/messages';
import { ConversationsPage } from './ConversationsPage';
import { FileTree } from './FileTree';
import { OverviewPage } from './OverviewPage';
import { RAIL_TABS, type RailTab, RailTabs, panelId, tabId } from './RailTabs';
import { Resizer } from './Resizer';
import type { CurrentFile } from './currentFile';
import { fileComments } from './fileTreeData';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession } from './reviewSession';
import { useDragSize } from './useDragSize';

/** Tall enough to read a description in, short enough to leave the tree a tree. */
const PANEL = { axis: 'y', min: 120, max: 520, initial: 240 } as const;

export interface SideRailProps {
  width: number;
  payload: PrPayload;
  files: readonly ReviewFile[];
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  onSelect: (path: string) => void;
  onJumpToThread: (threadId: string, path: string) => void;
}

export function SideRail({
  width,
  payload,
  files,
  current,
  onSelect,
  onJumpToThread,
}: SideRailProps) {
  const session = useReviewSession();
  const [tab, setTab] = useState<RailTab>('overview');
  const panel = useDragSize(PANEL);

  // The order the column shows them in, which is the order the jump list reads
  // in. Derived from the same list the tree and the column are built from.
  const paths = useMemo(() => files.map((file) => file.path), [files]);

  // Memoized on the threads themselves, not on the session: the tree redraws
  // on this map's *identity*, so a fresh one each render would re-render every
  // visible row on every keystroke anywhere on the page.
  const comments = useMemo(() => fileComments(session.threads), [session.threads]);

  return (
    <aside className="rail" style={{ width: `${width}px` }}>
      <RailTabs active={tab} onSelect={setTab} />

      <div
        className="rail-panel"
        style={{ '--panel-max': `${panel.size}px` } as CSSProperties}
      >
        {RAIL_TABS.map(({ id }) => (
          <div
            key={id}
            className="rail-page"
            role="tabpanel"
            id={panelId(id)}
            aria-labelledby={tabId(id)}
            hidden={id !== tab}
            // Focusable so the panel can be scrolled from the keyboard, and
            // because a tabpanel whose contents happen to be empty would
            // otherwise be unreachable by Tab.
            tabIndex={0}
          >
            {id === 'overview' ? (
              <OverviewPage payload={payload} />
            ) : (
              <ConversationsPage paths={paths} onJumpToThread={onJumpToThread} />
            )}
          </div>
        ))}
      </div>

      <Resizer
        {...panel}
        className="panel-resizer"
        orientation="horizontal"
        label="Resize the panel above the files"
        min={PANEL.min}
        max={PANEL.max}
      />

      <nav className="filetree" aria-label="Changed files">
        <FileTree
          files={files}
          comments={comments}
          current={current}
          onSelect={onSelect}
        />
      </nav>
    </aside>
  );
}
