/**
 * The review page, top to bottom.
 *
 * Route in, payload out, one of four states rendered. Everything below this
 * file is either a state or a region; everything above it is the transport.
 */

import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { NoRouteState } from './NoRouteState';
import { SetupState } from './SetupState';
import { Shell } from './Shell';
import { useHashRoute } from './useHashRoute';
import { usePrPayload } from './usePrPayload';

export function App() {
  const pr = useHashRoute();
  const load = usePrPayload(pr);

  if (pr === null) return <NoRouteState />;

  switch (load.status) {
    case 'loading':
      return <LoadingState />;
    case 'failed':
      // Auth is not an error the reviewer can retry out of — it is a setup step
      // they have not done yet, and it gets a setup state rather than an
      // apology.
      return load.error.kind === 'auth' ? (
        <SetupState pr={pr} error={load.error} />
      ) : (
        <ErrorState pr={pr} error={load.error} />
      );
    case 'ready':
      return <Shell payload={load.payload} />;
  }
}
