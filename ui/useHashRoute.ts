/**
 * The route, which is the hash and nothing else.
 *
 * No router library. There is one route shape, `#/pr/{owner}/{repo}/{number}`,
 * already parsed by `lib/github/pr-url.ts` and already produced by the worker —
 * so the whole job is noticing when the hash changes.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`: the hash is
 * external state React does not own, and reading it during render instead of
 * after mount means the first paint is never one route behind.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { parseReviewHash } from '@/lib/github/pr-url';
import type { PrRef } from '@/lib/messages';

function subscribe(onStoreChange: () => void): () => void {
  // The review tab is never reloaded when the route changes — the worker
  // navigates an already-open tab by replacing the hash.
  window.addEventListener('hashchange', onStoreChange);
  return () => window.removeEventListener('hashchange', onStoreChange);
}

/** A string, so `useSyncExternalStore`'s identity check is meaningful. */
const getSnapshot = (): string => window.location.hash;

/** The pull request in the URL, or null if the hash is not a review route. */
export function useHashRoute(): PrRef | null {
  const hash = useSyncExternalStore(subscribe, getSnapshot);
  // Parsing allocates a new object every time; memoizing on the hash keeps the
  // reference stable so the fetch effect below does not re-run on every render.
  return useMemo(() => parseReviewHash(hash), [hash]);
}
