/**
 * The theme catalogue, held to the two things that can quietly break it.
 *
 * A wrong id is invisible until somebody picks that theme: the diff renders
 * with no highlighting at all and nothing on the page says why. And a
 * duplicated id would put the same theme in two groups, which reads as a bug in
 * the list rather than in the data behind it.
 */

import { describe, expect, it } from 'vitest';
import {
  ACCESSIBLE_THEMES,
  DARK_THEMES,
  DIFF_THEMES,
  LIGHT_THEMES,
  THEME_FOLLOWS_PAGE,
  diffTheme,
  isDiffTheme,
} from './themes';

describe('the theme catalogue', () => {
  it('names every theme once', () => {
    const ids = DIFF_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every theme a label and a mode', () => {
    const wrong = DIFF_THEMES.filter(
      (theme) =>
        theme.label.trim() === '' ||
        (theme.mode !== 'light' && theme.mode !== 'dark'),
    );
    expect(wrong).toEqual([]);
  });

  it('puts the colour vision themes first, and nowhere else', () => {
    // They lead the list because they are the reason the setting exists, and
    // a reviewer who needs one should not have to read past seventy others.
    expect(DIFF_THEMES.slice(0, ACCESSIBLE_THEMES.length)).toEqual(
      ACCESSIBLE_THEMES,
    );
    const elsewhere = [...LIGHT_THEMES, ...DARK_THEMES].filter((theme) =>
      ACCESSIBLE_THEMES.some((accessible) => accessible.id === theme.id),
    );
    expect(elsewhere).toEqual([]);
  });

  it('covers both protanopia/deuteranopia and tritanopia, in both modes', () => {
    // Four entries, not two: a reviewer on a light page and a reviewer on a
    // dark one both need one, and the setting names a single theme rather than
    // a pair.
    expect(ACCESSIBLE_THEMES.map((theme) => theme.id).sort()).toEqual([
      'pierre-dark-protanopia-deuteranopia',
      'pierre-dark-tritanopia',
      'pierre-light-protanopia-deuteranopia',
      'pierre-light-tritanopia',
    ]);
  });

  it('groups each theme under the mode it declares', () => {
    expect(LIGHT_THEMES.filter((theme) => theme.mode !== 'light')).toEqual([]);
    expect(DARK_THEMES.filter((theme) => theme.mode !== 'dark')).toEqual([]);
  });

  it('accepts the default and every id it offers', () => {
    expect(isDiffTheme(THEME_FOLLOWS_PAGE)).toBe(true);
    expect(DIFF_THEMES.every((theme) => isDiffTheme(theme.id))).toBe(true);
  });

  it('refuses anything it cannot draw', () => {
    // What a settings blob from a later version, or from a typo, looks like.
    expect(isDiffTheme('solarized-mauve')).toBe(false);
    expect(isDiffTheme(null)).toBe(false);
    expect(isDiffTheme(7)).toBe(false);
    // Not inherited from Object.prototype, which a bare `in` check would pass.
    expect(isDiffTheme('constructor')).toBe(false);
    expect(isDiffTheme('toString')).toBe(false);
  });

  it('looks a theme up, and answers null for the default', () => {
    expect(diffTheme('nord')?.mode).toBe('dark');
    expect(diffTheme('github-light-high-contrast')?.mode).toBe('light');
    expect(diffTheme(THEME_FOLLOWS_PAGE)).toBeNull();
    expect(diffTheme('not-a-theme')).toBeNull();
  });
});
