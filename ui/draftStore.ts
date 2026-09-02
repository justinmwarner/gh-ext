/**
 * The comment drafts the review page keeps between visits.
 *
 * `local`, not `session`: a draft is the reviewer's own writing and losing it
 * because the browser restarted is exactly the failure the store exists to
 * prevent. The pull request cache is the opposite case and uses `session`.
 *
 * The storage area is resolved inside each call rather than when this module
 * loads. `chromeKeyValueStore` reaches for `browser.storage` immediately, which
 * would make importing this file fatal anywhere the extension APIs are absent —
 * including every test of a component that merely *might* open a composer.
 */

import { chromeKeyValueStore } from '@/lib/github/token-provider';
import { DraftStore, type KeyValueStore } from '@/lib/review/drafts';

const lazyExtensionStorage: KeyValueStore = {
  get: (key) => chromeKeyValueStore('local').get(key),
  set: (key, value) => chromeKeyValueStore('local').set(key, value),
  remove: (key) => chromeKeyValueStore('local').remove(key),
  keys: () => chromeKeyValueStore('local').keys(),
};

export const draftStore = new DraftStore(lazyExtensionStorage);
