/**
 * The dashboard route, wired up.
 *
 * `App` stays a switch over routes and states; this is the piece that knows
 * the list needs a payload, the reviewer's overrides and their staleness
 * horizon, and that a failure here is the same four failures every other
 * screen has.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { readSettings } from '@/lib/settings-store';
import { logWarn } from '@/lib/log';
import { DashboardView } from './DashboardView';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { LockedState } from './LockedState';
import { SetupState } from './SetupState';
import { useDashboard } from './useDashboard';
import { unlockVault, useVaultState } from './useVaultState';

export function DashboardState() {
  const { state, overrides, refresh, override } = useDashboard();
  const vault = useVaultState();
  const [stalenessDays, setStalenessDays] = useState(DEFAULT_SETTINGS.stalenessDays);

  useEffect(() => {
    void readSettings()
      .then((settings) => setStalenessDays(settings.stalenessDays))
      .catch((error: unknown) => {
        logWarn('could not read the staleness horizon', error);
      });
  }, []);

  if (state.status === 'loading') return <LoadingState />;

  if (state.status === 'failed') {
    // The same split the review page makes: auth is a setup step somebody has
    // not done yet rather than an error they can retry out of.
    if (state.error.kind !== 'auth') {
      return <ErrorState pr={null} error={state.error} retry={refresh} />;
    }
    if (vault === null) return <LoadingState />;
    return vault === 'locked' ? (
      <LockedState pr={null} onUnlock={unlockVault} />
    ) : (
      <SetupState pr={null} error={state.error} />
    );
  }

  return (
    <DashboardView
      payload={state.payload}
      overrides={overrides}
      stalenessDays={stalenessDays}
      // Read once per render rather than ticked. The ages on this page are
      // coarse — minutes, hours, days — so a timer redrawing the whole list
      // every second would spend the reviewer's battery to move nothing.
      now={Date.now()}
      onOverride={override}
      onRefresh={refresh}
    />
  );
}
