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

const settings = (
  openIn: OpenIn,
  autoOpen = true,
  openInBackground = false,
): Settings => ({
  openIn,
  autoOpen,
  openInBackground,
  // None of these touch where a review opens; they are here because Settings
  // requires them.
  debugLogging: false,
  ignoreWhitespace: false,
  splitView: false,
  hideGenerated: false,
  diffTheme: '',
  lineDiff: 'word-alt',
  collapseTree: false,
  generatedPatterns: [],
  releaseFindKey: false,
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

/**
 * Opening without going along.
 *
 * A third axis crossing the two above, and the only thing it touches is focus:
 * the review still opens, in the same place, at the same position in the strip.
 * The cases worth spelling out are the three where it does *not* apply —
 * `same-tab`, which has no background to open into; an automatic open, which
 * was already unfocused and cannot be made more so; and a review tab that
 * already exists, which is not being opened at all.
 */
describe('opening in the background', () => {
  const behind = (
    openIn: OpenIn,
    reason: OpenReason,
    existingTabId: number | null = null,
  ) =>
    openTarget({
      settings: settings(openIn, true, true),
      reason,
      url: URL,
      existingTabId,
      sender: { tabId: 11, index: 3 },
    });

  it('opens a new tab without moving to it, even though the reviewer clicked', () => {
    expect(behind('new-tab', 'click')).toEqual({
      kind: 'create-tab',
      url: URL,
      active: false,
      openerTabId: 11,
      index: 4,
    });
  });

  it('still puts it beside the pull request it came from', () => {
    // Only focus is given up. A queued review that landed at the end of a long
    // tab strip would read as unrelated to what the reviewer was doing.
    expect(behind('new-tab', 'click')).toMatchObject({ index: 4 });
  });

  it('opens a new window unfocused', () => {
    expect(behind('new-window', 'click')).toEqual({
      kind: 'create-window',
      url: URL,
      focused: false,
    });
  });

  it('changes nothing about an automatic open, which was already behind', () => {
    expect(behind('new-tab', 'auto')).toEqual({
      kind: 'create-tab',
      url: URL,
      active: false,
      openerTabId: 11,
      index: 4,
    });
  });

  it('is ignored for the same tab, which has no background to open into', () => {
    expect(behind('same-tab', 'click')).toEqual({
      kind: 'update-tab',
      tabId: 11,
      url: URL,
    });
  });

  it('still reveals a review tab that already exists', () => {
    // That click is not an open — the tab was opened earlier and is sitting in
    // the strip. Refusing to reveal it would leave the button doing nothing
    // the reviewer could see, which reads as broken rather than as deferred.
    expect(behind('new-tab', 'click', 42)).toEqual({ kind: 'focus', tabId: 42 });
  });

  it('leaves an automatic open of an existing tab alone, as it always did', () => {
    expect(behind('new-tab', 'auto', 42)).toEqual({ kind: 'none', tabId: 42 });
  });
});
