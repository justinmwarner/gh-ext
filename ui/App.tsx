/**
 * The review page, top to bottom.
 *
 * Route in, payload out, one of four states rendered. Everything below this
 * file is either a state or a region; everything above it is the transport.
 *
 * Two routes now rather than one. The pull request route is what the injected
 * card opens; `#/prs` is the dashboard, which the toolbar button opens and
 * which every row on it leaves through. They share this page rather than
 * taking a second HTML entry point because they share almost everything a
 * failure needs — the four states below, the vault, the theme — and a second
 * bundle would be a second copy of all of it.
 */

import { DashboardState } from './DashboardState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { LockedState } from './LockedState';
import { NoRouteState } from './NoRouteState';
import { SetupState } from './SetupState';
import { Shell } from './Shell';
import { usePageTheme } from './pageTheme';
import { useHashRoute } from './useHashRoute';
import { usePrPayload } from './usePrPayload';
import { unlockVault, useVaultState } from './useVaultState';

export function App() {
  const route = useHashRoute();
  // Above the switch, and that is the point of it being here. Every route on
  // this page wears the reviewer's theme — the dashboard, the four failure
  // states and the loading state included. It used to be applied by `Shell`,
  // which mounts on exactly one of those, so leaving a dark options page for
  // the pull request list put the window back into the operating system's
  // light. `ui/pageTheme.ts` carries the rest of the argument.
  usePageTheme();

  if (route.kind === 'none') return <NoRouteState />;
  if (route.kind === 'dashboard') return <DashboardState />;
  return <PullRequest pr={route.pr} />;
}

/**
 * One pull request, and the four ways asking for it can go.
 *
 * Split out of {@link App} when the dashboard arrived, because the hooks below
 * must not run on a route that has no pull request — and a hook cannot be
 * called inside the switch above.
 */
function PullRequest({ pr }: { pr: { owner: string; repo: string; number: number } }) {
  const load = usePrPayload(pr);
  // Read unconditionally: hooks cannot be called inside the switch below, and
  // reading storage on every mount is cheap next to the round trip the page is
  // already making.
  const vault = useVaultState();

  switch (load.status) {
    case 'loading':
      return <LoadingState />;
    case 'failed':
      // Auth is not an error the reviewer can retry out of — it is a setup step
      // they have not done yet, and it gets a setup state rather than an
      // apology.
      if (load.error.kind !== 'auth') {
        return <ErrorState pr={pr} error={load.error} retry={load.retry} />;
      }
      // Still asking storage which kind of "no token" this is. Showing the
      // setup screen first and swapping it for the locked one a tick later
      // would tell an existing reviewer their token was gone.
      if (vault === null) return <LoadingState />;
      return vault === 'locked' ? (
        <LockedState pr={pr} onUnlock={unlockVault} />
      ) : (
        <SetupState pr={pr} error={load.error} />
      );
    case 'ready':
      return <Shell payload={load.payload} retry={load.retry} />;
  }
}
