/**
 * The dashboard's data: the payload from the worker, the overrides from
 * storage, and whatever the title search last returned.
 *
 * Three sources, deliberately kept as three. The payload is server truth and
 * is re-read on demand; the overrides are the reviewer's own decisions and
 * live in `storage.local`; the search is a separate question with a separate
 * answer. Merging the first two is `resolve`, which is pure and runs during
 * render — so pressing "move to Quiet" reorders the list on the spot rather
 * than after a round trip.
 *
 * **Nothing is fetched until a repository is opted in.** `repos` arriving
 * empty means no `get-dashboard` is sent at all, which is what makes that
 * promise literal rather than a no-op performed after asking.
 */

import { useCallback, useEffect, useState } from 'react';
import type { BucketId, PrSummary } from '@/lib/dashboard/buckets';
import {
  type Overrides,
  clearOverride,
  setOverride,
  sweepOverrides,
} from '@/lib/dashboard/overrides';
import { logWarn } from '@/lib/log';
import type { DashboardPayload, ProtocolError, SearchResults } from '@/lib/messages';
import { isErr, message } from '@/lib/messages';
import { readOverrides, writeOverrides } from '@/lib/settings-store';
import { request } from './background';

export type DashboardState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'failed'; error: ProtocolError }
  | { status: 'ready'; payload: DashboardPayload };

export type SearchState =
  | { status: 'idle' }
  | { status: 'running'; terms: string }
  | { status: 'failed'; terms: string; error: ProtocolError }
  | { status: 'done'; terms: string; results: SearchResults };

export interface Dashboard {
  state: DashboardState;
  overrides: Overrides;
  search: SearchState;
  refresh: () => void;
  /** `null` puts a row back where the derivation had it. */
  override: (pr: PrSummary, bucket: BucketId | null) => void;
  runSearch: (terms: string) => void;
  clearSearch: () => void;
}

/**
 * @param repos The opted-in repositories, or null while settings are loading.
 */
export function useDashboard(repos: string[] | null): Dashboard {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });
  const [overrides, setOverrides] = useState<Overrides>({});
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);

  // A string, so the effect below re-runs when the *contents* change rather
  // than on every render that rebuilt the array.
  const key = repos === null ? null : repos.join(',');

  useEffect(() => {
    if (repos === null) return;
    if (repos.length === 0) {
      setState({ status: 'unconfigured' });
      return;
    }

    let live = true;
    setState({ status: 'loading' });

    void (async () => {
      const reply = await request(message('get-dashboard', { repos }));
      if (!live) return;
      if (isErr(reply)) {
        setState({ status: 'failed', error: reply.error });
        return;
      }
      setState({ status: 'ready', payload: reply.data });

      // Swept against the list that just arrived rather than on a schedule. A
      // merged pull request never comes back, so its override is storage
      // nobody would otherwise remember to clean — and this is the one moment
      // the set of live ids is known.
      const stored = await readOverrides();
      if (!live) return;
      const swept = sweepOverrides(stored, reply.data.prs.map((pr) => pr.id));
      setOverrides(swept);
      // `sweepOverrides` returns the same object when nothing was dropped, so
      // this is a write on the loads that changed something and not on every
      // load.
      if (swept !== stored) {
        await writeOverrides(swept).catch((error: unknown) => {
          logWarn('could not sweep the dashboard overrides', error);
        });
      }
    })();

    return () => {
      live = false;
    };
    // `key` stands in for `repos`, whose identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const refresh = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const override = useCallback((pr: PrSummary, bucket: BucketId | null) => {
    setOverrides((current) => {
      const next =
        bucket === null
          ? clearOverride(current, pr.id)
          : setOverride(current, pr, bucket, Date.now());
      // Fire and forget. The list has already moved on screen, and a storage
      // write that fails should not put the row back under the reviewer.
      void writeOverrides(next).catch((error: unknown) => {
        logWarn('could not save a dashboard override', error);
      });
      return next;
    });
  }, []);

  const runSearch = useCallback(
    (terms: string) => {
      if (repos === null || repos.length === 0) return;
      const trimmed = terms.trim();
      if (trimmed === '') {
        setSearch({ status: 'idle' });
        return;
      }

      setSearch({ status: 'running', terms: trimmed });
      void (async () => {
        const reply = await request(message('search-prs', { terms: trimmed, repos }));
        setSearch(
          isErr(reply)
            ? { status: 'failed', terms: trimmed, error: reply.error }
            : { status: 'done', terms: trimmed, results: reply.data },
        );
      })();
    },
    [repos],
  );

  const clearSearch = useCallback(() => setSearch({ status: 'idle' }), []);

  return { state, overrides, search, refresh, override, runSearch, clearSearch };
}
