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
 * Permission flags never let a mutation fail that could have been prevented,
 * but they are honoured two different ways and the difference is what the
 * absence would mean:
 *
 * - **Thread controls are disabled.** Reply and Resolve are offered once, to
 *   every reader of the thread. A disabled Resolve says "not you", which is
 *   information; removing it would leave a reviewer wondering where it went.
 * - **Comment controls are absent.** Edit and Delete belong to the author of
 *   the comment they sit on. On the four comments in a thread that somebody
 *   else wrote, a disabled Delete says nothing at all — it is six words of
 *   clutter per comment, in the way of the conversation. Same rule as the
 *   onion-skin mode that is not offered for a one-sided image.
 */

import { useId, useState } from 'react';
import type { ReviewComment, ReviewThread } from '@/lib/github/types';
import { threadPosition } from './reviewThreads';
import { commentKey, useReviewSession } from './reviewSession';
import { useShortcutTarget } from './shortcutTargets';
import { splitBody } from './suggestion';
import { formatTimestamp } from './timestamp';

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

/**
 * The comment's body, swapped for a box holding the same words.
 *
 * Seeded from the comment rather than starting empty, because
 * `updatePullRequestReviewComment` replaces the body outright — an editor that
 * opened blank would make Save an erase. The draft is local to this component
 * and outlives a failed save on purpose: the words the reviewer meant are then
 * the only copy of them anywhere, and closing the box would throw them away
 * while the wrong body is still what everyone else reads.
 */
function CommentEditor({
  comment,
  onDone,
}: {
  comment: ReviewComment;
  onDone: () => void;
}) {
  const session = useReviewSession();
  const [body, setBody] = useState(comment.body);
  const inFlight = session.commentInFlight.has(comment.id);
  // An empty body is not an edit, it is a deletion done the wrong way round —
  // and there is a control for that beside this one.
  const empty = body.trim() === '';

  return (
    <form
      className="comment-edit"
      onSubmit={(event) => {
        event.preventDefault();
        if (empty || inFlight) return;
        void session.editComment(comment.id, body).then((saved) => {
          if (saved) onDone();
        });
      }}
    >
      <textarea
        className="comment-edit-input"
        aria-label="Edit this comment"
        value={body}
        disabled={inFlight}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="comment-edit-actions">
        <button type="submit" className="button" disabled={empty || inFlight}>
          {inFlight ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button" disabled={inFlight} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The second confirmation before a comment is destroyed.
 *
 * Inline and in the flow of the thread rather than a dialog, matching the
 * pending review's own discard: the thing being deleted stays visible above the
 * question, so "this one?" is answerable by looking rather than by remembering.
 *
 * The words say where the comment goes and that it does not come back. Unlike
 * an edit, GitHub keeps no earlier version of a deleted comment, so there is
 * nowhere to recover it from — including github.com.
 */
function DeleteConfirm({
  comment,
  onDone,
}: {
  comment: ReviewComment;
  onDone: () => void;
}) {
  const session = useReviewSession();
  const inFlight = session.commentInFlight.has(comment.id);

  return (
    <div className="comment-confirm" role="group" aria-label="Delete this comment">
      <p>This deletes the comment on GitHub, for everyone. It cannot be undone.</p>
      <button
        type="button"
        className="button danger"
        disabled={inFlight}
        onClick={() => {
          void session.deleteComment(comment.id).then((deleted) => {
            // Closed either way. On success this component is unmounted with
            // the comment; on failure the message below explains, and leaving
            // a primed Delete button under it invites a second press at
            // whatever just refused the first.
            if (!deleted) onDone();
          });
        }}
      >
        {inFlight ? 'Deleting…' : 'Delete comment'}
      </button>
      <button type="button" className="button" disabled={inFlight} onClick={onDone}>
        Keep it
      </button>
    </div>
  );
}

function Comment({ comment }: { comment: ReviewComment }) {
  const session = useReviewSession();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const failure = session.failures.get(commentKey(comment.id));
  // One box at a time, and the two entry points withdrawn while either is
  // open. An editor and a delete confirmation side by side ask the reviewer to
  // hold two intentions about the same words at once.
  const boxOpen = editing || confirming;

  return (
    <li className="comment">
      <div className="comment-head">
        <span className="comment-author">{comment.author?.login ?? 'Unknown user'}</span>
        <time dateTime={comment.createdAt}>{formatTimestamp(comment.createdAt)}</time>
        {!boxOpen && (comment.viewerCanUpdate || comment.viewerCanDelete) && (
          <span className="comment-actions">
            {comment.viewerCanUpdate && (
              <button
                type="button"
                className="comment-action"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            )}
            {comment.viewerCanDelete && (
              <button
                type="button"
                className="comment-action comment-action-danger"
                onClick={() => setConfirming(true)}
              >
                Delete
              </button>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <CommentEditor comment={comment} onDone={() => setEditing(false)} />
      ) : (
        <Body comment={comment} />
      )}

      {confirming && (
        <DeleteConfirm comment={comment} onDone={() => setConfirming(false)} />
      )}

      {failure !== undefined && (
        <p className="thread-error" role="alert">
          {failure}
        </p>
      )}
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

/**
 * Why GitHub says no, in the words of the rule it is applying.
 *
 * "You do not have permission to do this" was what this said, and it is the
 * sentence that sends people looking for a bug. It names no rule, so there is
 * nothing to check and nothing to fix — and the reviewer standing in front of
 * it is usually someone who *can* resolve conversations on GitHub in the other
 * tab, using an account this page is reading through a narrower token.
 *
 * GitHub's own rule is short and worth quoting: a conversation may be resolved
 * by someone who opened the pull request, or who has write access to the
 * repository. Saying that gives the reviewer both possible remedies at once.
 * The page-level half of the same explanation is `ReadOnlyNotice`, which is
 * where the token gets named.
 */
const NO_PERMISSION =
  'Only the author of this pull request, or someone with write access to the ' +
  'repository, can resolve its conversations. If that should be you, your ' +
  'token may have less access than your account does.';

function ResolveButton({ thread }: { thread: ReviewThread }) {
  const session = useReviewSession();
  const next = !thread.isResolved;
  const allowed = next ? thread.viewerCanResolve : thread.viewerCanUnresolve;
  // The session refuses a second one anyway; this is so the refusal is
  // visible. A control that accepts a click and does nothing reads as broken,
  // and the viewed checkbox next to it already says busy the same way.
  const inFlight = session.resolveInFlight.has(thread.id);
  const ruleId = useId();

  return (
    <>
      <button
        type="button"
        className="button thread-resolve"
        disabled={!allowed || inFlight}
        title={allowed ? undefined : NO_PERMISSION}
        // A `title` is a pointer affordance and nothing else: no keyboard
        // reaches it, and a disabled button is not in the tab order to be
        // reached from. So the sentence is also an accessible description,
        // which is announced with the button whether or not it can be pressed.
        aria-describedby={allowed ? undefined : ruleId}
        onClick={() => {
          void session.setResolved(thread.id, next);
        }}
      >
        {next ? 'Resolve conversation' : 'Unresolve conversation'}
      </button>
      {/* Hidden rather than printed under the button. It is the same three
          lines on every thread of a pull request nobody can resolve, and a
          reviewer who has read it once does not need twenty more copies down
          the column — `ReadOnlyNotice` is where it is said in the open. */}
      {!allowed && (
        <span className="visually-hidden" id={ruleId}>
          {NO_PERMISSION}
        </span>
      )}
    </>
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
