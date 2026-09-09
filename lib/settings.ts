/**
 * The reviewer's preferences, and what a stored value is allowed to mean.
 *
 * Pure by contract like the rest of `lib/` — the adapter that actually touches
 * `browser.storage` is `lib/settings-store.ts`. Keeping the validation here is
 * what lets three separate contexts (the content script, the worker and the
 * options page) agree on what a stored blob means without any of them needing a
 * browser to prove it.
 */

/** Where a review opens. */
export type OpenIn = 'new-tab' | 'new-window' | 'same-tab';

export interface Settings {
  openIn: OpenIn;
  /** Open a review by itself on landing on a pull request. */
  autoOpen: boolean;
  /**
   * Write diagnostics to the console.
   *
   * Off by default. This extension runs a content script on every github.com
   * page, so anything it logs uninvited lands in a console the reviewer is
   * probably using for their own work.
   */
  debugLogging: boolean;
}

/** `storage.local` key holding the whole {@link Settings} object. */
export const SETTINGS_KEY = 'settings';

/**
 * `storage.local` key holding whether the card is collapsed.
 *
 * Its own key rather than a field on {@link Settings} on purpose. The content
 * script writes it on every toggle while the options page writes the settings
 * object, and two writers doing read-modify-write on one key will eventually
 * lose one of the two edits. Separate keys cannot collide.
 */
export const CARD_COLLAPSED_KEY = 'card-collapsed';

/**
 * `new-tab` rather than the `same-tab` this extension used to do unconditionally.
 *
 * Replacing the pull request page is a surprising amount to do in response to
 * one click, and it throws away the thing the reviewer may still want: the
 * conversation, the merge button, the rest of GitHub.
 */
export const DEFAULT_SETTINGS: Settings = {
  openIn: 'new-tab',
  autoOpen: false,
  debugLogging: false,
};

/**
 * Typed as `Record<OpenIn, true>` so adding a destination to the union without
 * adding it here is a compile error, and the runtime check cannot fall behind.
 */
const OPEN_IN: Record<OpenIn, true> = {
  'new-tab': true,
  'new-window': true,
  'same-tab': true,
};

export function isOpenIn(value: unknown): value is OpenIn {
  // `hasOwn` rather than `in`, so `'constructor'` and friends are not
  // destinations.
  return typeof value === 'string' && Object.hasOwn(OPEN_IN, value);
}

/**
 * Read stored settings, falling back per field.
 *
 * Every failure mode lands on a default rather than an exception: this runs in
 * the background worker on the way to opening a review, and a settings object
 * written by a later version — or corrupted, or simply absent — must not be
 * able to stop a reviewer opening a pull request.
 *
 * Per field rather than all-or-nothing, so one unrecognized value does not
 * discard a neighbouring one that was perfectly good.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }

  const stored = raw as Record<string, unknown>;
  return {
    openIn: isOpenIn(stored.openIn) ? stored.openIn : DEFAULT_SETTINGS.openIn,
    autoOpen:
      typeof stored.autoOpen === 'boolean' ? stored.autoOpen : DEFAULT_SETTINGS.autoOpen,
    // Strictly a boolean: the string 'false' is truthy, so a loose check would
    // turn logging on for someone whose stored value was trying to turn it off.
    debugLogging:
      typeof stored.debugLogging === 'boolean'
        ? stored.debugLogging
        : DEFAULT_SETTINGS.debugLogging,
  };
}

/**
 * Whether auto-open can be offered for this destination.
 *
 * `same-tab` is excluded, and not as a matter of taste. Auto-opening over the
 * pull request page replaces it the instant you arrive; pressing Back returns
 * to the pull request, where the content script loads afresh and immediately
 * does it again. The reviewer is trapped with no way back short of editing the
 * URL. The options page disables the checkbox for this reason and
 * `openTarget` refuses the combination independently, because a settings
 * object written before that rule existed can still be sitting in storage.
 */
export function autoOpenAvailable(openIn: OpenIn): boolean {
  return openIn !== 'same-tab';
}
