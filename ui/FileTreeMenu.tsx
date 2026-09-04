/**
 * What a tree row offers on right-click.
 *
 * The tick in the row's decoration is a glyph with a delegated click handler.
 * That is as far as `@pierre/trees` allows a per-row control to go — the row is
 * a `<button role="treeitem">`, and nothing focusable may nest inside one — so
 * the tick works with a pointer and not with a keyboard.
 *
 * This is the other half. The context menu is the one per-row affordance the
 * library does sanction, its content is real light-DOM React, and it is reached
 * by the tree's own action button, which *is* focusable. Same action, second
 * route, and the route that a keyboard can take.
 */

import type { FileViewedState } from '@/lib/github/types';

export interface FileTreeMenuProps {
  item: { kind: 'directory' | 'file'; path: string };
  /** The live state of `item.path`, as the session holds it. */
  viewed: FileViewedState;
  onToggleViewed: (path: string) => void;
  onClose: () => void;
}

const FOLDER =
  'Viewed is a per-file state on GitHub, so there is nothing to mark on a folder.';

export function FileTreeMenu({
  item,
  viewed,
  onToggleViewed,
  onClose,
}: FileTreeMenuProps) {
  const file = item.kind === 'file';
  // DISMISSED is not viewed: the reviewer marked it and it changed underneath
  // them, so they have not seen this version. The action is to mark it again.
  const marked = viewed === 'VIEWED';

  return (
    <div className="tree-menu">
      <button
        type="button"
        className="tree-menu-item"
        disabled={!file}
        title={file ? undefined : FOLDER}
        onClick={() => {
          onToggleViewed(item.path);
          onClose();
        }}
      >
        {marked ? 'Mark as not viewed' : 'Mark as viewed'}
      </button>
    </div>
  );
}
