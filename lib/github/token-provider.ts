/**
 * The two adapters that put extension storage behind interfaces the pure
 * modules already speak: `TokenProvider` for `GitHubClient`, and
 * `KeyValueStore` for `DraftStore` and `PrCache`.
 *
 * This is the one place in `lib/` that touches an extension API. It exists so
 * that `lib/github/client.ts`, `lib/review/drafts.ts` and `lib/cache.ts` stay
 * free of it and remain testable in plain Node.
 */

import { browser } from 'wxt/browser';
import type { TokenProvider } from './client';
import type { KeyValueStore } from '../review/drafts';

/**
 * Where the personal access token lives.
 *
 * `local`, never `sync`. A `sync` value is replicated by Chrome to every
 * machine the profile is signed in on, which is not a decision to make on a
 * user's behalf for a credential.
 */
export const TOKEN_KEY = 'github-token';

export type StorageAreaName = 'local' | 'session';

const area = (name: StorageAreaName) =>
  name === 'session' ? browser.storage.session : browser.storage.local;

/**
 * Reads the token from `storage.local` on every call.
 *
 * No caching on purpose: the options page can change the token at any moment,
 * and the background worker holds a single long-lived `GitHubClient`.
 */
export class ChromeTokenProvider implements TokenProvider {
  async getToken(): Promise<string | null> {
    const stored = await browser.storage.local.get(TOKEN_KEY);
    const token = stored[TOKEN_KEY];
    return typeof token === 'string' && token !== '' ? token : null;
  }

  /** Passing null or an empty string clears the token. */
  async setToken(token: string | null): Promise<void> {
    if (token === null || token.trim() === '') {
      await browser.storage.local.remove(TOKEN_KEY);
      return;
    }
    await browser.storage.local.set({ [TOKEN_KEY]: token.trim() });
  }
}

/**
 * A `KeyValueStore` over an extension storage area.
 *
 * `session` is cleared when the browser closes and is not written to disk,
 * which is what the pull request cache wants. `local` survives restarts, which
 * is what comment drafts want.
 */
export function chromeKeyValueStore(name: StorageAreaName = 'local'): KeyValueStore {
  const store = area(name);
  return {
    async get(key) {
      const stored = await store.get(key);
      const value = stored[key];
      return typeof value === 'string' ? value : null;
    },
    async set(key, value) {
      await store.set({ [key]: value });
    },
    async remove(key) {
      await store.remove(key);
    },
    async keys() {
      // `get(null)` returns the whole area. There is no key-listing API.
      return Object.keys(await store.get(null));
    },
  };
}

/**
 * Whether a storage change replaced the GitHub token.
 *
 * Split out from the listener so the decision can be tested without a browser.
 * The area is checked because the token lives in `local` and the pull request
 * cache lives in `session`: a cache write must not be mistaken for the
 * reviewer signing out and trigger a sweep of the very thing being written.
 */
export function isTokenChange(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
): boolean {
  if (areaName !== 'local') return false;
  const change = changes[TOKEN_KEY];
  if (change === undefined) return false;
  // A write of the same value is not a change. Saving the token a second time
  // is a normal thing to do from the options page and should not throw away a
  // warm cache that is still valid for it.
  return change.oldValue !== change.newValue;
}
