/**
 * Where a review opens.
 *
 * Three destinations times two reasons, plus the registry hit that stops a
 * second click opening a second tab. The cases worth spelling out are the ones
 * where the two axes interact: focus, and the same-tab combination that has to
 * be refused.
 */

import { describe, expect, it } from 'vitest';
import type { OpenIn, Settings } from '../settings';
import { type OpenReason, openTarget } from './openTarget';

const URL = 'chrome-extension://abc/review.html#/pr/acme/widgets/7';

const settings = (openIn: OpenIn, autoOpen = true): Settings => ({
  openIn,
  autoOpen,
  // None of these three touch where a review opens; they are here because
  // Settings requires them.
  debugLogging: false,
  ignoreWhitespace: false,
  splitView: false,
  hideGenerated: false,
});

const ask = (
  openIn: OpenIn,
  reason: OpenReason,
  existingTabId: number | null = null,
) =>
  openTarget({
    settings: settings(openIn),
    reason,
    url: URL,
    existingTabId,
    sender: { tabId: 11, index: 3 },
  });

describe('a new tab', () => {
  it('opens one, active, when the reviewer clicks', () => {
    expect(ask('new-tab', 'click')).toEqual({
      kind: 'create-tab',
      url: URL,
      active: true,
      openerTabId: 11,
      index: 4,
    });
  });

  it('opens one in the background when nobody asked', () => {
    // The reviewer may be part-way through a comment on github.com. The tab is
    // prepared, not thrust in front of them.
    expect(ask('new-tab', 'auto')).toMatchObject({ kind: 'create-tab', active: false });
  });

  it('places it immediately after the pull request it came from', () => {
    expect(ask('new-tab', 'click')).toMatchObject({ index: 4, openerTabId: 11 });
  });
});

describe('a new window', () => {
  it('opens one, focused, when the reviewer clicks', () => {
    expect(ask('new-window', 'click')).toEqual({
      kind: 'create-window',
      url: URL,
      focused: true,
    });
  });

  it('opens one unfocused when nobody asked', () => {
    expect(ask('new-window', 'auto')).toEqual({
      kind: 'create-window',
      url: URL,
      focused: false,
    });
  });
});

describe('the same tab', () => {
  it('navigates the sender', () => {
    expect(ask('same-tab', 'click')).toEqual({
      kind: 'update-tab',
      tabId: 11,
      url: URL,
    });
  });

  it('navigates the sender even when a review tab already exists', () => {
    // Nothing is being duplicated, so there is nothing to deduplicate. The
    // reviewer asked for this page to become the review.
    expect(ask('same-tab', 'click', 42)).toEqual({
      kind: 'update-tab',
      tabId: 11,
      url: URL,
    });
  });

  it('refuses to do it automatically', () => {
    // Replacing the pull request page on arrival leaves Back walking into a
    // page that immediately replaces itself again. The options page will not
    // offer this pairing; a settings object stored before that rule existed
    // still can, which is why the refusal is here and not only there.
    expect(ask('same-tab', 'auto')).toEqual({ kind: 'none', tabId: null });
  });
});

describe('a review tab that is already open', () => {
  it('is revealed rather than duplicated on a click', () => {
    expect(ask('new-tab', 'click', 42)).toEqual({ kind: 'focus', tabId: 42 });
  });

  it('is revealed rather than duplicated for a new window too', () => {
    expect(ask('new-window', 'click', 42)).toEqual({ kind: 'focus', tabId: 42 });
  });

  it('is left strictly alone on an automatic open', () => {
    // It is already there. Pulling focus to a tab nobody asked for is the
    // behaviour this whole design exists to avoid.
    expect(ask('new-tab', 'auto', 42)).toEqual({ kind: 'none', tabId: 42 });
  });

  it('reports which tab it was, so the caller can answer honestly', () => {
    const action = ask('new-tab', 'auto', 42);
    expect(action).toMatchObject({ tabId: 42 });
  });
});
