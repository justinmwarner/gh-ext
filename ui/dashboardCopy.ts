/**
 * The words on a dashboard row.
 *
 * Separate from the components that draw them because this is where the
 * product's voice actually lives, and voice is testable: plain declarative
 * sentences, no exclamation marks, no emoji, and a reason that says what is
 * true rather than how it feels. `dashboardCopy.test.tsx` asserts the last
 * three, so a later "Nothing to see here!" fails a test rather than a review.
 *
 * Pure strings in, pure strings out. No React, no DOM.
 */

import type { LapseReason } from '@/lib/dashboard/overrides';
import type { Reason } from '@/lib/dashboard/buckets';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** `3 days` or `1 day`. The one place plurals are decided. */
const count = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * How long ago, in the largest unit that still says something.
 *
 * Months past sixty days, because "412 days ago" is a number nobody converts
 * and the row is trying to convey *stale* rather than a duration.
 *
 * A future instant reads as "just now" rather than as a negative. The
 * timestamp comes from GitHub and `now` from the reviewer's machine, so a few
 * minutes of disagreement is ordinary and there is nothing useful to say about
 * it.
 */
export function relativeAge(instant: number, now: number): string {
  // 0 is what `summary.ts` produces for a timestamp it could not read. It is
  // not 1970 and must not be rendered as fifty-six years.
  if (instant === 0) return 'at an unknown time';

  const elapsed = now - instant;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${count(Math.floor(elapsed / MINUTE), 'minute')} ago`;
  if (elapsed < DAY) return `${count(Math.floor(elapsed / HOUR), 'hour')} ago`;

  const days = Math.floor(elapsed / DAY);
  if (days <= 60) return `${count(days, 'day')} ago`;
  return `${count(Math.round(days / 30), 'month')} ago`;
}

/**
 * Why an approved pull request still cannot be merged.
 *
 * Only the three states worth a different sentence are named. Anything else —
 * including a state GitHub adds later — falls back to the general one, because
 * printing a raw enum at a reviewer is worse than saying less.
 */
function mergeBlockage(status: string | null): string {
  switch (status) {
    case 'BLOCKED':
      return 'Approved, merging is blocked';
    case 'BEHIND':
      return 'Approved, behind the base branch';
    case 'UNSTABLE':
      return 'Approved, checks still running';
    default:
      return 'Approved, not mergeable yet';
  }
}

/**
 * The one fact that put this pull request in its bucket.
 *
 * `truncated` is the thread cap from `PrSummary`. When it engages the
 * unresolved count is a floor, and the sentence has to say so — "3 unresolved
 * conversations" and "at least 3" are different claims and only one of them is
 * supported by a list that stopped at twenty-five.
 */
export function describeReason(reason: Reason, truncated: boolean): string {
  switch (reason.kind) {
    case 'review-requested':
      return 'Your review was requested';
    case 'pushed-since-review':
      return 'Pushed since your review';
    case 'changes-requested':
      return 'Changes requested';
    case 'unresolved': {
      const phrase = count(reason.count, 'unresolved conversation');
      return truncated ? `At least ${phrase}` : phrase;
    }
    case 'conflicts':
      return 'Conflicts with the base branch';
    case 'checks-failing':
      return 'Checks failed';
    case 'approved-and-clean':
      return 'Approved and mergeable';
    case 'awaiting-reviewers':
      return `Waiting on ${count(reason.count, 'reviewer')}`;
    case 'approved-not-clean':
      return mergeBlockage(reason.status);
    case 'draft':
      return 'Draft';
    case 'quiet':
      return `No activity in ${count(reason.days, 'day')}`;
    case 'nothing':
      // Deliberately empty. The row already carries the repository, the title
      // and the age; a line reading "Nothing in particular" is noise dressed
      // as information.
      return '';
  }
}

/**
 * Why a row is not where the reviewer put it.
 *
 * Shown on the row rather than folded into a count somewhere, because a
 * reviewer who finds a pull request somewhere other than where they left it is
 * owed the reason at the place they notice.
 */
export function describeLapse(why: LapseReason): string {
  return why === 'pushed'
    ? 'Moved back: there was a push'
    : 'Moved back: something happened here';
}
