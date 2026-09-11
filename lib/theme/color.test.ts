import { describe, expect, it } from 'vitest';
import { AWAY_FROM, flatten, mix, parseHex, toHex } from './color';

const rgba = (r: number, g: number, b: number, a = 255) => ({ r, g, b, a });

describe('parseHex', () => {
  it('reads all four lengths a theme file actually uses', () => {
    expect(parseHex('#fff')).toEqual(rgba(255, 255, 255));
    expect(parseHex('#282a36')).toEqual(rgba(40, 42, 54));
    // Four and eight digits carry alpha, which is how editor themes write a
    // hover tint: `list.hoverBackground` is translucent in most of the list.
    expect(parseHex('#0008')).toEqual(rgba(0, 0, 0, 136));
    expect(parseHex('#44475a75')).toEqual(rgba(68, 71, 90, 117));
  });

  it('is case-insensitive, because theme files are not consistent about it', () => {
    expect(parseHex('#BD93F9')).toEqual(parseHex('#bd93f9'));
  });

  it('returns null rather than guessing at anything else', () => {
    for (const value of ['', 'red', 'rgb(1,2,3)', '#12', '#12345', 'fff', '#gggggg']) {
      expect(parseHex(value)).toBeNull();
    }
    expect(parseHex(undefined)).toBeNull();
  });
});

describe('toHex', () => {
  it('always writes six lower-case digits, and drops alpha', () => {
    expect(toHex(rgba(0, 0, 0))).toBe('#000000');
    expect(toHex(rgba(189, 147, 249, 16))).toBe('#bd93f9');
  });

  it('clamps rather than wrapping, so arithmetic cannot produce a stray colour', () => {
    expect(toHex(rgba(-20, 300, 127.6))).toBe('#00ff80');
  });
});

describe('mix', () => {
  it('returns each end at the extremes', () => {
    const top = rgba(255, 0, 0);
    const bottom = rgba(0, 0, 255);
    expect(toHex(mix(top, bottom, 1))).toBe('#ff0000');
    expect(toHex(mix(top, bottom, 0))).toBe('#0000ff');
  });

  it('is linear in between', () => {
    expect(toHex(mix(rgba(255, 255, 255), rgba(0, 0, 0), 0.5))).toBe('#808080');
  });

  it('clamps the amount, so a caller cannot overshoot past either end', () => {
    const top = rgba(255, 255, 255);
    const bottom = rgba(0, 0, 0);
    expect(toHex(mix(top, bottom, 4))).toBe('#ffffff');
    expect(toHex(mix(top, bottom, -4))).toBe('#000000');
  });

  it('produces an opaque result from translucent inputs', () => {
    expect(mix(rgba(0, 0, 0, 0), rgba(255, 255, 255, 10), 0.5).a).toBe(255);
  });
});

describe('flatten', () => {
  it('leaves an opaque colour alone', () => {
    expect(toHex(flatten(rgba(1, 2, 3), rgba(255, 255, 255)))).toBe('#010203');
  });

  it('composites a translucent one onto what is behind it', () => {
    // Half-alpha black over white, and the result carries no alpha — which is
    // what lets the generated table hold plain six-digit hex. `#7f` rather than
    // `#80` because 128/255 is a hair over a half, not a half.
    const result = flatten(rgba(0, 0, 0, 128), rgba(255, 255, 255));
    expect(toHex(result)).toBe('#7f7f7f');
    expect(result.a).toBe(255);
  });

  it('disappears entirely at zero alpha', () => {
    expect(toHex(flatten(rgba(255, 0, 0, 0), rgba(18, 52, 86)))).toBe('#123456');
  });
});

describe('AWAY_FROM', () => {
  // The one rule that lets a single derivation serve both halves of the theme
  // list: "away from the page" is darker on light and lighter on dark.
  it('points at black for a light theme and white for a dark one', () => {
    expect(toHex(AWAY_FROM.light)).toBe('#000000');
    expect(toHex(AWAY_FROM.dark)).toBe('#ffffff');
  });
});
