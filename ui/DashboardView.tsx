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

import { useMemo, useState } from 'react';
import {
  BUCKET_ORDER,
  type BucketId,
  type PrSummary,
} from '@/lib/dashboard/buckets';
import { type Overrides, type Resolved, resolve } from '@/lib/dashboard/overrides';
import { FETCH_WINDOW_DAYS } from '@/lib/dashboard/searches';
import { summarizeAreas } from '@/lib/github/permissions';
import type { DashboardPayload } from '@/lib/messages';
import { DashboardRow } from './DashboardRow';
import { RepoPicker, type RepoPickerProps } from './RepoPicker';
import { relativeAge } from './dashboardCopy';
import type { SearchState } from './useDashboard';

export interface DashboardViewProps {
  payload: DashboardPayload;
  overrides: Overrides;
  stalenessDays: number;
  /** Injected so the relative ages are testable without a clock. */
  now: number;
  onOverride: (pr: PrSummary, bucket: BucketId | null) => void;
  onRefresh: () => void;
  /** Everything the folded-away picker needs. See {@link RepoPicker}. */
  repos: RepoPickerProps;
  search: SearchState;
  onSearch: (terms: string) => void;
  onClearSearch: () => void;
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

/**
 * What the list is reading, and the way to change it.
 *
 * Folded away by default and summarised in its own toggle — "1 of 2
 * repositories" is the whole fact, and a reviewer who agrees with it never has
 * to open anything. It is on the page rather than only in options because the
 * list is deliberately partial, and what it is partial *to* is not something
 * to make somebody leave the page to discover.
 */
function ReposPanel({ repos }: { repos: RepoPickerProps }) {
  const [open, setOpen] = useState(false);
  const count = repos.watched.length;
  const total = repos.discovered.length;

  // Discovery is lazy, so this is routinely drawn knowing what is watched and
  // not yet what exists. "2 of 0 repositories" is arithmetic nobody can read
  // as anything but a bug, so the denominator only appears once it is real.
  const known = total >= count && total > 0;
  // The noun agrees with whichever number it follows: "1 of 2 repositories",
  // but "1 repository" when there is no denominator to trail.
  const noun = (known ? total : count) === 1 ? 'repository' : 'repositories';

  return (
    <div className="dash-repos">
      <button
        type="button"
        className="dash-repos-toggle"
        aria-expanded={open}
        onClick={() => {
          // Ask GitHub what exists the first time somebody actually looks.
          // Before that the panel is a sentence about a stored list, which
          // costs nothing.
          if (!repos.asked) repos.onDiscover();
          setOpen((was) => !was);
        }}
      >
        Reading {known ? `${count} of ${total}` : count} {noun}, last {FETCH_WINDOW_DAYS}{' '}
        days
      </button>
      {open && <RepoPicker {...repos} />}
    </div>
  );
}

/** The box that reaches past the window. */
function SearchBar({
  search,
  onSearch,
  onClearSearch,
}: Pick<DashboardViewProps, 'search' | 'onSearch' | 'onClearSearch'>) {
  const [terms, setTerms] = useState('');

  return (
    <form
      className="dash-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(terms);
      }}
    >
      <input
        type="search"
        className="dash-search-box"
        aria-label={`Search pull request titles, any age, beyond the last ${FETCH_WINDOW_DAYS} days`}
        placeholder="Search titles, including closed…"
        value={terms}
        onChange={(event) => setTerms(event.target.value)}
      />
      {search.status !== 'idle' && (
        <button
          type="button"
          className="button"
          onClick={() => {
            setTerms('');
            onClearSearch();
          }}
        >
          Clear search
        </button>
      )}
    </form>
  );
}

/**
 * Search results, as a flat list.
 *
 * Not bucketed, and that is a statement rather than a shortcut: these are
 * matches for a phrase, and most of them have already merged. A pull request
 * that is finished has no turn to be whose, so filing it under "waiting on
 * others" would be an invention the rest of this page is careful not to make.
 */
function Results({
  search,
  now,
  onOverride,
}: {
  search: Extract<SearchState, { status: 'done' }>;
  now: number;
  onOverride: DashboardViewProps['onOverride'];
}) {
  const { prs, total } = search.results;

  if (prs.length === 0) {
    return (
      <p className="dash-empty">Nothing matched “{search.terms}” in the titles here.</p>
    );
  }

  return (
    <section className="dash-bucket" aria-labelledby="dash-results-head">
      <h2 className="dash-bucket-head" id="dash-results-head">
        Matching “{search.terms}”{' '}
        <span className="dash-bucket-count">
          {prs.length} of {total}
        </span>
      </h2>
      <ul className="dash-rows">
        {prs.map((pr) => (
          <DashboardRow
            key={pr.id}
            pr={pr}
            // A match is not a bucket. The row still draws its own facts; it
            // simply has no heading claiming whose move it is.
            resolved={{ bucket: 'quiet', reason: { kind: 'nothing' }, override: null }}
            now={now}
            onOverride={onOverride}
            showState
          />
        ))}
      </ul>
    </section>
  );
}

export function DashboardView({
  payload,
  overrides,
  stalenessDays,
  now,
  onOverride,
  onRefresh,
  repos,
  search,
  onSearch,
  onClearSearch,
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

      <ReposPanel repos={repos} />
      <SearchBar search={search} onSearch={onSearch} onClearSearch={onClearSearch} />

      {search.status === 'running' && <p className="dash-empty">Searching…</p>}
      {search.status === 'failed' && (
        <p className="dash-caveat">The search could not run. {search.error.message}</p>
      )}
      {search.status === 'done' && (
        <Results search={search} now={now} onOverride={onOverride} />
      )}

      {search.status !== 'idle' ? null : (
        <>
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
        </>
      )}
    </div>
  );
}
