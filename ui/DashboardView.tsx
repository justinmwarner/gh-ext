/**
 * The dashboard: every pull request this account is involved in, under a
 * heading saying whose turn it is.
 *
 * Presentational. It takes a payload and gives back rows — the fetch is
 * `useDashboard`, the storage is the overrides adapter, and keeping all three
 * apart is what lets the rules be tested without a browser and this be tested
 * without a worker.
 *
 * What it deliberately does **not** have: a count on a badge, a summary tile, a
 * chart, an illustration, or any control that writes to GitHub. The first four
 * are named in DESIGN.md's Don'ts; the last is the line between a list that
 * opens reviews and a second GitHub, and PRODUCT.md names that as the
 * anti-reference this whole feature had to argue past.
 */

import { useMemo } from 'react';
import {
  BUCKET_ORDER,
  type BucketId,
  type PrSummary,
} from '@/lib/dashboard/buckets';
import { type Overrides, type Resolved, resolve } from '@/lib/dashboard/overrides';
import { summarizeAreas } from '@/lib/github/permissions';
import type { DashboardPayload } from '@/lib/messages';
import { DashboardRow } from './DashboardRow';
import { relativeAge } from './dashboardCopy';

export interface DashboardViewProps {
  payload: DashboardPayload;
  overrides: Overrides;
  stalenessDays: number;
  /** Injected so the relative ages are testable without a clock. */
  now: number;
  onOverride: (pr: PrSummary, bucket: BucketId | null) => void;
  onRefresh: () => void;
}

interface Placed {
  pr: PrSummary;
  resolved: Resolved;
}

/**
 * Every pull request in its bucket, each bucket sorted by what moved last.
 *
 * Sorting inside the bucket rather than across the whole list: the heading is
 * the primary signal and recency is the tiebreak within it. A single list
 * sorted by time would put a three-day-old review request below a draft
 * somebody pushed to this morning.
 */
function place(
  prs: readonly PrSummary[],
  overrides: Overrides,
  now: number,
  stalenessDays: number,
): Map<BucketId, Placed[]> {
  const grouped = new Map<BucketId, Placed[]>();

  for (const pr of prs) {
    const resolved = resolve(pr, overrides, { now, stalenessDays });
    const bucket = grouped.get(resolved.bucket) ?? [];
    bucket.push({ pr, resolved });
    grouped.set(resolved.bucket, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => b.pr.updatedAt - a.pr.updatedAt);
  }

  return grouped;
}

/**
 * The two things this list can be wrong about, said out loud.
 *
 * Neither is an error — the page rendered, the rows are real. They are the
 * difference between a list that is short and a list that is short *and says
 * so*, which is PRODUCT.md's fourth principle applied to a case where the
 * failure is silence rather than a stack trace.
 */
function Caveats({ payload }: { payload: DashboardPayload }) {
  const refused = payload.denied.length > 0 ? summarizeAreas(payload.denied) : null;

  if (payload.truncated.length === 0 && refused === null) return null;

  return (
    <div className="dash-caveats">
      {payload.truncated.map((shortfall) => (
        <p key={shortfall.search} className="dash-caveat">
          Showing {shortfall.shown} of {shortfall.total} pull requests you opened. GitHub
          returns at most fifty per search, most recently updated first.
        </p>
      ))}
      {refused !== null && (
        <p className="dash-caveat">
          GitHub could not return {refused.areas.map((area) => area.what).join(', ')}.
          {refused.permissions.length > 0 && (
            <> This token is missing {refused.permissions.join(' and ')}.</>
          )}
        </p>
      )}
    </div>
  );
}

export function DashboardView({
  payload,
  overrides,
  stalenessDays,
  now,
  onOverride,
  onRefresh,
}: DashboardViewProps) {
  const grouped = useMemo(
    () => place(payload.prs, overrides, now, stalenessDays),
    [payload.prs, overrides, now, stalenessDays],
  );

  return (
    <div className="dash">
      <header className="dash-head">
        <h1 className="dash-title">Pull requests</h1>
        <div className="dash-head-actions">
          <span className="dash-fetched">Read {relativeAge(payload.fetchedAt, now)}</span>
          <button type="button" className="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </header>

      <Caveats payload={payload} />

      {payload.prs.length === 0 ? (
        // One sentence. PRODUCT.md names illustrated empty states as an
        // anti-reference, and a list that is empty because there is genuinely
        // nothing to do is good news that needs no decoration.
        <p className="dash-empty">
          Nothing is waiting on you, and nothing you opened is waiting on anybody.
        </p>
      ) : (
        BUCKET_ORDER.map((bucket) => {
          const rows = grouped.get(bucket.id) ?? [];
          if (rows.length === 0) return null;

          return (
            <section
              key={bucket.id}
              className="dash-bucket"
              aria-labelledby={`dash-bucket-${bucket.id}`}
            >
              <h2 className="dash-bucket-head" id={`dash-bucket-${bucket.id}`}>
                {bucket.label} <span className="dash-bucket-count">{rows.length}</span>
              </h2>
              <p className="dash-bucket-blurb">{bucket.blurb}</p>
              <ul className="dash-rows">
                {rows.map(({ pr, resolved }) => (
                  <DashboardRow
                    key={pr.id}
                    pr={pr}
                    resolved={resolved}
                    now={now}
                    onOverride={onOverride}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
