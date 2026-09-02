/**
 * Who has looked at this, and what they said.
 *
 * Avatars are the compact form, but the name and the verdict are the actual
 * information — so both go in the alt text rather than in a tooltip only a
 * mouse can reach.
 */

import type { Reviewer } from './prNode';
import { reviewerLabel, reviewerTone } from './reviewerLabel';

export function ReviewerAvatars({ reviewers }: { reviewers: Reviewer[] }) {
  if (reviewers.length === 0) return null;

  return (
    <ul className="reviewers">
      {reviewers.map((reviewer) => (
        <li
          // A team slug may equal a user login; the kind keeps the keys apart.
          key={`${reviewer.kind}:${reviewer.login}`}
          className={`reviewer reviewer-${reviewerTone(reviewer)}`}
        >
          {reviewer.avatarUrl === null ? (
            // A reviewer with no avatar URL still has to be nameable.
            <span
              className="avatar avatar-empty"
              role="img"
              aria-label={reviewerLabel(reviewer)}
            >
              {reviewer.login.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <img
              className="avatar"
              src={reviewer.avatarUrl}
              alt={reviewerLabel(reviewer)}
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
