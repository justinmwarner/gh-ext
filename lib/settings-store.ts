/**
 * Settings, in and out of extension storage.
 *
 * The second file in `lib/` that touches an extension API, alongside
 * `lib/github/token-provider.ts`, and for the same reason: everything worth
 * testing lives in a pure module — `lib/settings.ts` — and this is the thin
 * adapter that keeps `browser.storage` out of it.
 *
 * Deliberately untested. There is nothing here but four calls and the parse
 * that `lib/settings.test.ts` already covers; a test would only assert that the
 * mocks were called.
 */

import { browser } from 'wxt/browser';
import { setLoggingEnabled } from './log';
import {
  CARD_COLLAPSED_KEY,
  SETTINGS_KEY,
  type Settings,
  parseSettings,
} from './settings';

/**
 * `local`, so a preference survives the browser closing.
 *
 * Not `sync`: this extension already declines to replicate the reviewer's
 * token across machines, and a per-machine window layout preference is not
 * obviously the same on a laptop as on a desk with two monitors.
 */
export async function readSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return parseSettings(stored[SETTINGS_KEY]);
}

export async function writeSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function readCardCollapsed(): Promise<boolean> {
  const stored = await browser.storage.local.get(CARD_COLLAPSED_KEY);
  // Anything other than a stored `true` means expanded. A card the reviewer
  // cannot find is the failure this whole entry point exists to prevent, so
  // the ambiguous case resolves towards being visible.
  return stored[CARD_COLLAPSED_KEY] === true;
}

export async function writeCardCollapsed(collapsed: boolean): Promise<void> {
  await browser.storage.local.set({ [CARD_COLLAPSED_KEY]: collapsed });
}

/**
 * Point the logger at the reviewer's preference, and keep it there.
 *
 * Called once per extension context — the worker, the content script, each
 * page — because each has its own module registry and therefore its own copy
 * of the flag in `lib/log.ts`.
 *
 * The listener matters as much as the initial read. Without it, turning
 * logging on would do nothing until the worker restarted, and the reviewer
 * would conclude the setting was broken.
 */
export async function followLoggingSetting(): Promise<void> {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (change === undefined) return;
    setLoggingEnabled(parseSettings(change.newValue).debugLogging);
  });

  // After the listener, not before: a settings write landing between the two
  // would otherwise be missed and the flag left stale.
  setLoggingEnabled((await readSettings()).debugLogging);
}
