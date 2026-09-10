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
 *
 * What it does **not** own is which commits the column is showing. That is
 * `ScopeBar`, on its own row: a reviewer has to be able to tell a diff scoped
 * to one commit from the whole pull request at a glance, and a toggle among
 * the other actions up here was not that.
 *
 * The newest thing here is the one that removed a whole row from the page:
 * everything the review cannot vouch for used to be a stack of banners under
 * this bar, and is now one control in it. `NoticeCenter` says why.
 */

import type { PrPayload, PullRequestNode } from '@/lib/messages';
import { NoticeCenter } from './NoticeCenter';
import { OpenInGitHub } from './OpenInGitHub';
import { StateBadge } from './StateBadge';
import { prPermalink, prState, prViewerCanReview } from './prNode';
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
function StartReviewButton({ node }: { node: PullRequestNode }) {
  const session = useReviewSession();
  const pending = session.pending.kind === 'pending';
  const failure = session.failures.get(REVIEW_START);

  // Absent rather than disabled, unlike the verdicts in the footer. A disabled
  // Approve sits beside an enabled Comment and the pair says "this one, not
  // that one" — there is a way forward and the greying names it. There is no
  // way forward here, and a permanently dead primary button in the sticky bar
  // is chrome that reads as broken. `NoticeCenter` carries the explanation, so
  // the fact is still on screen; it is just not on a control.
  //
  // Only once a review is not already open. A review resumed from GitHub still
  // has to be submittable from the footer, and hiding this would not have
  // stopped it existing.
  if (!pending && !prViewerCanReview(node)) return null;

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
  /** Ask the worker for this pull request again. */
  retry: () => void;
  /** The commit the pull request is on now, if it has moved since it loaded. */
  movedTo: string | null;
  /** Keep reading the commit already on screen. */
  onDismissMoved: () => void;
}

export function TopBar({ payload, retry, movedTo, onDismissMoved }: TopBarProps) {
  const node = payload.pullRequest;
  const session = useReviewSession();

  return (
    <header className="topbar">
      <div className="topbar-identity">
        <h1 className="pr-title">{node.title}</h1>
        <span className="pr-number">#{node.number}</span>
        <StateBadge state={prState(node)} />
        <PendingChip />
      </div>

      <div className="topbar-actions">
        {/* First, and that is a layout decision rather than a reading order.
            This row is right-aligned, so a control at the head of it grows
            leftwards: `Open in GitHub` and `Start a review` stay exactly where
            they were when a notice appears. Put it last and every notice that
            arrives mid-review shifts the button under the reviewer's pointer. */}
        <NoticeCenter
          payload={payload}
          tokenRejected={session.tokenRejected}
          movedTo={movedTo}
          reviewPending={session.pending.kind === 'pending'}
          onReload={retry}
          onDismissMoved={onDismissMoved}
        />
        <OpenInGitHub pr={payload.ref} href={prPermalink(node)} />
        <StartReviewButton node={node} />
      </div>
    </header>
  );
}
