/**
 * The review page, top to bottom.
 *
 * Route in, payload out, one of four states rendered. Everything below this
 * file is either a state or a region; everything above it is the transport.
 */

import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { LockedState } from './LockedState';
import { NoRouteState } from './NoRouteState';
import { SetupState } from './SetupState';
import { Shell } from './Shell';
import { useHashRoute } from './useHashRoute';
import { usePrPayload } from './usePrPayload';
import { unlockVault, useVaultState } from './useVaultState';

export function App() {
  const pr = useHashRoute();
  const load = usePrPayload(pr);
  // Read unconditionally: hooks cannot be called inside the switch below, and
  // reading storage on every mount is cheap next to the round trip the page is
  // already making.
  const vault = useVaultState();

  if (pr === null) return <NoRouteState />;

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
