/**
 * Writing a comment on a line, or a range of them.
 *
 * Anchored the same way a thread is — as a Pierre annotation on the end line of
 * the selection — so the box opens where the reviewer clicked instead of in a
 * panel somewhere else.
 *
 * Two failures of `normalizeSelection` reach here, and both get an explanation
 * rather than a refusal:
 *
 * - `cross-side`: Pierre can express a drag that starts in the old file and
 *   ends in the new one. GitHub cannot represent such a comment at all, so the
 *   reviewer is told what to do instead of watching a request fail.
 * - `invalid-range`: a malformed range. It should not come out of the gutter,
 *   but the alternative to catching it is `line: NaN` on the wire and an opaque
 *   422 in reply.
 *
 * The draft is written on a pause and again immediately before posting, and is
 * cleared only once GitHub has the comment. A failed mutation must never
 * discard what someone typed.
 *
 * **The post is not awaited.** This box closes on the press and the comment
 * appears on the line in its place, because publishing one is three round
 * trips and sometimes four and nobody should watch them. `session.postThread`
 * owns everything after that, including clearing the draft — it is the half
 * that learns whether GitHub took the comment, and it keeps the words on
 * screen if it did not.
 */

import { useEffect, useRef, useState } from 'react';
import type { DraftLocation } from '@/lib/review/drafts';
import type { LineAnchor } from '@/lib/review/selection';
import type { ComposerRejection } from './composerAnchor';
import { useReviewSession } from './reviewSession';
import { useShortcutTarget } from './shortcutTargets';
import { suggestionBlock } from './suggestion';

/** Long enough not to write on every keystroke, short enough to beat a tab close. */
export const DRAFT_DEBOUNCE_MS = 600;

export interface ComposerProps {
  path: string;
  /**
   * Null when the selection cannot be expressed as a GitHub comment.
   *
   * Narrowed to a line anchor deliberately, though a comment may now be about
   * the file. The box is opened from the gutter and nowhere else, so a file
   * anchor cannot reach it — and a draft is keyed by `prId:path:line:side`, so
   * accepting one would mean inventing a storage key for a composer nothing
   * can open. That key is worth deciding once there is an affordance to test
   * it against, rather than here.
   */
  anchor: LineAnchor | null;
  rejection: ComposerRejection | null;
  /** The source text of the selected lines, for seeding a suggestion. */
  selectedLines: readonly string[];
  onClose: () => void;
}

const positionLabel = (anchor: LineAnchor): string =>
  anchor.startLine !== undefined && anchor.startLine !== anchor.line
    ? `Lines ${anchor.startLine}-${anchor.line}`
    : `Line ${anchor.line}`;

const REJECTIONS: Record<ComposerRejection, string> = {
  'cross-side':
    'That selection covers both sides of the diff. GitHub comments live on ' +
    'one side or the other, so select lines from only the removed side or ' +
    'only the added side and try again.',
  'invalid-range':
    'That selection could not be read as a range of lines, so there is ' +
    'nothing to attach a comment to. Try selecting the lines again.',
  // The only one of the three the reviewer can clear without changing their
  // selection, so it says how.
  'other-commit':
    'This diff is between two commits of the pull request, and a GitHub ' +
    'comment is anchored to a line of the pull request as a whole — there is ' +
    'no way to say which commit a line number was counted in. Show all ' +
    'commits to comment on this line.',
};

export function Composer({
  path,
  anchor,
  rejection,
  selectedLines,
  onClose,
}: ComposerProps) {
  const session = useReviewSession();
  const [body, setBody] = useState('');
  const location: DraftLocation | null =
    anchor === null
      ? null
      : { prId: session.prId, path, line: anchor.line, side: anchor.side };

  // Read inside the debounce timer and the submit handler, both of which run
  // after the render that created them.
  const latest = useRef({ body, location, drafts: session.drafts });
  latest.current = { body, location, drafts: session.drafts };

  const key = location === null ? null : `${location.path}:${location.line}:${location.side}`;

  useEffect(() => {
    if (location === null) return;
    let live = true;
    void session.drafts.load(location).then((saved) => {
      // A draft that arrives after the reviewer has started typing is stale by
      // definition; dropping it is better than overwriting live text.
      if (live && saved !== null && saved !== '') {
        setBody((current) => (current === '' ? saved : current));
      }
    });
    return () => {
      live = false;
    };
    // Keyed on `key` rather than on `location`, which is a fresh object every
    // render and would re-run this on each keystroke.
  }, [key]);

  useEffect(() => {
    if (location === null || body === '') return;
    const timer = setTimeout(() => {
      void latest.current.drafts.save(location, body);
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [key, body]);

  const empty = body.trim() === '';
  const usable = anchor !== null && rejection === null && location !== null;

  /**
   * Hand the comment over and get out of the way.
   *
   * Nothing is awaited, and that is the change this whole box exists around.
   * Publishing a single comment is three round trips and often four, and this
   * used to sit on "Posting…" through all of them — with the finished thread
   * arriving from the *second*, so the line held the comment and the composer
   * showing the same words at the same time, and then re-laid out again when
   * the box finally closed.
   *
   * `postThread` puts the comment on the line before it awaits anything, so
   * closing here is not a guess about what GitHub will say. If the post fails,
   * the entry it left behind keeps the words, carries the reason, and offers
   * to send them again — see `PostingCard`. There is nothing left for this
   * component to report, which is why there is no longer a `posting` state.
   */
  const submit = (): void => {
    // `usable` is a boolean rather than a type predicate, so the two nulls are
    // named again here — for the compiler, and for anyone reading this alone.
    if (empty || rejection !== null || anchor === null || location === null) return;

    // Written before the request, and no longer cleared here. A draft is the
    // copy that survives the tab closing, so it is the session — which knows
    // whether GitHub took the comment — that decides when it may go.
    // Deliberately not awaited either: extension storage has a quota, and
    // hitting it must not cost the reviewer the comment they just wrote.
    void session.drafts.save(location, body).catch(() => undefined);
    void session.postThread({ path, body, anchor });
    onClose();
  };

  /**
   * `Mod+Enter` posts this comment.
   *
   * The one shortcut that deliberately fires while the reviewer is typing —
   * it exists to submit from inside the box, and a chord holding the platform
   * modifier cannot be typed by accident. Claimed only while there is
   * something postable, so the key falls back to the browser otherwise.
   */
  useShortcutTarget(
    'submit-comment',
    usable && !empty ? submit : null,
  );

  if (anchor === null || rejection !== null) {
    return (
      <section className="composer composer-rejected" data-composer={path}>
        <p role="alert" className="composer-error">
          {REJECTIONS[rejection ?? 'invalid-range']}
        </p>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </section>
    );
  }

  const queued = session.pending.kind === 'pending';
  const target = queued
    ? 'Queued on your pending review — not posted until you submit it.'
    : 'Posts immediately, as a single comment.';

  return (
    <section className="composer" data-composer={path}>
      <header className="composer-head">
        <span className="composer-position">{positionLabel(anchor)}</span>
        <span className={`composer-target${queued ? ' composer-target-queued' : ''}`}>
          {target}
        </span>
      </header>

      <textarea
        className="composer-input"
        aria-label={`Comment on ${path}, ${positionLabel(anchor).toLowerCase()}`}
        value={body}
        autoFocus
        onChange={(event) => setBody(event.target.value)}
      />

      <div className="composer-actions">
        <button
          type="button"
          className="button"
          disabled={selectedLines.length === 0}
          title={
            selectedLines.length === 0
              ? 'The text of those lines is not in the diff, so a suggestion ' +
                'would propose deleting them.'
              : undefined
          }
          onClick={() => {
            setBody((current) =>
              current === ''
                ? suggestionBlock(selectedLines)
                : `${current.replace(/\n*$/, '\n\n')}${suggestionBlock(selectedLines)}`,
            );
          }}
        >
          Suggest a change
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary composer-post"
          disabled={empty}
          onClick={submit}
        >
          {queued ? 'Add to review' : 'Comment'}
        </button>
      </div>
    </section>
  );
}
