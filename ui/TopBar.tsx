/**
 * The sticky top bar.
 *
 * Everything in it is already in the payload, so none of it is a placeholder.
 * The one exception is `Review changes`, which is disabled until the submit
 * flow exists — a control that looks live and does nothing is worse than one
 * that admits it is not ready.
 */

import type { PrPayload } from '@/lib/messages';
import { ChecksChip } from './ChecksChip';
import { OpenInGitHub } from './OpenInGitHub';
import { ReviewerAvatars } from './ReviewerAvatars';
import { StateBadge } from './StateBadge';
import { prBranches, prPermalink, prReviewers, prState } from './prNode';

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
        <button
          type="button"
          className="button primary"
          disabled
          title="Submitting a review is not wired up yet"
        >
          Review changes
        </button>
      </div>
    </header>
  );
}
