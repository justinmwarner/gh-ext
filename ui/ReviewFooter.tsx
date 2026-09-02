/**
 * The pending-review bar.
 *
 * On screen only while a review is pending, which is the point: it is the one
 * surface that says queued comments exist at all. A line comment written here
 * is not on the pull request — it is inside a PENDING review that nobody else
 * can see until it is submitted, and a reviewer who closes the tab believing
 * otherwise has lost the lot.
 *
 * Three things it refuses to do:
 *
 * - **Claim a count it does not have.** A review resumed from GitHub arrives
 *   with no comment count, because PULL_REQUEST_QUERY carries none for one that
 *   was already open. "No comments queued" over a review holding nine of them
 *   invites the reviewer to submit an empty-looking review and wonder later
 *   where the comments went. The machine tracks whether the count is complete;
 *   this reads it.
 * - **Offer an approval GitHub will reject.** You cannot approve your own pull
 *   request. Disabling the control with the reason beside it is strictly better
 *   than an opaque 422 after the fact.
 * - **Discard anything quietly.** A failed submit keeps the review exactly as
 *   it was and says so; a deliberate discard asks first, and then deletes the
 *   review on GitHub rather than only forgetting about it here.
 */

import { useState } from 'react';
import type { PendingReviewState } from '@/lib/review/pending-review';
import { REVIEW_SUBMIT, type SubmitEvent, useReviewSession } from './reviewSession';

/**
 * What is queued, said only as far as it is known.
 *
 * The "at least" wording is doing real work: for a resumed review the count is
 * a floor made of this session's comments, not a total.
 */
export function pendingCountLabel(pending: {
  commentCount: number;
  countIsComplete: boolean;
}): string {
  const { commentCount, countIsComplete } = pending;

  if (countIsComplete) {
    if (commentCount === 0) return 'No comments queued yet';
    return `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'} queued`;
  }

  if (commentCount === 0) {
    return 'This review was already open on GitHub, so how many comments it holds is unknown';
  }
  return `At least ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'} — ${commentCount} queued here, plus anything already on this review`;
}

const APPROVE_BLOCKED = 'GitHub does not allow approving your own pull request.';

interface SubmitAction {
  event: SubmitEvent;
  label: string;
  className: string;
}

const ACTIONS: readonly SubmitAction[] = [
  { event: 'COMMENT', label: 'Comment', className: 'button' },
  { event: 'APPROVE', label: 'Approve', className: 'button primary' },
  { event: 'REQUEST_CHANGES', label: 'Request changes', className: 'button' },
];

export function ReviewFooter({ viewerIsAuthor }: { viewerIsAuthor: boolean }) {
  const session = useReviewSession();
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const pending: PendingReviewState = session.pending;
  const failure = session.failures.get(REVIEW_SUBMIT);

  // Nothing is queued, so there is nothing to submit and no bar to show.
  if (pending.kind !== 'pending') return null;

  const submit = (event: SubmitEvent) => {
    if (busy) return;
    setBusy(true);
    void session.submitReview(event, summary).finally(() => {
      // The component unmounts on success, so this only ever runs after a
      // failure — where the summary is deliberately kept, not cleared.
      setBusy(false);
    });
  };

  const discard = () => {
    if (busy) return;
    setBusy(true);
    void session.discardReview().finally(() => {
      setBusy(false);
      setConfirming(false);
    });
  };

  return (
    <footer className="review-footer" aria-label="Pending review">
      <div className="review-footer-row">
        <span className="review-count">{pendingCountLabel(pending)}</span>

        <textarea
          className="review-summary-input"
          aria-label="Review summary (optional)"
          placeholder="Summary (optional)"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />

        <div className="review-footer-actions">
          {ACTIONS.map((action) => {
            const blocked = action.event === 'APPROVE' && viewerIsAuthor;
            return (
              <button
                key={action.event}
                type="button"
                className={action.className}
                disabled={busy || blocked}
                title={blocked ? APPROVE_BLOCKED : undefined}
                onClick={() => submit(action.event)}
              >
                {action.label}
              </button>
            );
          })}

          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Discard
          </button>
        </div>
      </div>

      {viewerIsAuthor && (
        <p className="review-note" role="note">
          {APPROVE_BLOCKED}
        </p>
      )}

      {confirming && (
        <div className="review-confirm" role="group" aria-label="Discard this review">
          <p>
            {`Discarding deletes this review and everything queued on it, on GitHub as well as here. ${
              pending.countIsComplete
                ? ''
                : 'It may hold comments this page has never seen. '
            }This cannot be undone.`}
          </p>
          <button type="button" className="button danger" onClick={discard}>
            Discard the review
          </button>
          <button type="button" className="button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      )}

      {failure !== undefined && (
        <p className="review-error" role="alert">
          {failure}
        </p>
      )}
    </footer>
  );
}
