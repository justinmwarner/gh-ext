/**
 * The dashboard's data: the payload from the worker, and the overrides from
 * storage.
 *
 * Two sources, deliberately kept as two. The payload is server truth and is
 * re-read on demand; the overrides are the reviewer's own decisions and live
 * in `storage.local`. Merging them is `resolve`, which is pure and runs during
 * render — so pressing "move to Quiet" reorders the list on the spot rather
 * than after a round trip.
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
import type { DashboardPayload, ProtocolError } from '@/lib/messages';
import { isErr, message } from '@/lib/messages';
import { readOverrides, writeOverrides } from '@/lib/settings-store';
import { request } from './background';

export type DashboardState =
  | { status: 'loading' }
  | { status: 'failed'; error: ProtocolError }
  | { status: 'ready'; payload: DashboardPayload };

export interface Dashboard {
  state: DashboardState;
  overrides: Overrides;
  refresh: () => void;
  /** `null` puts a row back where the derivation had it. */
  override: (pr: PrSummary, bucket: BucketId | null) => void;
}

export function useDashboard(): Dashboard {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });
  const [overrides, setOverrides] = useState<Overrides>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;

    void (async () => {
      const reply = await request(message('get-dashboard', {}));
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
  }, [attempt]);

  const refresh = useCallback(() => {
    setState({ status: 'loading' });
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

  return { state, overrides, refresh, override };
}
