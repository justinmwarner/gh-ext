/**
 * Waiting.
 *
 * The content script starts a prefetch the moment a pull request page loads, so
 * by the time the review page opens the payload is usually already sitting in
 * the worker and the reply lands within a frame. A spinner drawn and torn down
 * in that window reads as a glitch, not as progress.
 *
 * So: nothing at all, until the wait is long enough that silence would read as
 * a broken page.
 */

import { useEffect, useState } from 'react';

/** How long an empty page is better than a spinner. */
export const QUIET_MS = 400;

export function LoadingState() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), QUIET_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!slow) return null;

  return (
    <p className="loading" role="status">
      Loading the pull request…
    </p>
  );
}
