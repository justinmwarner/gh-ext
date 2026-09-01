/**
 * Asking the worker for a pull request.
 *
 * The only data-fetching hook on the page. It does not call GitHub — it sends
 * one `get-pr` and turns the reply into one of three states the shell can
 * render without knowing anything about transports.
 *
 * The worker answers `get-pr` with a whole `PrPayload` in a single reply today,
 * so there is nothing to render early. If it later streams — diff first,
 * threads behind it — this is the file that grows a fourth state, and nothing
 * above it has to change shape.
 */

import { useEffect, useState } from 'react';
import {
  type PrPayload,
  type PrRef,
  type ProtocolError,
  message,
} from '@/lib/messages';
import { request } from './background';

export type PrLoad =
  | { status: 'loading' }
  | { status: 'ready'; payload: PrPayload }
  | { status: 'failed'; error: ProtocolError };

export function usePrPayload(pr: PrRef | null): PrLoad {
  const [load, setLoad] = useState<PrLoad>({ status: 'loading' });

  useEffect(() => {
    // No coordinates, nothing to ask for. Not an error — the caller renders an
    // explanation instead, and the worker is left alone.
    if (pr === null) return;

    let live = true;
    setLoad({ status: 'loading' });

    void request(message('get-pr', { pr })).then((response) => {
      // The hash can change mid-flight when the worker retargets this tab at a
      // different pull request. Late replies for the old one are dropped.
      if (!live) return;
      setLoad(
        response.ok
          ? { status: 'ready', payload: response.data }
          : { status: 'failed', error: response.error },
      );
    });

    return () => {
      live = false;
    };
  }, [pr]);

  return load;
}
