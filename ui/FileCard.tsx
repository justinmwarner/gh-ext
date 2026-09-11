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

import { useId } from 'react';
import { modesForFile } from '@/lib/compare/modes';
import type { FileViewedState } from '@/lib/github/types';
import {
  type WhitespaceDiff,
  whitespaceLabel,
  whitespaceNotice,
} from '@/lib/review/whitespace';
import type { HeldBack } from './DiffColumn';
import { ModeSwitcher } from './ModeSwitcher';
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
   * at, and nothing in a diff of code announces that by itself. `FileBody`
   * carries that sentence, which is why there is no longer a control up here
   * — the setting is on the options page, and a header badge saying the same
   * thing as the note directly below it would be the fact twice.
   */
  whitespace: WhitespaceDiff | null;
  /**
   * Which rule this file is being read through, or null for none.
   *
   * Stays set while the reviewer is looking at the file in full: the word is
   * also the control that put it back, so taking it away at the moment it is
   * pressed would strand them.
   */
  held: HeldBack | null;
  /** The reviewer asked to see this one as GitHub sent it. */
  shown: boolean;
  onToggleShown: (path: string) => void;
}

/** What the chip on the head row says, and what pressing it will do. */
interface Flag {
  held: HeldBack;
  label: string;
  title: string;
  /** The long form, for a screen reader — a `title` reaches only a pointer. */
  description: string;
}

const GENERATED =
  'This file looks generated — a lockfile, build output, or something a tool ' +
  'writes — so its diff is folded away rather than sitting between the files ' +
  'somebody wrote. Nothing about it is hidden: the name, the counts and the ' +
  'change type are GitHub’s.';

const flagFor = (
  held: HeldBack | null,
  whitespace: WhitespaceDiff | null,
  shown: boolean,
): Flag | null => {
  if (held === 'generated') {
    return {
      held,
      label: 'Generated',
      title: `${GENERATED} ${shown ? 'Press to fold it away again.' : 'Press to read it anyway.'}`,
      description: GENERATED,
    };
  }

  if (held === 'whitespace' && whitespace !== null) {
    const notice = whitespaceNotice(whitespace);
    return {
      held,
      label: whitespaceLabel(whitespace, shown),
      title: `${notice} ${shown ? 'Press to hide it again.' : 'Press to see GitHub’s diff for this file.'}`,
      description: notice,
    };
  }

  return null;
};

export function FileCard({
  file,
  collapsed,
  onToggleCollapsed,
  onHeaderRef,
  mode,
  onChangeMode,
  whitespace,
  held,
  shown,
  onToggleShown,
}: FileCardProps) {
  const flag = flagFor(held, whitespace, shown);
  const flagId = useId();
  // Nothing to collapse: the card is already only its header, and a toggle
  // that reveals an empty rectangle is a lie about there being more to see. A
  // file whose every change was whitespace is in exactly that state, unless
  // the reviewer has asked to see it, in which case GitHub's own patch is back
  // and there is something under there.
  //
  // A rich card used to be excluded here on the same reasoning, and no longer
  // is: its comparison was in the header then and is a measured annotation
  // now, so there really is something below to fold away. Marking a screenshot
  // viewed has to fold it like anything else, and a card that folds with no
  // way back is worse than one that never folds.
  const emptied = whitespace?.hunks === 0 && !shown;
  const collapsible = !emptied;
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

        {/* On the head row, beside the counts, because that is the row a
            reviewer reads to decide whether to look at this file at all — and
            because the row cannot grow. `ModeSwitcher` draws nothing for an
            ordinary source file, so a line of its own would add a row to every
            card in the column, and the height of these headers is what decides
            which files `CodeView` virtualizes in and where `topmostFile` says
            the reviewer is.

            A button rather than a label, and the same one for both rules: it
            says what is being kept back and it is how the reviewer gets it. A
            separate "show anyway" beside the word would be two controls for one
            thought, and putting it on the collapse chevron instead would mean
            the chevron did something different on these cards than on every
            other one.

            The visible words are hidden from a screen reader and the whole
            sentence given instead — "Whitespace hidden. Whitespace ignored,
            this diff was recomputed here…" is the same fact twice before the
            useful half arrives. */}
        {flag !== null && (
          <>
            <button
              type="button"
              className="whitespace-flag"
              data-held={flag.held}
              aria-pressed={shown}
              title={flag.title}
              // Described rather than named by the long form. The name of a
              // button is what a screen reader reads on the way past it and
              // announces on every press; three sentences there would bury the
              // two words that say which file this is about.
              aria-describedby={flagId}
              onClick={() => onToggleShown(file.path)}
            >
              {flag.label}
            </button>
            {/* Outside the button, or it would be part of the name after all. */}
            <span className="visually-hidden" id={flagId}>
              {flag.description}
            </span>
          </>
        )}

        <ViewedCheckbox path={file.path} state={file.viewedState} />
      </div>

      {/* Folded away with the body it changes.

          It used to stay, on the reasoning that a folded card still has to
          offer it — but the choice is about what the body shows, and offering
          it over a card with no body on screen is a control whose whole effect
          is hidden. Marking a file viewed folds it now, so leaving the
          switcher up would put a row of buttons under every file the reviewer
          has finished with, which is most of them by the end of a review.
          It comes back with the body, on the press that asked for it.

          It also takes the card's header from 70px to the 44px `CodeView`
          assumes — see `lib/review/columnTail.ts`, which is where that
          number's consequences are written down. */}
      {!collapsed && (
        <ModeSwitcher
          path={file.path}
          modes={modes}
          current={mode}
          onChange={onChangeMode}
        />
      )}
    </div>
  );
}
