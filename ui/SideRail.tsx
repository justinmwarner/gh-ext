/**
 * The left rail: an Overview disclosure on top, the file tree below it.
 *
 * The Overview is still empty; the tree is not. The tree virtualizes against
 * its own scrollport, so the rail is a flex column and the tree gets what is
 * left after the disclosure — an unconstrained host would measure zero and
 * render nothing.
 */

import { FileTree } from './FileTree';
import type { CurrentFile } from './currentFile';
import type { ReviewFile } from './reviewFiles';

export interface SideRailProps {
  width: number;
  files: readonly ReviewFile[];
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  onSelect: (path: string) => void;
}

export function SideRail({ width, files, current, onSelect }: SideRailProps) {
  return (
    <aside className="rail" style={{ width: `${width}px` }}>
      <details className="overview" open>
        <summary>Overview</summary>
        <p className="placeholder">
          The description, per-check statuses, reviewer states and unresolved
          threads go here.
        </p>
      </details>

      <nav className="filetree" aria-label="Changed files">
        <FileTree files={files} current={current} onSelect={onSelect} />
      </nav>
    </aside>
  );
}
