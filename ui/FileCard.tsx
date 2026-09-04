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

import { RAW, modesForFile } from '@/lib/compare/modes';
import type { FileViewedState } from '@/lib/github/types';
import type { BlobRefs } from './blobLoader';
import { ModeSwitcher } from './ModeSwitcher';
import { RichCompare } from './RichCompare';
import { UnanchoredThreads } from './UnanchoredThreads';
import { fileBody } from './diffItems';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession, viewedKey } from './reviewSession';
import type { ListedThread } from './reviewThreads';

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
 * This is GitHub's own viewed state, not a local one: a tick here shows up on
 * github.com, and one made there arrives in the payload. Optimistic, and a
 * failure puts back exactly what was displaced — including `DISMISSED`, which
 * rolling back to `UNVIEWED` would quietly erase.
 */
function ViewedCheckbox({
  path,
  state,
}: {
  path: string;
  state: FileViewedState;
}) {
  const session = useReviewSession();
  // The optimistic layer wins where it has an entry; everywhere else the
  // payload's value stands.
  const current = session.viewed.get(path) ?? state;
  const dismissed = current === 'DISMISSED';
  const inFlight = session.viewedInFlight.has(path);
  const failure = session.failures.get(viewedKey(path));

  return (
    <>
      <label className="viewed" data-viewed-state={current}>
        <input
          type="checkbox"
          checked={current === 'VIEWED'}
          ref={(node) => {
            // `indeterminate` is a DOM property with no HTML attribute, so it
            // cannot be set from JSX.
            if (node !== null) node.indeterminate = dismissed;
          }}
          disabled={inFlight}
          aria-label={`Mark ${path} as viewed`}
          onChange={(event) => {
            // `current`, not `state`: what goes back on failure is what the
            // reviewer was actually looking at.
            void session.setViewed(path, event.target.checked, current);
          }}
        />
        <span>Viewed</span>
        {dismissed && <span className="viewed-note">changed since</span>}
      </label>
      {failure !== undefined && (
        <p className="viewed-error" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}

export interface FileCardProps {
  file: ReviewFile;
  collapsed: boolean;
  onToggleCollapsed: (path: string) => void;
  /** Called with the header element so the column can tell where it sits. */
  onHeaderRef: (path: string, node: HTMLElement | null) => void;
  /**
   * Threads on this file that the diff cannot draw. They live in the header
   * rather than the body because the body is exactly what cannot hold them —
   * and because the header is rendered even when the card is collapsed.
   */
  unanchored: readonly ListedThread[];
  /** How this file is being compared. Already resolved against what it offers. */
  mode: string;
  onChangeMode: (path: string, mode: string) => void;
  /** The two commits a rich comparison reads whole files from. */
  blobs: BlobRefs | null;
}

export function FileCard({
  file,
  collapsed,
  onToggleCollapsed,
  onHeaderRef,
  unanchored,
  mode,
  onChangeMode,
  blobs,
}: FileCardProps) {
  const body = fileBody(file);
  const raw = mode === RAW.id;
  // Nothing to collapse: the card is already only its header, and a toggle that
  // reveals an empty rectangle is a lie about there being more to see. A card in
  // a rich mode is in exactly that state — its body is the comparison below,
  // and the collapse toggle would be pointing at nothing.
  const collapsible = raw && body.kind === 'diff';
  const modes = modesForFile(file);

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

      <ModeSwitcher
        path={file.path}
        modes={modes}
        current={mode}
        onChange={onChangeMode}
      />

      {/* The sentence explaining an absent diff belongs to the raw view alone.
          Left on, a PNG in its side-by-side comparison would carry "Binary
          file changed. There is no text diff to show" directly above the two
          images that are showing it. */}
      {raw && body.message !== null && (
        <p className="file-note" role="note">
          {body.message}
        </p>
      )}

      <RichCompare file={file} mode={mode} refs={blobs} />

      <UnanchoredThreads path={file.path} threads={unanchored} />
    </div>
  );
}
