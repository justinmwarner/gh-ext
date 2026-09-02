/**
 * The left rail: an Overview disclosure on top, the file tree below it.
 *
 * The tree virtualizes against its own scrollport, so the rail is a flex column
 * and the tree gets what is left after the disclosure — an unconstrained host
 * would measure zero and render nothing. The Overview scrolls on its own for
 * the same reason: a long description must not push the tree off the bottom.
 */

import { useMemo } from 'react';
import type { PrPayload } from '@/lib/messages';
import { FileTree } from './FileTree';
import { Overview } from './Overview';
import type { CurrentFile } from './currentFile';
import type { ReviewFile } from './reviewFiles';

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
  // The order the column shows them in, which is the order the jump list reads
  // in. Derived from the same list the tree and the column are built from.
  const paths = useMemo(() => files.map((file) => file.path), [files]);

  return (
    <aside className="rail" style={{ width: `${width}px` }}>
      <details className="overview" open>
        <summary>Overview</summary>
        <Overview payload={payload} paths={paths} onJumpToThread={onJumpToThread} />
      </details>

      <nav className="filetree" aria-label="Changed files">
        <FileTree files={files} current={current} onSelect={onSelect} />
      </nav>
    </aside>
  );
}
