/**
 * The sticky top bar.
 *
 * Everything in it is already in the payload, so none of it is a placeholder.
 *
 * It also owns the one half of the review flow the footer cannot: the footer
 * exists only while a review is pending, so the control that *opens* one — and
 * the failure message when GitHub refuses — has to live somewhere that is
 * always on screen.
 */

import type { PrPayload } from '@/lib/messages';
import { ChecksChip } from './ChecksChip';
import { OpenInGitHub } from './OpenInGitHub';
import { ReviewerAvatars } from './ReviewerAvatars';
import { StateBadge } from './StateBadge';
import { prBranches, prPermalink, prReviewers, prState } from './prNode';
import { REVIEW_START, useReviewSession } from './reviewSession';

/**
 * Start a review, explicitly.
 *
 * `START_REVIEW` omits `event`, which is what leaves the review PENDING —
 * `addPullRequestReview` with an event submits on the spot. Once one is open
 * this is inert: a second review would orphan the first along with everything
 * queued on it, and the footer is where an open one is submitted or discarded.
 */
function StartReviewButton() {
  const session = useReviewSession();
  const pending = session.pending.kind === 'pending';
  const failure = session.failures.get(REVIEW_START);

  return (
    <>
      <button
        type="button"
        className="button primary"
        disabled={pending}
        title={
          pending
            ? 'A review is already pending. Submit or discard it in the bar below.'
            : undefined
        }
        onClick={() => {
          void session.startReview();
        }}
      >
        {pending ? 'Review pending' : 'Start a review'}
      </button>
      {failure !== undefined && (
        <p className="topbar-error" role="alert" title={failure}>
          {failure}
        </p>
      )}
    </>
  );
}

export function TopBar({ payload }: { payload: PrPayload }) {
  const node = payload.pullRequest;
  const { base, head } = prBranches(node);

  return (
    <header className="topbar">
      <div className="topbar-identity">
        <h1 className="pr-title">{node.title}</h1>
        <span className="pr-number">#{node.number}</span>
        <StateBadge state={prState(node)} />
      </div>

      <div className="topbar-meta">
        {base !== null && head !== null && (
          <span className="branches" title={`Merging ${head} into ${base}`}>
            <code>{base}</code>
            <span className="branch-arrow" aria-hidden="true">
              ←
            </span>
            <code>{head}</code>
          </span>
        )}
        <ChecksChip checks={payload.checks} />
        <ReviewerAvatars reviewers={prReviewers(node)} />
      </div>

      <div className="topbar-actions">
        <OpenInGitHub pr={payload.ref} href={prPermalink(node)} />
        <StartReviewButton />
      </div>
    </header>
  );
}
