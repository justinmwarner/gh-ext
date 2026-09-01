/**
 * Who has looked at this, and what they said.
 *
 * Avatars are the compact form, but the name and the verdict are the actual
 * information — so both go in the alt text rather than in a tooltip only a
 * mouse can reach.
 */

import type { Reviewer } from './prNode';

const VERDICTS: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'commented',
  DISMISSED: 'review dismissed',
  PENDING: 'review pending',
};

function label(reviewer: Reviewer): string {
  if (reviewer.state === null) return `${reviewer.login} — review requested`;
  return `${reviewer.login} — ${VERDICTS[reviewer.state] ?? reviewer.state.toLowerCase()}`;
}

function tone(reviewer: Reviewer): string {
  if (reviewer.state === 'APPROVED') return 'good';
  if (reviewer.state === 'CHANGES_REQUESTED') return 'bad';
  return 'neutral';
}

export function ReviewerAvatars({ reviewers }: { reviewers: Reviewer[] }) {
  if (reviewers.length === 0) return null;

  return (
    <ul className="reviewers">
      {reviewers.map((reviewer) => (
        <li key={reviewer.login} className={`reviewer reviewer-${tone(reviewer)}`}>
          {reviewer.avatarUrl === null ? (
            // A reviewer with no avatar URL still has to be nameable.
            <span className="avatar avatar-empty" role="img" aria-label={label(reviewer)}>
              {reviewer.login.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <img
              className="avatar"
              src={reviewer.avatarUrl}
              alt={label(reviewer)}
              width={20}
              height={20}
              loading="lazy"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
