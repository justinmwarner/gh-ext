/**
 * What a stored settings blob is allowed to mean.
 *
 * The interesting cases are all the ones where storage holds something other
 * than what this version writes: nothing yet, half an object, a value from a
 * later version, or something that is not an object at all. Every one of them
 * has to produce usable settings, because the caller is the background worker
 * on the path to opening a review.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EMPTY_MODE_MEMORY,
  autoOpenAvailable,
  isOpenIn,
  parseModeMemory,
  parseSettings,
} from './settings';

describe('parseSettings', () => {
  it('returns the defaults for a storage area that has never been written', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to a new tab rather than replacing the pull request page', () => {
    expect(DEFAULT_SETTINGS.openIn).toBe('new-tab');
  });

  it('defaults auto-open off', () => {
    // Opt-in, because a tab that appears unasked on someone's first pull
    // request reads as a malfunction rather than a feature.
    expect(DEFAULT_SETTINGS.autoOpen).toBe(false);
  });

  it('reads a complete object back unchanged', () => {
    expect(parseSettings({ openIn: 'new-window', autoOpen: true })).toEqual({
      ...DEFAULT_SETTINGS,
      openIn: 'new-window',
      autoOpen: true,
    });
  });

  it('fills in a field that is missing', () => {
    expect(parseSettings({ autoOpen: true })).toEqual({
      ...DEFAULT_SETTINGS,
      autoOpen: true,
    });
  });

  it('keeps the good field when its neighbour is unrecognized', () => {
    // Per field rather than all-or-nothing: a destination this version does
    // not know about must not also discard the auto-open choice.
    expect(parseSettings({ openIn: 'floating-panel', autoOpen: true })).toEqual({
      ...DEFAULT_SETTINGS,
      autoOpen: true,
    });
  });

  it('ignores a non-boolean autoOpen rather than coercing it', () => {
    // `'false'` is truthy, so coercion here would turn a stored string into
    // auto-open being on.
    expect(parseSettings({ openIn: 'same-tab', autoOpen: 'false' })).toEqual({
      ...DEFAULT_SETTINGS,
      openIn: 'same-tab',
      autoOpen: false,
    });
  });

  it.each([null, 'new-tab', 42, ['new-tab']])(
    'returns the defaults for %o, which is not an object',
    (raw) => {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('ignores unknown fields', () => {
    expect(parseSettings({ openIn: 'new-tab', autoOpen: false, theme: 'dark' })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('returns a fresh object, so a caller cannot edit the defaults', () => {
    const parsed = parseSettings(undefined);
    parsed.openIn = 'same-tab';
    expect(DEFAULT_SETTINGS.openIn).toBe('new-tab');
  });
});

describe('isOpenIn', () => {
  it.each(['new-tab', 'new-window', 'same-tab'])('accepts %s', (value) => {
    expect(isOpenIn(value)).toBe(true);
  });

  it('rejects an inherited property name', () => {
    // `in` would say true here. The lookup table is consulted with `hasOwn`
    // precisely so `Object.prototype` cannot supply a destination.
    expect(isOpenIn('constructor')).toBe(false);
    expect(isOpenIn('toString')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isOpenIn(0)).toBe(false);
    expect(isOpenIn(null)).toBe(false);
  });
});

describe('autoOpenAvailable', () => {
  it('allows auto-open into a new tab or a new window', () => {
    expect(autoOpenAvailable('new-tab')).toBe(true);
    expect(autoOpenAvailable('new-window')).toBe(true);
  });

  it('refuses auto-open into the same tab', () => {
    // Auto-opening over the pull request page replaces it on arrival, and Back
    // returns to a page that immediately does it again.
    expect(autoOpenAvailable('same-tab')).toBe(false);
  });
});

describe('debugLogging', () => {
  it('is off by default, because the console belongs to the reviewer', () => {
    // The default that matters most here. Almost every install never opens the
    // options page, so this is what almost every user gets.
    expect(DEFAULT_SETTINGS.debugLogging).toBe(false);
  });

  it('is read back when it was stored', () => {
    expect(parseSettings({ debugLogging: true }).debugLogging).toBe(true);
  });

  it('falls back to off for a non-boolean, rather than being truthy', () => {
    // A stored string is the realistic corruption — 'true' from a hand-edited
    // storage entry — and `'false'` is truthy, so a loose check would turn
    // logging on for someone trying to turn it off.
    expect(parseSettings({ debugLogging: 'false' }).debugLogging).toBe(false);
    expect(parseSettings({ debugLogging: 'true' }).debugLogging).toBe(false);
  });

  it('survives alongside the other settings', () => {
    expect(parseSettings({ openIn: 'new-window', autoOpen: true, debugLogging: true })).toEqual(
      { ...DEFAULT_SETTINGS, openIn: 'new-window', autoOpen: true, debugLogging: true },
    );
  });
});

describe('how a diff is drawn', () => {
  it('defaults to one column, which is what GitHub sends you from', () => {
    expect(DEFAULT_SETTINGS.splitView).toBe(false);
  });

  it('defaults to hiding nothing', () => {
    // The only setting here that removes lines from a diff, so the default is
    // the one that removes none of them. A reviewer who has never opened the
    // options page must never be reading a shortened diff.
    expect(DEFAULT_SETTINGS.ignoreWhitespace).toBe(false);
  });

  it('defaults to folding nothing away', () => {
    expect(DEFAULT_SETTINGS.hideGenerated).toBe(false);
  });

  it.each(['splitView', 'ignoreWhitespace', 'hideGenerated'] as const)(
    'reads a stored %s',
    (key) => {
      expect(parseSettings({ [key]: true })[key]).toBe(true);
    },
  );

  it('leaves the syntax theme to Pierre until asked otherwise', () => {
    expect(DEFAULT_SETTINGS.diffTheme).toBe('');
    expect(parseSettings({}).diffTheme).toBe('');
  });

  it('reads a stored syntax theme', () => {
    expect(parseSettings({ diffTheme: 'nord' }).diffTheme).toBe('nord');
    expect(
      parseSettings({ diffTheme: 'pierre-dark-tritanopia' }).diffTheme,
    ).toBe('pierre-dark-tritanopia');
  });

  it('falls back rather than handing Pierre a theme it cannot draw', () => {
    // A settings blob from a later version, or a theme Shiki has dropped.
    // Passed through, it renders a diff with no highlighting and no
    // explanation; refused here, the reviewer gets the default back.
    expect(parseSettings({ diffTheme: 'solarized-mauve' }).diffTheme).toBe('');
    expect(parseSettings({ diffTheme: 42 }).diffTheme).toBe('');
    expect(parseSettings({ diffTheme: null }).diffTheme).toBe('');
  });

  it.each(['splitView', 'ignoreWhitespace', 'hideGenerated'] as const)(
    'falls back to off for a non-boolean %s',
    (key) => {
      // `'false'` is truthy. On `ignoreWhitespace` a loose check would start
      // hiding lines for someone whose stored value was trying to stop it.
      expect(parseSettings({ [key]: 'false' })[key]).toBe(false);
      expect(parseSettings({ [key]: 'true' })[key]).toBe(false);
      expect(parseSettings({ [key]: 1 })[key]).toBe(false);
    },
  );

  it('keeps one when its neighbour is corrupt', () => {
    expect(parseSettings({ splitView: true, ignoreWhitespace: 'yes' })).toEqual({
      ...DEFAULT_SETTINGS,
      splitView: true,
    });
  });
});

describe('parseModeMemory', () => {
  // `markdown:rendered` rather than `raw`, which every kind offers and which
  // would therefore pass against an implementation asking `modesFor` about the
  // wrong kind entirely. It also pins the decision the function argues for: a
  // `needsBothSides` mode is accepted here and narrowed per file later, so a
  // later "tightening" that rejected it at this altitude would fail.
  it('reads a remembered markdown mode', () => {
    expect(parseModeMemory({ markdown: 'markdown:rendered' })).toEqual({
      markdown: 'markdown:rendered',
    });
  });

  it.each([null, undefined, 'raw', 42, []])('falls back on %p', (raw) => {
    expect(parseModeMemory(raw)).toEqual({});
  });

  // `toEqual({})` is true of the shared constant as well, so without this the
  // fallback could go back to handing every caller the same object and no test
  // would notice.
  it('falls back on a fresh object rather than the shared one', () => {
    expect(parseModeMemory(null)).not.toBe(EMPTY_MODE_MEMORY);
  });

  // Pins intent rather than catching a regression, and is worth having for
  // that: the mode id check below shadows this one behaviourally, since no
  // number or null can match an id, so deleting the `typeof` guard would break
  // the types and no test. What the guard says is that a stored value of the
  // wrong shape is an ordinary thing to find rather than a reason to throw.
  it.each([42, null])('drops the non-string value %p', (mode) => {
    expect(parseModeMemory({ markdown: mode })).toEqual({});
  });

  // A kind this build does not remember, written by a later one.
  it('drops a kind that is not remembered', () => {
    expect(parseModeMemory({ image: 'image:swipe' })).toEqual({});
  });

  // A mode id from a later build, or one that has since been withdrawn.
  it('drops an unknown mode id', () => {
    expect(parseModeMemory({ markdown: 'markdown:side-by-side' })).toEqual({});
  });

  // A real mode, but not one this kind offers. Storing it would put a control
  // on the card that the file cannot answer.
  it('drops a mode belonging to another kind', () => {
    expect(parseModeMemory({ markdown: 'image:swipe' })).toEqual({});
  });

  // Per field, like parseSettings: one bad entry must not discard a good one.
  it('keeps a good entry beside a bad one', () => {
    expect(parseModeMemory({ markdown: 'raw', image: 'nonsense' })).toEqual({
      markdown: 'raw',
    });
  });
});
