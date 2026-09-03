/**
 * The sticky top bar: which pull request this is, and nothing else that could
 * live somewhere better.
 *
 * The branch pair, the checks chip and the reviewer avatars were all here and
 * have moved to the Overview view, beside the lists that explain them. They
 * were facts about the change presented as though they were the change's name.
 * "Since my last review" moved down to the Files view, which is the only place
 * it means anything.
 *
 * What is left has to be here. The identity, so no view can leave you unsure
 * which pull request you are reading. The pending chip, because forgetting a
 * review was never submitted is the one way to lose a whole review's writing.
 * And the control that *opens* a review — the footer exists only once one is
 * pending, so the thing that starts it, and the failure when GitHub refuses,
 * have to live somewhere that is always on screen.
 */

import type { PrPayload } from '@/lib/messages';
import { OpenInGitHub } from './OpenInGitHub';
import { StateBadge } from './StateBadge';
import { prPermalink, prState } from './prNode';
import { REVIEW_START, useReviewSession } from './reviewSession';

/**
 * That nothing has gone out yet, in the one place that is always on screen.
 *
 * The footer says this too, but the footer sits below a diff that can run to
 * thousands of lines, so for most of a large review it is nowhere in sight —
 * and forgetting the review has not been submitted is the entire hazard. This
 * costs a few characters of the sticky bar and removes the only way to lose a
 * whole review's worth of writing by closing a tab.
 */
function PendingChip() {
  const session = useReviewSession();
  if (session.pending.kind !== 'pending') return null;

  return (
    <span
      className="chip chip-pending"
      title="Your comments are queued on a pending review. Submit it from the bar at the bottom of the page to post them."
    >
      Not posted yet
    </span>
  );
}

/**
 * Start a review, explicitly.
 *
 * Explicitly is the point. Comments post as they are written unless a review is
 * open, so this is the only thing that makes them queue — and until a reviewer
 * presses it, nothing they write is held back.
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

export interface TopBarProps {
  payload: PrPayload;
}

export function TopBar({ payload }: TopBarProps) {
  const node = payload.pullRequest;

  return (
    <header className="topbar">
      <div className="topbar-identity">
        <h1 className="pr-title">{node.title}</h1>
        <span className="pr-number">#{node.number}</span>
        <StateBadge state={prState(node)} />
        <PendingChip />
      </div>

      <div className="topbar-actions">
        <OpenInGitHub pr={payload.ref} href={prPermalink(node)} />
        <StartReviewButton />
      </div>
    </header>
  );
}
