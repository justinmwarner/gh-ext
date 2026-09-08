/**
 * The header of one diff card.
 *
 * `@pierre/diffs` renders the code into a shadow root, but header content goes
 * in through a slot as ordinary React in ordinary light DOM — so this is plain
 * markup with plain event handlers, positioned by the shadow row and styled by
 * the page.
 *
 * It carries the four things §5 asks for: the path, the added and removed
 * counts, the viewed checkbox, and the collapse toggle, plus the controls that
 * change what the card shows.
 *
 * **Everything here is fixed height, and that is a hard constraint rather than
 * a style.** `CodeView` sizes an item from one global header metric and never
 * measures this element, so a card that renders taller than the metric is
 * scroll range the viewer does not know about — and it lurches by that
 * difference each time it releases the card while scrolling. Anything whose
 * height depends on the file belongs in `FileBody`, which is rendered as an
 * annotation and therefore measured. `lib/review/columnTail.ts` has the
 * numbers.
 */

import { RAW, modesForFile } from '@/lib/compare/modes';
import type { FileViewedState } from '@/lib/github/types';
import type { WhitespaceDiff } from '@/lib/review/whitespace';
import { ModeSwitcher } from './ModeSwitcher';
import { fileBody } from './diffItems';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession, viewedKey } from './reviewSession';

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
  /** How this file is being compared. Already resolved against what it offers. */
  mode: string;
  onChangeMode: (path: string, mode: string) => void;
  /**
   * The rewrite this file is being read through, or null for GitHub's diff.
   *
   * Non-null is the state that has to be visible from across the room: the
   * body below is then not what anyone else on this pull request is looking
   * at, and nothing in a diff of code announces that by itself.
   */
  whitespace: WhitespaceDiff | null;
  onToggleWhitespace: (path: string) => void;
}

export function FileCard({
  file,
  collapsed,
  onToggleCollapsed,
  onHeaderRef,
  mode,
  onChangeMode,
  whitespace,
  onToggleWhitespace,
}: FileCardProps) {
  const body = fileBody(file);
  const raw = mode === RAW.id;
  /**
   * There is a text diff here to have an opinion about.
   *
   * Read off GitHub's patch rather than off what is drawn, so the control does
   * not vanish at the moment it is used: a file whose every change was
   * whitespace has an empty body once this is on, and a toggle that removed
   * itself would leave the reviewer no way back.
   */
  const textDiff = raw && body.kind === 'diff';
  // Nothing to collapse: the card is already only its header, and a toggle that
  // reveals an empty rectangle is a lie about there being more to see. A card in
  // a rich mode is in exactly that state — its body is the comparison below,
  // and the collapse toggle would be pointing at nothing. So is a file the
  // recompute emptied.
  const collapsible = textDiff && whitespace?.hunks !== 0;
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

        {/* On the head row rather than on a line of its own, and that is a
            constraint rather than a preference. Every card in the column would
            have grown by a row — `ModeSwitcher` draws nothing for an ordinary
            source file — and the height of these headers is what decides which
            files `CodeView` virtualizes in and where `topmostFile` says the
            reviewer is. One extra row of chrome has already moved that once.

            Only where there is a text diff to take the whitespace out of: on a
            binary, a withheld patch or a rich comparison it would be a button
            with nothing behind it. */}
        {textDiff && (
          <button
            type="button"
            className="whitespace-toggle"
            // `aria-pressed` rather than a class, for the same reason the mode
            // buttons use it: this one changes what the card shows, and a
            // visual-only toggle says nothing to a screen reader.
            aria-pressed={whitespace !== null}
            title="Hide changes where only the indentation or spacing moved."
            onClick={() => onToggleWhitespace(file.path)}
          >
            Ignore whitespace
          </button>
        )}

        <ViewedCheckbox path={file.path} state={file.viewedState} />
      </div>

      <ModeSwitcher
        path={file.path}
        modes={modes}
        current={mode}
        onChange={onChangeMode}
      />

    </div>
  );
}
