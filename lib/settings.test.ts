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
  autoOpenAvailable,
  isOpenIn,
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
      openIn: 'new-window',
      autoOpen: true,
    });
  });

  it('fills in a field that is missing', () => {
    expect(parseSettings({ autoOpen: true })).toEqual({
      openIn: DEFAULT_SETTINGS.openIn,
      autoOpen: true,
    });
  });

  it('keeps the good field when its neighbour is unrecognized', () => {
    // Per field rather than all-or-nothing: a destination this version does
    // not know about must not also discard the auto-open choice.
    expect(parseSettings({ openIn: 'floating-panel', autoOpen: true })).toEqual({
      openIn: DEFAULT_SETTINGS.openIn,
      autoOpen: true,
    });
  });

  it('ignores a non-boolean autoOpen rather than coercing it', () => {
    // `'false'` is truthy, so coercion here would turn a stored string into
    // auto-open being on.
    expect(parseSettings({ openIn: 'same-tab', autoOpen: 'false' })).toEqual({
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
