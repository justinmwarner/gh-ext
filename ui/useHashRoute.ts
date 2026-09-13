/**
 * The route, which is the hash and nothing else.
 *
 * No router library. There are two route shapes — `#/pr/{owner}/{repo}/{number}`
 * and `#/prs` — both already parsed by `lib/github/pr-url.ts` and both already
 * produced by the worker, so the whole job is noticing when the hash changes.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`: the hash is
 * external state React does not own, and reading it during render instead of
 * after mount means the first paint is never one route behind.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { type Route, parseRoute } from '@/lib/github/pr-url';

function subscribe(onStoreChange: () => void): () => void {
  // The review tab is never reloaded when the route changes — the worker
  // navigates an already-open tab by replacing the hash, and a dashboard row
  // is a link to another hash on the same page.
  window.addEventListener('hashchange', onStoreChange);
  return () => window.removeEventListener('hashchange', onStoreChange);
}

/** A string, so `useSyncExternalStore`'s identity check is meaningful. */
const getSnapshot = (): string => window.location.hash;

/** What the URL is pointing at: a pull request, the list, or neither. */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot);
  // Parsing allocates a new object every time; memoizing on the hash keeps the
  // reference stable so the fetch effect below does not re-run on every render.
  return useMemo(() => parseRoute(hash), [hash]);
}
