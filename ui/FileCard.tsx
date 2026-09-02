/**
 * The header of one diff card.
 *
 * `@pierre/diffs` renders the code into a shadow root, but header content goes
 * in through a slot as ordinary React in ordinary light DOM — so this is plain
 * markup with plain event handlers, positioned by the shadow row and styled by
 * the page.
 *
 * It carries the four things §5 asks for: the path, the added and removed
 * counts, the viewed checkbox, and the collapse toggle — plus, for a file with
 * no diff behind it, the sentence explaining why.
 */

import type { FileViewedState } from '@/lib/github/types';
import { fileBody } from './diffItems';
import type { ReviewFile } from './reviewFiles';

/** U+2212 MINUS SIGN, which is what GitHub uses and what aligns with `+`. */
const MINUS = '−';

/**
 * The viewed checkbox, in all three of its states.
 *
 * `DISMISSED` is the one that matters: the reviewer marked this file viewed and
 * then it changed underneath them. Drawn as unviewed it would lose that they
 * ever looked; drawn as viewed it would claim they had seen the current
 * version. It is a third state, and it is drawn as one — indeterminate, with
 * the reason spelled out beside it.
 *
 * Read-only for now. The mutation is a later task, and a checkbox that moves
 * without persisting is worse than one that does not move.
 */
function ViewedCheckbox({
  path,
  state,
}: {
  path: string;
  state: FileViewedState;
}) {
  const dismissed = state === 'DISMISSED';

  return (
    <label className="viewed" data-viewed-state={state}>
      <input
        type="checkbox"
        checked={state === 'VIEWED'}
        ref={(node) => {
          // `indeterminate` is a DOM property with no HTML attribute, so it
          // cannot be set from JSX.
          if (node !== null) node.indeterminate = dismissed;
        }}
        readOnly
        aria-readonly="true"
        aria-label={`Mark ${path} as viewed`}
        title="Marking files viewed is not wired up yet"
      />
      <span>Viewed</span>
      {dismissed && <span className="viewed-note">changed since</span>}
    </label>
  );
}

export interface FileCardProps {
  file: ReviewFile;
  collapsed: boolean;
  onToggleCollapsed: (path: string) => void;
  /** Called with the header element so the column can tell where it sits. */
  onHeaderRef: (path: string, node: HTMLElement | null) => void;
}

export function FileCard({
  file,
  collapsed,
  onToggleCollapsed,
  onHeaderRef,
}: FileCardProps) {
  const body = fileBody(file);
  // Nothing to collapse: the card is already only its header, and a toggle that
  // reveals an empty rectangle is a lie about there being more to see.
  const collapsible = body.kind === 'diff';

  return (
    <div
      className="file-card"
      data-file-card={file.path}
      ref={(node) => {
        onHeaderRef(file.path, node);
        return () => onHeaderRef(file.path, null);
      }}
    >
      <div className="file-card-head">
        {collapsible && (
          <button
            type="button"
            className="collapse-toggle"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}
            onClick={() => onToggleCollapsed(file.path)}
          >
            <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          </button>
        )}

        <span className="file-path">
          {file.isRename && (
            <>
              <span className="file-path-old">{file.oldPath}</span>
              <span aria-hidden="true"> {'→'} </span>
              <span className="visually-hidden">renamed to</span>
            </>
          )}
          <span>{file.path}</span>
        </span>

        <span className="file-counts">
          <span className="additions">{`+${file.additions}`}</span>
          <span className="deletions">{`${MINUS}${file.deletions}`}</span>
        </span>

        <ViewedCheckbox path={file.path} state={file.viewedState} />
      </div>

      {body.message !== null && (
        <p className="file-note" role="note">
          {body.message}
        </p>
      )}
    </div>
  );
}
