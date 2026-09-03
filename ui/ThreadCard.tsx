/**
 * One review thread.
 *
 * Rendered in two places from one component: slotted into the diff as a Pierre
 * annotation, and listed in the per-file section for threads the diff cannot
 * show. Those are the same conversation and they read the same way.
 *
 * Comment bodies are Markdown and are drawn here as **plain text**. This
 * project takes no new dependencies and will not hand-roll a Markdown parser,
 * so `**bold**` shows its asterisks. The single exception is the suggestion
 * fence, which is pulled out and shown as the proposed replacement it is —
 * that is the content of the comment, not its formatting.
 *
 * Permission flags disable controls rather than hiding them or letting the
 * mutation fail: a reviewer who cannot resolve should be able to see that they
 * cannot, not discover it from an error.
 */

import { useState } from 'react';
import type { ReviewComment, ReviewThread } from '@/lib/github/types';
import { threadPosition } from './reviewThreads';
import { useReviewSession } from './reviewSession';
import { useShortcutTarget } from './shortcutTargets';
import { splitBody } from './suggestion';

/** The instant, machine-readable; the words, however the reader's OS says them. */
function formatTimestamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Body({ comment }: { comment: ReviewComment }) {
  const parts = splitBody(comment.body);

  return (
    <div className="comment-body">
      {parts.map((part, index) =>
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
            {comment.url !== '' && (
              <a className="suggestion-apply" href={comment.url}>
                Apply on GitHub
              </a>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function Comment({ comment }: { comment: ReviewComment }) {
  return (
    <li className="comment">
      <div className="comment-head">
        <span className="comment-author">{comment.author?.login ?? 'Unknown user'}</span>
        <time dateTime={comment.createdAt}>{formatTimestamp(comment.createdAt)}</time>
      </div>
      <Body comment={comment} />
    </li>
  );
}

function ReplyBox({ thread }: { thread: ReviewThread }) {
  const session = useReviewSession();
  const [body, setBody] = useState('');
  const [focused, setFocused] = useState(false);
  const inFlight = session.sending.has(thread.id);
  const empty = body.trim() === '';

  const send = () => {
    if (empty || inFlight) return;
    void session.reply(thread.id, body).then((posted) => {
      // Only clear on success. Throwing away what someone wrote because
      // the network blinked is not a recoverable mistake.
      if (posted) setBody('');
    });
  };

  /**
   * `Mod+Enter` posts *this* reply — but only while the cursor is in it.
   *
   * Claimed on focus rather than on mount, and that is the whole point. A
   * composer may be open on some other file at the same time, and it claims the
   * same chord; without the focus condition, pressing it here would post that
   * comment instead. Whichever box the reviewer is actually typing in claims
   * last, and the last claim wins.
   */
  useShortcutTarget(
    'submit-comment',
    focused && thread.viewerCanReply && !empty && !inFlight ? send : null,
  );

  return (
    <form
      className="thread-reply"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        className="thread-reply-input"
        // How `r` finds this box. A thread is rendered by this one component
        // in three places — anchored in the diff, listed in the per-file
        // section, and inside a closed <details> — so an attribute is the only
        // handle that works from all of them.
        data-reply-for={thread.id}
        aria-label={`Reply to the thread on ${thread.path}`}
        value={body}
        disabled={!thread.viewerCanReply}
        onChange={(event) => setBody(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={
          thread.viewerCanReply ? 'Reply…' : 'You cannot reply to this thread.'
        }
      />
      <button
        type="submit"
        className="button"
        disabled={!thread.viewerCanReply || empty || inFlight}
      >
        {inFlight ? 'Replying…' : 'Reply'}
      </button>
    </form>
  );
}

function ResolveButton({ thread }: { thread: ReviewThread }) {
  const session = useReviewSession();
  const next = !thread.isResolved;
  const allowed = next ? thread.viewerCanResolve : thread.viewerCanUnresolve;
  // The session refuses a second one anyway; this is so the refusal is
  // visible. A control that accepts a click and does nothing reads as broken,
  // and the viewed checkbox next to it already says busy the same way.
  const inFlight = session.resolveInFlight.has(thread.id);

  return (
    <button
      type="button"
      className="button thread-resolve"
      disabled={!allowed || inFlight}
      title={allowed ? undefined : 'You do not have permission to do this.'}
      onClick={() => {
        void session.setResolved(thread.id, next);
      }}
    >
      {next ? 'Resolve conversation' : 'Unresolve conversation'}
    </button>
  );
}

function ThreadBody({ thread }: { thread: ReviewThread }) {
  const session = useReviewSession();
  const failure = session.failures.get(thread.id);
  const sending = session.sending.get(thread.id);
  const withheld = thread.comments.totalCount - thread.comments.nodes.length;
  const first = thread.comments.nodes[0];

  return (
    <>
      <ol className="thread-comments">
        {thread.comments.nodes.map((comment) => (
          <Comment comment={comment} key={comment.id} />
        ))}
        {sending !== undefined && (
          <li className="comment comment-sending">
            <div className="comment-head">
              <span className="comment-author">You</span>
              <span className="comment-pending">Sending…</span>
            </div>
            <div className="comment-body">
              <p className="comment-text">{sending}</p>
            </div>
          </li>
        )}
      </ol>

      {withheld > 0 && first !== undefined && (
        <p className="thread-more" role="note">
          {`${withheld} more ${withheld === 1 ? 'comment' : 'comments'} on this thread. `}
          <a href={first.url}>Read them on GitHub</a>
        </p>
      )}

      {failure !== undefined && (
        <p className="thread-error" role="alert">
          {failure}
        </p>
      )}

      <div className="thread-actions">
        <ResolveButton thread={thread} />
      </div>

      <ReplyBox thread={thread} />
    </>
  );
}

export function ThreadCard({ threadId }: { threadId: string }) {
  const session = useReviewSession();
  const thread = session.byId.get(threadId);
  // A thread can leave state while its annotation row is still mounted.
  if (thread === undefined) return null;

  const position = threadPosition(thread);
  const count = thread.comments.totalCount;

  /**
   * Held back inside the pending review, so nobody else can see it.
   *
   * A thread renders identically whether its comments are live or queued, and
   * the person who wrote them has no reason to assume they did not go out. The
   * badge is words rather than only a colour, and carries the remedy in its
   * title — "pending" alone does not tell anyone what to do about it.
   */
  const unposted = session.unpublished.has(thread.id);

  const header = (
    <>
      <span className="thread-position">{position}</span>
      {thread.isOutdated && <span className="thread-flag">Outdated</span>}
      {unposted && (
        <span
          className="thread-flag thread-flag-unposted"
          title="This is part of your pending review. Nobody else can see it until you submit the review."
        >
          Not posted yet
        </span>
      )}
    </>
  );

  if (thread.isResolved) {
    // One line until asked. A resolved thread is settled business and should
    // not take up the room an open one does.
    return (
      <details
        className={`thread thread-resolved${unposted ? ' thread-unpublished' : ''}`}
        data-thread={thread.id}
      >
        <summary>
          <span className="thread-flag">Resolved</span>
          {header}
          <span className="thread-count">
            {`${count} ${count === 1 ? 'comment' : 'comments'}`}
          </span>
        </summary>
        <ThreadBody thread={thread} />
      </details>
    );
  }

  return (
    <article
      className={`thread${unposted ? ' thread-unpublished' : ''}`}
      data-thread={thread.id}
    >
      <header className="thread-head">{header}</header>
      <ThreadBody thread={thread} />
    </article>
  );
}
