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
 */

import { useEffect, useRef, useState } from 'react';
import type { DraftLocation } from '@/lib/review/drafts';
import type { CommentAnchor } from '@/lib/review/selection';
import type { ComposerRejection } from './composerAnchor';
import { NEW_THREAD, useReviewSession } from './reviewSession';
import { useShortcutTarget } from './shortcutTargets';
import { suggestionBlock } from './suggestion';

/** Long enough not to write on every keystroke, short enough to beat a tab close. */
export const DRAFT_DEBOUNCE_MS = 600;

export interface ComposerProps {
  path: string;
  /** Null when the selection cannot be expressed as a GitHub comment. */
  anchor: CommentAnchor | null;
  rejection: ComposerRejection | null;
  /** The source text of the selected lines, for seeding a suggestion. */
  selectedLines: readonly string[];
  onClose: () => void;
}

const positionLabel = (anchor: CommentAnchor): string =>
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
  const [posting, setPosting] = useState(false);
  const failure = session.failures.get(NEW_THREAD);

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

  const submit = async (): Promise<void> => {
    // `usable` is a boolean rather than a type predicate, so the two nulls are
    // named again here — for the compiler, and for anyone reading this alone.
    if (empty || posting || rejection !== null || anchor === null || location === null) {
      return;
    }
    setPosting(true);
    try {
      // Written before the request, so a failure anywhere after this point
      // still leaves the text on disk. Saving is a convenience and posting is
      // the job, so a storage failure is swallowed rather than allowed to
      // cancel the post — extension storage has a quota, and hitting it must
      // not cost the reviewer the comment they just wrote.
      await save(location, body);
      const posted = await session.postThread({ path, body, anchor });
      if (!posted) return;
      await clear(location);
      onClose();
    } finally {
      // In a `finally` because anything thrown above escapes into a `void`
      // call with nobody to catch it, and the button would stay on "Posting…"
      // for good — with Cancel, which discards the text, the only way out.
      setPosting(false);
    }
  };

  /** Draft bookkeeping, which is never worth failing a post over. */
  const save = (at: DraftLocation, text: string): Promise<void> =>
    session.drafts.save(at, text).catch(() => undefined);
  const clear = (at: DraftLocation): Promise<void> =>
    session.drafts.clear(at).catch(() => undefined);

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
    usable && !empty && !posting
      ? () => {
          void submit();
        }
      : null,
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

      {failure !== undefined && (
        <p role="alert" className="composer-error">
          {failure}
        </p>
      )}

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
          disabled={empty || posting}
          onClick={() => {
            void submit();
          }}
        >
          {posting ? 'Posting…' : queued ? 'Add to review' : 'Comment'}
        </button>
      </div>
    </section>
  );
}
