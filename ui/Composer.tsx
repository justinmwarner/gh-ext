/**
 * Writing a comment: on a line, on a range of them, or on the file.
 *
 * Anchored the same way a thread is — as a Pierre annotation on the end line of
 * the selection, or as a sibling of the block it was opened beside in the
 * rendered Markdown view — so the box opens where the reviewer pressed instead
 * of in a panel somewhere else.
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
import { type DraftLocation, draftKey } from '@/lib/review/drafts';
import type { CommentAnchor } from '@/lib/review/selection';
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
   * A `CommentAnchor`, so a comment about the file arrives here the same way a
   * comment about a line does. This was narrowed to `LineAnchor` for one task,
   * because the gutter was then the only way in and a draft had no key for
   * anything else; the rendered Markdown view is the second way in and
   * `draftKey` now answers for both. Widening rather than growing a second
   * composer is the decision — there is one place a comment is written, and it
   * says what it is about instead of assuming.
   */
  anchor: CommentAnchor | null;
  rejection: ComposerRejection | null;
  /** The source text of the selected lines, for seeding a suggestion. */
  selectedLines: readonly string[];
  /**
   * What the box opens holding, when the caller has something worth quoting.
   *
   * A comment about a whole file says nothing about which part of it, so the
   * rendered Markdown view seeds a blockquote of the block the reviewer
   * pressed. A stored draft outranks it: the seed is a starting point, and
   * words somebody actually typed are not.
   */
  seed?: string;
  onClose: () => void;
}

/**
 * Where this comment will land, in the words the thread header uses.
 *
 * "Whole file" is `threadPosition`'s own wording for a thread GitHub sent with
 * `subjectType: FILE`, and a comment on its way to becoming one should not be
 * described differently from the thread it turns into.
 */
const positionLabel = (anchor: CommentAnchor): string =>
  anchor.subject === 'file'
    ? 'Whole file'
    : anchor.startLine !== undefined && anchor.startLine !== anchor.line
      ? `Lines ${anchor.startLine}-${anchor.line}`
      : `Line ${anchor.line}`;

/**
 * Said before the reviewer types, never after.
 *
 * A file comment written beside a rendered paragraph looks like a comment on
 * that paragraph and is not one: GitHub files it against the path, and a
 * reader on github.com meets it at the top of the file with no prose attached.
 * That is worth knowing while there is still time to write it differently,
 * which is why it sits above the box rather than in a confirmation after.
 */
const FILE_SCOPE =
  'This block has no line in the pull request’s diff, so the comment will be ' +
  'left on the file as a whole rather than on a line.';

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
  seed = '',
  onClose,
}: ComposerProps) {
  const session = useReviewSession();
  const [body, setBody] = useState(seed);
  const location: DraftLocation | null =
    anchor === null ? null : { prId: session.prId, path, anchor };

  /**
   * Whether what is on screen came from the reviewer or from this component.
   *
   * A draft arriving a tick after mount used to be dropped when the box was
   * not empty, which was the same question while the box only ever started
   * empty. A seed makes the two differ, and the one that matters is
   * authorship: a stored draft must beat a quote written here and lose to a
   * sentence somebody is in the middle of.
   */
  const typed = useRef(false);

  // Read inside the debounce timer, the unmount flush and the submit handler,
  // all of which run after the render that created them.
  const latest = useRef({ body, location, drafts: session.drafts });
  latest.current = { body, location, drafts: session.drafts };

  const key = location === null ? null : draftKey(location);

  useEffect(() => {
    if (location === null) return;
    let live = true;
    void session.drafts.load(location).then((saved) => {
      if (live && saved !== null && saved !== '' && !typed.current) setBody(saved);
    });
    return () => {
      live = false;
    };
    // Keyed on `key` rather than on `location`, which is a fresh object every
    // render and would re-run this on each keystroke.
  }, [key]);

  // The seed is not a draft. Writing it back would fill storage with quotes of
  // paragraphs nobody has said anything about yet, and would then hand the
  // next composer a "draft" it wrote itself.
  useEffect(() => {
    if (location === null || body === '' || body === seed) return;
    const timer = setTimeout(() => {
      void latest.current.drafts.save(location, body);
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [key, body, seed]);

  /**
   * The last write, on the way out.
   *
   * Closing this box must not cost what is in it — that is the whole of what
   * the draft store is for — and the debounce above is a timer this component
   * cancels as it unmounts. Without a flush, a comment closed within
   * {@link DRAFT_DEBOUNCE_MS} of the last keystroke is gone, which is exactly
   * the case where somebody typed a line and immediately moved to a better
   * place to type it. Cancelling is still allowed to mean cancelling: a body
   * cleared to whitespace saves as a clear.
   *
   * Empty deps deliberately. This is the unmount rather than a dependency of
   * anything, and everything it needs is read out of the ref as it runs.
   */
  useEffect(
    () => () => {
      const { body: last, location: at, drafts } = latest.current;
      if (at === null || !typed.current) return;
      void drafts.save(at, last).catch(() => undefined);
    },
    [],
  );

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

      {anchor.subject === 'file' && (
        <p className="composer-scope" role="note">
          {FILE_SCOPE}
        </p>
      )}

      <textarea
        className="composer-input"
        aria-label={`Comment on ${path}, ${positionLabel(anchor).toLowerCase()}`}
        value={body}
        autoFocus
        onChange={(event) => {
          typed.current = true;
          setBody(event.target.value);
        }}
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
            typed.current = true;
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
