/**
 * Noticing that the reviewer fixed their token.
 *
 * The setup screen says "paste a token on the options page and this pull
 * request will load", and nothing made that true: the load effect is keyed on
 * the pull request, which has not changed, so the page sat on the setup screen
 * however long you waited. The remedy was two menus away and the only way to
 * reach it was a reload nobody had been told to do.
 *
 * `storage.onChanged` rather than polling: the options page writes the token to
 * the same area, and every extension context is told. This is storage, not
 * network — the rule that the review page never fetches is untouched.
 */

import { useEffect, useRef } from 'react';
import { isTokenChange } from '@/lib/github/token-provider';

export function useTokenChange(onChange: () => void): void {
  // Held in a ref so a caller passing an inline function does not tear the
  // listener down and rebuild it on every render.
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    const listener = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => {
      if (isTokenChange(changes, areaName)) latest.current();
    };
    browser.storage.onChanged.addListener(listener);
    return () => {
      browser.storage.onChanged.removeListener(listener);
    };
  }, []);
}
