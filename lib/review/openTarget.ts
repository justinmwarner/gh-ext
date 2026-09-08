/**
 * Where a review opens, decided as data.
 *
 * The worker performs the tab and window calls; it does not choose between
 * them. Everything that makes the choice — the reviewer's destination, whether
 * they asked or the extension is acting on its own, and whether a review tab
 * for this pull request already exists — is here, so all of it is testable in
 * plain Node.
 *
 * Pure: this module names no `browser.*` API and no DOM.
 */

import { type Settings, autoOpenAvailable } from '../settings';

/**
 * Who asked.
 *
 * The distinction drives focus and little else, but it drives it everywhere:
 * a click is a deliberate act and should land you where you asked to go, while
 * an automatic open must never take the page out from under someone who was
 * typing a comment on github.com.
 */
export type OpenReason = 'click' | 'auto';

export interface OpenRequest {
  settings: Settings;
  reason: OpenReason;
  /** The review page URL for the pull request being opened. */
  url: string;
  /**
   * The review tab already open for this pull request, or null.
   *
   * Supplied by the worker from its own registry of tabs it opened. Deliberately
   * not discovered by URL: `tabs.query({ url })` is the one tabs call that
   * requires the `tabs` permission, which this extension does not request.
   */
  existingTabId: number | null;
  /** The tab the request came from — always a github.com pull request page. */
  sender: { tabId: number; index: number };
}

export type OpenAction =
  /** A review tab already exists and nothing should disturb it. */
  | { kind: 'none'; tabId: number | null }
  | { kind: 'focus'; tabId: number }
  | {
      kind: 'create-tab';
      url: string;
      active: boolean;
      openerTabId: number;
      index: number;
    }
  | { kind: 'create-window'; url: string; focused: boolean }
  | { kind: 'update-tab'; tabId: number; url: string };

/**
 * Decide what to do about a request to open a review.
 *
 * The rules, in the order they apply:
 *
 * 1. Auto-open into the same tab is refused outright. See
 *    {@link autoOpenAvailable} — it replaces the pull request page on arrival
 *    and Back walks straight back into it. The options page will not let
 *    anyone configure this, but a settings object stored before that rule
 *    existed still can, so the refusal lives here too.
 * 2. `same-tab` navigates the sender and never consults the registry. Nothing
 *    is being duplicated, so there is nothing to deduplicate.
 * 3. An existing review tab is revealed on a click and left strictly alone on
 *    an automatic open — it is already there, and stealing focus for a tab the
 *    reviewer did not ask for is the behaviour this whole design avoids.
 * 4. Otherwise create one, focused only if the reviewer clicked.
 */
export function openTarget(request: OpenRequest): OpenAction {
  const { settings, reason, url, existingTabId, sender } = request;
  const deliberate = reason === 'click';

  if (reason === 'auto' && !autoOpenAvailable(settings.openIn)) {
    return { kind: 'none', tabId: null };
  }

  if (settings.openIn === 'same-tab') {
    return { kind: 'update-tab', tabId: sender.tabId, url };
  }

  if (existingTabId !== null) {
    return deliberate
      ? { kind: 'focus', tabId: existingTabId }
      : { kind: 'none', tabId: existingTabId };
  }

  if (settings.openIn === 'new-window') {
    return { kind: 'create-window', url, focused: deliberate };
  }

  return {
    kind: 'create-tab',
    url,
    active: deliberate,
    openerTabId: sender.tabId,
    // Immediately after the pull request it came from, rather than at the end
    // of a long tab strip where it reads as unrelated to what you were doing.
    index: sender.index + 1,
  };
}
