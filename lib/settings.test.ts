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
  MAX_PATTERNS,
  MAX_PATTERN_LENGTH,
  autoOpenAvailable,
  isLineDiff,
  isOpenIn,
  parseModeMemory,
  parsePatterns,
  parseRailWidth,
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

describe('the dashboard settings', () => {
  it('defaults the staleness horizon to a fortnight', () => {
    expect(parseSettings({}).stalenessDays).toBe(14);
  });

  it('takes a stored horizon', () => {
    expect(parseSettings({ stalenessDays: 30 }).stalenessDays).toBe(30);
  });

  it('refuses a horizon of zero', () => {
    // Zero would send every pull request to Quiet the moment it was read,
    // which is a dashboard that has emptied itself.
    expect(parseSettings({ stalenessDays: 0 }).stalenessDays).toBe(14);
  });

  it('refuses a negative or fractional horizon', () => {
    expect(parseSettings({ stalenessDays: -5 }).stalenessDays).toBe(14);
    expect(parseSettings({ stalenessDays: 1.5 }).stalenessDays).toBe(14);
  });

  it('refuses a horizon that is not a number', () => {
    expect(parseSettings({ stalenessDays: '30' }).stalenessDays).toBe(14);
  });

  it('watches nothing by default', () => {
    expect(parseSettings({}).watchedRepos).toEqual([]);
  });

  it('takes a stored watch list', () => {
    expect(parseSettings({ watchedRepos: ['acme/widgets'] }).watchedRepos).toEqual([
      'acme/widgets',
    ]);
  });

  it('drops entries of a watch list that are not repository names', () => {
    expect(
      parseSettings({ watchedRepos: ['acme/widgets', 7, null, '', 'nope'] }).watchedRepos,
    ).toEqual(['acme/widgets']);
  });

  it('refuses a watch list that is not a list', () => {
    expect(parseSettings({ watchedRepos: 'acme/widgets' }).watchedRepos).toEqual([]);
  });

  it('does not hand out the defaults own array', () => {
    // A shallow spread of DEFAULT_SETTINGS shares this reference, so one
    // caller pushing onto what it got back would add a watched repository to
    // every future parse in the process — including the worker's.
    const first = parseSettings(undefined);
    first.watchedRepos.push('acme/widgets');

    expect(parseSettings(undefined).watchedRepos).toEqual([]);
    expect(DEFAULT_SETTINGS.watchedRepos).toEqual([]);
  });
});

describe('parsePatterns', () => {
  it('defaults to nothing, so folding cannot arrive already configured', () => {
    // The same rule ignoreWhitespace answers to: a preference that folds a
    // file away must not be able to be on without the reviewer asking.
    expect(DEFAULT_SETTINGS.generatedPatterns).toEqual([]);
  });

  it('cannot be mutated through the default', () => {
    // Frozen rather than copied per read: a shared mutable default is how one
    // caller's push becomes every caller's pattern.
    expect(() => {
      (DEFAULT_SETTINGS.generatedPatterns as string[]).push('**/*.go');
    }).toThrow();
  });

  it.each([undefined, null, 'string', 42, {}])(
    'falls back to nothing for the non-array %p',
    (raw) => {
      expect(parsePatterns(raw)).toEqual([]);
    },
  );

  it('reads a list of globs back unchanged', () => {
    expect(parsePatterns(['**/*.pb.go', 'api/generated/**'])).toEqual([
      '**/*.pb.go',
      'api/generated/**',
    ]);
  });

  it('trims the whitespace a typed line arrives with', () => {
    expect(parsePatterns(['  **/*.pb.go  '])).toEqual(['**/*.pb.go']);
  });

  it('drops a blank line rather than storing it', () => {
    // An empty glob matches every path, so storing one would fold away the
    // whole pull request. A reviewer typing a list leaves blank lines behind.
    expect(parsePatterns(['**/*.pb.go', '', '   '])).toEqual(['**/*.pb.go']);
  });

  it('drops a duplicate, which is a second regexp run over every path', () => {
    expect(parsePatterns(['**/*.lock', '**/*.lock'])).toEqual(['**/*.lock']);
  });

  it('keeps the good entry beside a bad one', () => {
    // Per entry, like parseSettings and parseModeMemory.
    expect(parsePatterns(['**/*.pb.go', 42, null])).toEqual(['**/*.pb.go']);
  });

  it('drops a pattern longer than the cap', () => {
    expect(parsePatterns(['a'.repeat(MAX_PATTERN_LENGTH + 1)])).toEqual([]);
  });

  it('keeps a pattern exactly at the cap', () => {
    const glob = 'a'.repeat(MAX_PATTERN_LENGTH);
    expect(parsePatterns([glob])).toEqual([glob]);
  });

  it('stops at the count cap', () => {
    // A bound on what a corrupted blob can make the matcher do, not a
    // judgement about how many globs a reviewer needs: every one of these is
    // compiled and run against every path in the pull request.
    const many = Array.from({ length: MAX_PATTERNS + 10 }, (_, at) => `p${at}/**`);
    expect(parsePatterns(many)).toHaveLength(MAX_PATTERNS);
  });
});

describe('isLineDiff', () => {
  it.each(['word-alt', 'word', 'char', 'none'])('accepts %p', (value) => {
    expect(isLineDiff(value)).toBe(true);
  });

  it.each(['line', '', 42, null, undefined])('refuses %p', (value) => {
    expect(isLineDiff(value)).toBe(false);
  });

  it('refuses an inherited property name', () => {
    // hasOwn rather than `in`, so Object.prototype's keys are not granularities.
    expect(isLineDiff('constructor')).toBe(false);
  });

  it('keeps Pierre’s own default, restated so the page can draw it', () => {
    expect(DEFAULT_SETTINGS.lineDiff).toBe('word-alt');
  });

  it('falls back rather than passing an unknown value to Pierre', () => {
    // A granularity from a later build reaching the diff column is a diff
    // drawn some way nobody chose, with nothing on the page to say why.
    expect(parseSettings({ lineDiff: 'syllable' }).lineDiff).toBe('word-alt');
  });
});

describe('parseRailWidth', () => {
  it('reads a stored width back', () => {
    expect(parseRailWidth(320, 180, 560)).toBe(320);
  });

  it.each([undefined, null, '320', Number.NaN, Number.POSITIVE_INFINITY])(
    'answers null for %p, meaning no answer yet',
    (raw) => {
      expect(parseRailWidth(raw, 180, 560)).toBeNull();
    },
  );

  it('clamps a width from a wider monitor', () => {
    // Otherwise the rail leaves no room for the diff and cannot be grabbed to
    // fix, which is a stuck page rather than a wrong one.
    expect(parseRailWidth(2000, 180, 560)).toBe(560);
  });

  it('clamps a width below the minimum', () => {
    expect(parseRailWidth(10, 180, 560)).toBe(180);
  });

  it('rounds a fractional width to a whole pixel', () => {
    expect(parseRailWidth(320.6, 180, 560)).toBe(321);
  });
});

describe('the new preferences default off', () => {
  // Each of these changes what a first review looks like, so each defaults to
  // what GitHub itself does until the reviewer says otherwise.
  it.each(['openInBackground', 'collapseTree', 'releaseFindKey'] as const)(
    '%s',
    (key) => {
      expect(DEFAULT_SETTINGS[key]).toBe(false);
    },
  );

  it('ignores a non-boolean rather than coercing it', () => {
    // The string 'false' is truthy, so a loose check would turn a setting on
    // for someone whose stored value was trying to turn it off.
    expect(parseSettings({ openInBackground: 'false' }).openInBackground).toBe(false);
  });
});
