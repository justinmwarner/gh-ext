/**
 * The dashboard route, wired up.
 *
 * `App` stays a switch over routes; this is the piece that knows the list
 * needs three things — the reviewer's opted-in repositories, a payload scoped
 * to them, and their own overrides — and that a failure here is the same four
 * failures every other screen has.
 *
 * The order matters. Repositories load first and from local storage, so a
 * fresh install reaches the picker without a single pull request being read.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { readSettings } from '@/lib/settings-store';
import { logWarn } from '@/lib/log';
import { DashboardView } from './DashboardView';
import { ErrorState } from './ErrorState';
import { FullPage } from './FullPage';
import { LoadingState } from './LoadingState';
import { LockedState } from './LockedState';
import { RepoPicker } from './RepoPicker';
import { SetupState } from './SetupState';
import { useDashboard } from './useDashboard';
import { useRepos } from './useRepos';
import { unlockVault, useVaultState } from './useVaultState';

export function DashboardState() {
  const repos = useRepos();
  const { state, overrides, search, refresh, override, runSearch, clearSearch } =
    useDashboard(repos.watched);
  const vault = useVaultState();
  const [stalenessDays, setStalenessDays] = useState(DEFAULT_SETTINGS.stalenessDays);

  useEffect(() => {
    void readSettings()
      .then((settings) => setStalenessDays(settings.stalenessDays))
      .catch((error: unknown) => {
        logWarn('could not read the staleness horizon', error);
      });
  }, []);

  /**
   * Ask GitHub which repositories exist the moment we know there are none
   * ticked.
   *
   * This is the only request a fresh install makes, and it names repositories
   * rather than reading pull requests out of them. Guarded on `asked` so a
   * reviewer who unticks their last repository does not set off a second
   * round trip for a list already on screen.
   */
  useEffect(() => {
    if (repos.watched?.length === 0 && !repos.asked) repos.discover();
  }, [repos]);

  const picker = {
    discovered: repos.discovered,
    watched: repos.watched ?? [],
    discovering: repos.discovering,
    asked: repos.asked,
    onToggle: repos.toggle,
    onDiscover: repos.discover,
  };

  if (state.status === 'unconfigured') {
    return (
      <FullPage title="Pick the repositories to watch">
        <p>
          This list reads only the repositories you choose, and only the last ninety
          days. Nothing is fetched until you pick one.
        </p>
        <RepoPicker {...picker} />
      </FullPage>
    );
  }

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
      repos={picker}
      search={search}
      onSearch={runSearch}
      onClearSearch={clearSearch}
    />
  );
}
