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

const NEVER_REVIEWED =
  'You have not reviewed this pull request yet, so there is no earlier commit ' +
  'to compare against.';

export interface CompareToggleProps {
  /** Whether the column is showing the narrowed diff. */
  active: boolean;
  /** False for a first-time reviewer: there is nothing to compare from. */
  available: boolean;
  busy: boolean;
  onToggle: () => void;
}

/**
 * Narrow the column to what has landed since the viewer's own last review.
 *
 * Disabled rather than hidden when there is no prior review. A control that
 * appears and disappears with the pull request is one the reviewer has to
 * rediscover; a disabled one with the reason on it explains itself.
 */
function CompareToggle({ active, available, busy, onToggle }: CompareToggleProps) {
  return (
    <button
      type="button"
      className="button"
      aria-pressed={active}
      disabled={!available || busy}
      title={available ? undefined : NEVER_REVIEWED}
      onClick={onToggle}
    >
      {busy ? 'Comparing…' : 'Since my last review'}
    </button>
  );
}

export interface TopBarProps {
  payload: PrPayload;
  compare: CompareToggleProps;
  /** Why the comparison could not be shown. Null when nothing went wrong. */
  compareError?: string | null;
}

export function TopBar({ payload, compare, compareError = null }: TopBarProps) {
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
        <CompareToggle {...compare} />
        <OpenInGitHub pr={payload.ref} href={prPermalink(node)} />
        <StartReviewButton />
      </div>

      {compareError !== null && (
        <p className="topbar-error" role="alert">
          {`That comparison could not be loaded: ${compareError} Showing the whole pull request.`}
        </p>
      )}
    </header>
  );
}
