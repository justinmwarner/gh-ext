/**
 * A comment the reviewer has written, drawn before GitHub has it.
 *
 * The optimistic half of posting. The composer closes on the press and this
 * takes its place on the same line, so the comment is on screen immediately
 * and stays in one position through the three or four round trips publishing
 * one actually costs. When the real thread arrives it replaces this in the
 * same render — see `takeThread` — so the swap is a single re-layout rather
 * than the card appearing beside the composer and the composer then going.
 *
 * It is deliberately shaped like a `ThreadCard`: same outer article, same
 * comment list, the same "You / Sending…" row a reply in flight already uses.
 * A card that changed shape when the server answered would put the flicker
 * back one step further along.
 *
 * **The failed state is the reason this is a component and not a spinner.**
 * Once a post has failed, this card is the only copy of the comment on screen,
 * so it does three things at once: it keeps the words, it says why they are
 * not on GitHub, and it offers the two ways out. Discard is the only control
 * in the application that destroys the reviewer's own writing, which is why it
 * asks first.
 */

import { useState } from 'react';
import type { PostingComment } from '@/lib/review/posting';
import { useReviewSession } from './reviewSession';
import { splitBody } from './suggestion';

/** Where it sits, in the same words `threadPosition` uses for a real thread. */
export function postingPosition(entry: PostingComment): string {
  const { line, startLine } = entry.anchor;
  return startLine !== undefined && startLine !== line
    ? `Lines ${startLine}-${line}`
    : `Line ${line}`;
}

/**
 * The comment's text, read the same way a posted one is.
 *
 * `splitBody` rather than a bare paragraph so a suggestion the reviewer wrote
 * with the Suggest a change button looks the same before and after it lands.
 * There is no Apply link yet, because there is no comment on GitHub to apply.
 */
function PostingBody({ body }: { body: string }) {
  return (
    <div className="comment-body">
      {splitBody(body).map((part, index) =>
        part.kind === 'text' ? (
          <p className="comment-text" key={index}>
            {part.text}
          </p>
        ) : (
          <div className="suggestion" key={index}>
            <p className="suggestion-label">Suggested change</p>
            <pre className="suggestion-code">
              <code>{part.code}</code>
            </pre>
          </div>
        ),
      )}
    </div>
  );
}

export function PostingCard({ postId }: { postId: string }) {
  const session = useReviewSession();
  const entry = session.posting.find((candidate) => candidate.id === postId);
  const [confirming, setConfirming] = useState(false);

  // The entry leaves state the moment the real thread replaces it, which can
  // happen while this annotation row is still mounted.
  if (entry === undefined) return null;

  const failed = entry.error !== null;

  return (
    <article
      className={`thread thread-posting${failed ? ' thread-posting-failed' : ''}`}
      data-posting={entry.id}
    >
      <header className="thread-head">
        <span className="thread-position">{postingPosition(entry)}</span>
        <span className="thread-flag thread-flag-unposted">
          {failed ? 'Not posted' : 'Posting'}
        </span>
      </header>

      <ol className="thread-comments">
        <li className="comment comment-sending">
          <div className="comment-head">
            <span className="comment-author">You</span>
            {!failed && <span className="comment-pending">Sending…</span>}
          </div>
          <PostingBody body={entry.body} />
        </li>
      </ol>

      {failed && (
        <>
          {/* The alert the reviewer is owed. It is on the line they wrote on
              rather than anywhere else on the page, because that is the only
              place that says *which* comment did not go out — a reviewer
              working down a file may have left three. */}
          <p className="thread-error" role="alert">
            {entry.error}
          </p>

          {confirming ? (
            <div
              className="comment-confirm"
              role="group"
              aria-label="Discard this comment"
            >
              <p>
                This throws the comment away, here and in the saved draft. It was
                never posted, so there is nothing on GitHub to recover it from.
              </p>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  session.discardPost(entry.id);
                }}
              >
                Discard comment
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="thread-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  void session.retryPost(entry.id);
                }}
              >
                Post again
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConfirming(true)}
              >
                Discard
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
