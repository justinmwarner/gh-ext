/**
 * A `KeyValueStore` in a Map.
 *
 * Test support only. `chromeKeyValueStore` reaches for `browser.storage` the
 * moment it is called, which is not a thing that exists in jsdom, so anything
 * exercising drafts gets this instead.
 */

import type { KeyValueStore } from '@/lib/review/drafts';

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const entries = new Map(Object.entries(initial));
  return {
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...entries.keys()]),
  };
}
