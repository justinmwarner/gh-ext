import { describe, expect, it } from 'vitest';
import { DIFF_THEMES, THEME_FOLLOWS_PAGE } from '../compare/themes';
import { deriveChromeTheme, packPalette } from './derive';
import { THEMED_COUNT, chromeTheme } from './palettes';
import { CHROME_TOKENS, decodePalette } from './tokens';

/** The same load the generator does, so the comparison is like for like. */
async function resolve(id: string) {
  const { themes } = await import('@pierre/theming/themes');
  const descriptor = themes.getThemes().find((entry) => entry.name === id);
  expect(descriptor, `@pierre/theming has no theme called ${id}`).toBeDefined();
  const loaded = await descriptor!.load();
  return (loaded as { default?: unknown }).default ?? loaded;
}

describe('the generated table', () => {
  it('covers every theme the options page offers', () => {
    expect(THEMED_COUNT).toBe(DIFF_THEMES.length);
    for (const theme of DIFF_THEMES) {
      expect(chromeTheme(theme.id), `no palette for ${theme.id}`).not.toBeNull();
    }
  });

  it('gives every theme a value for every token', () => {
    for (const theme of DIFF_THEMES) {
      const palette = chromeTheme(theme.id)!.palette;
      for (const token of CHROME_TOKENS) {
        expect(palette[token], `${theme.id} has no ${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('agrees with each theme about which mode it was built for', () => {
    for (const theme of DIFF_THEMES) {
      expect(chromeTheme(theme.id)!.scheme, theme.id).toBe(theme.mode);
    }
  });

  /**
   * The check that makes the table safe to commit.
   *
   * A generated file is only trustworthy while something fails when it falls
   * behind what generated it. Editing `derive.ts` and forgetting
   * `npm run palettes` would otherwise ship a build whose themes are a mix of
   * two derivations, with nothing on screen to say so.
   */
  it('is what the current derivation produces', async () => {
    for (const theme of DIFF_THEMES) {
      const derived = deriveChromeTheme(await resolve(theme.id));
      expect(packPalette(derived.palette), `${theme.id} is stale: run \`npm run palettes\``).toBe(
        packPalette(chromeTheme(theme.id)!.palette),
      );
    }
  }, 60_000);
});

describe('chromeTheme', () => {
  it('has no palette for the default, which is the point of the default', () => {
    // Not an oversight and not a missing row: left unset, `ui/tokens.css` keeps
    // its Primer pairs and nothing overrides them. A palette here would make
    // the default one more theme rather than the absence of one.
    expect(chromeTheme(THEME_FOLLOWS_PAGE)).toBeNull();
  });

  it('has no palette for a theme this build cannot draw', () => {
    // A theme id written by a later version, or one Shiki has since dropped.
    // Null sends the surface back to the defaults instead of half-dressing it.
    expect(chromeTheme('theme-from-the-future')).toBeNull();
  });

  it('reads a couple of themes back as their authors wrote them', () => {
    // Two spot checks against values that are recognisably each theme's own,
    // so a change that silently repoints a chain has something to fail against.
    const dracula = chromeTheme('dracula')!;
    expect(dracula.palette['--canvas-default']).toBe('#282a36');
    expect(dracula.palette['--fg-default']).toBe('#f8f8f2');
    expect(dracula.palette['--success-fg']).toBe('#50fa7b');

    const solarized = chromeTheme('solarized-light')!;
    expect(solarized.scheme).toBe('light');
    expect(solarized.palette['--canvas-default']).toBe('#fdf6e3');
    // Solarized's actual blue, and the reason `terminal.ansiBlue` sits ahead of
    // the focus ring in the accent chain — the ring here is a tan, `#b49471`.
    expect(solarized.palette['--accent-fg']).toBe('#268bd2');
  });

  it('never hands a page a border it cannot see', () => {
    // The one repair the derivation makes to a stated value, checked across the
    // whole list rather than on the theme that prompted it.
    for (const theme of DIFF_THEMES) {
      const palette = chromeTheme(theme.id)!.palette;
      expect(palette['--border-default'], theme.id).not.toBe(palette['--canvas-default']);
    }
  });
});

describe('decodePalette', () => {
  it('round-trips a packed palette', () => {
    const palette = chromeTheme('nord')!.palette;
    expect(decodePalette(packPalette(palette))).toEqual(palette);
  });

  it('refuses a row with the wrong number of values', () => {
    // The failure mode the positional encoding has and an object would not:
    // a token inserted in the middle reinterprets every stored palette. Length
    // catches the common half of that, and the staleness test above the rest.
    expect(() => decodePalette('#000000,#ffffff')).toThrow(/npm run palettes/);
  });
});
