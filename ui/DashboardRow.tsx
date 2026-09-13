/**
 * One pull request, as a row.
 *
 * Rows rather than cards, per DESIGN.md section 6: *"don't reach for a card
 * grid where a list of rows would do. This interface is rows."*
 *
 * The row carries exactly one reason — the fact that decided its bucket — and
 * not every signal the query returned. A row listing the review decision, the
 * check state, the merge state and the conversation count is a row nobody
 * reads, and the whole value of the derivation is that it already picked.
 */

import type { BucketId, PrSummary } from '@/lib/dashboard/buckets';
import { BUCKET_ORDER } from '@/lib/dashboard/buckets';
import type { Resolved } from '@/lib/dashboard/overrides';
import { reviewHash } from '@/lib/github/pr-url';
import { describeLapse, describeReason, relativeAge } from './dashboardCopy';

export interface DashboardRowProps {
  pr: PrSummary;
  resolved: Resolved;
  now: number;
  onOverride: (pr: PrSummary, bucket: BucketId | null) => void;
  /**
   * Draw the pull request's state beside its number.
   *
   * Off in the buckets, where everything is open by construction and a row of
   * "Open" badges would be a column of noise. On in search results, which
   * reach closed and merged pull requests and would otherwise show a finished
   * one as though it were still waiting.
   */
  showState?: boolean;
}

/** The badge vocabulary DESIGN.md section 5 already defines, by state. */
const STATE_LABEL: Readonly<Record<string, string>> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  MERGED: 'Merged',
};

/**
 * The route to this pull request's review.
 *
 * Built from `reviewHash` rather than spelled out, so the worker's URL and the
 * page's link cannot drift apart. Splitting `owner/name` here rather than
 * carrying the halves on `PrSummary`: this is the only place that needs them.
 */
function hashFor(pr: PrSummary): string {
  const [owner = '', repo = ''] = pr.repo.split('/');
  return reviewHash({ owner, repo, number: pr.number });
}

export function DashboardRow({
  pr,
  resolved,
  now,
  onOverride,
  showState = false,
}: DashboardRowProps) {
  const reason = describeReason(resolved.reason, pr.threadsTruncated);
  const override = resolved.override;

  return (
    <li className="dash-row">
      <div className="dash-row-main">
        <span className="dash-row-repo">
          {pr.repo}#{pr.number}
          {showState && (
            <span className={`badge badge-${pr.state.toLowerCase()}`}>
              {STATE_LABEL[pr.state] ?? pr.state}
            </span>
          )}
        </span>
        <a className="dash-row-title" href={hashFor(pr)}>
          {pr.title}
        </a>
      </div>

      <div className="dash-row-meta">
        {reason !== '' && <span className="dash-row-reason">{reason}</span>}
        <span className="dash-row-age">
          {pr.author === null ? 'Unknown author' : pr.author} &middot;{' '}
          {relativeAge(pr.updatedAt, now)}
        </span>
        {override?.state === 'lapsed' && (
          <span className="dash-row-lapsed">{describeLapse(override.why)}</span>
        )}
      </div>

      <div className="dash-row-actions">
        {override?.state === 'applied' ? (
          <button
            type="button"
            className="button dash-row-putback"
            onClick={() => onOverride(pr, null)}
          >
            Put back
          </button>
        ) : (
          /*
           * A select rather than a menu. There are six destinations, a native
           * control is keyboard-operable without any work, and PRODUCT.md
           * treats a keyboard gap as a product bug rather than an
           * accessibility footnote.
           */
          <select
            className="dash-row-move"
            aria-label={`Move ${pr.title} to another list`}
            value=""
            onChange={(event) => onOverride(pr, event.target.value as BucketId)}
          >
            <option value="" disabled>
              Move to
            </option>
            {BUCKET_ORDER.filter((bucket) => bucket.id !== resolved.bucket).map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}
