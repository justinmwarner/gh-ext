/**
 * One syntax theme in, the whole extension's chrome out.
 *
 * ## Why this exists
 *
 * Choosing a theme used to recolour the code inside a diff and nothing else, so
 * a reviewer on Dracula got Dracula in the diff and GitHub's white page around
 * it. That is a seam inside the product, which PRODUCT.md's fifth principle
 * says there must not be — it just happened to have been written about the
 * three surfaces rather than about the two halves of one screen.
 *
 * So the reviewer's choice now reaches everything. `ui/tokens.css` is what
 * makes that affordable: every colour on all three surfaces already goes
 * through about forty named tokens, so retheming is a matter of producing forty
 * values rather than of touching three thousand lines of CSS.
 *
 * ## What it does not do
 *
 * **It never runs for the default.** Left on "Match the page", nothing here is
 * consulted at all: `ui/tokens.css` keeps its hand-matched Primer pairs with
 * their measured contrast ratios, and the extension looks exactly as it did.
 * That is the deliberate split — the default ships accessible, and a theme the
 * reviewer went and chose is rendered as its author wrote it.
 *
 * **It does not second-guess a theme's colours.** Where a theme states a value
 * this takes it, even when Primer would have picked something with more
 * contrast. The one exception is a value that is not so much a colour as a
 * missing one: a border indistinguishable from the page it separates, or a
 * hover tint identical to the surface under it. `@pierre/theming` repairs the
 * second itself; the first is repaired here.
 *
 * ## Shape of the derivation
 *
 * Three kinds of token, and it is worth knowing which is which when reading
 * below:
 *
 * - **Stated.** The theme has a workbench key for it. Taken, flattened against
 *   its surface so the table can hold opaque hex.
 * - **Chained.** The theme may have one of several keys. The chains are ordered
 *   by how often themes actually declare them, measured across all seventy-five
 *   rather than guessed, and every chain ends somewhere that cannot fail.
 * - **Stepped.** No theme states it: a hover, a tint, a panel edge. Derived by
 *   moving a stated colour a fixed distance toward the page or away from it.
 *   "Away from the page" is darker on a light theme and lighter on a dark one,
 *   which is the one rule that lets a single derivation serve both halves of
 *   the list.
 *
 * Pure, and only reachable from the generator and its tests — the runtime reads
 * the baked table in `lib/theme/palettes.ts` instead, so no surface pays for
 * `@pierre/theming/color` or for this arithmetic.
 */

import type { ThemeLike } from '@pierre/theming';
import { colorUtils, normalizeThemeColors } from '@pierre/theming/color';
import { AWAY_FROM, type Rgba, flatten, mix, parseHex, toHex } from './color';
import { CHROME_TOKENS, type ChromePalette, type ChromeTheme } from './tokens';

/**
 * Where a chain ends when a theme states nothing at all.
 *
 * Primer's own values, and reaching one is not a failure: a theme with no
 * opinion about "danger" has none to honour, and this system's red is a better
 * answer than a token left undefined or collapsed onto the body text colour,
 * which would draw additions and deletions in one colour. The greens and reds
 * are reached by a handful of themes and the purple by rather more, because
 * `terminal.ansi*` is optional and plenty of theme authors skip it.
 */
const LAST_RESORT = {
  accent: '#0969da',
  success: '#1a7f37',
  danger: '#cf222e',
  attention: '#9a6700',
  done: '#8250df',
} as const;

/** How far a "subtle" tint of a status colour sits from the page. */
const TINT = 0.14;
/** The same tint, one step on, for the hover of a tinted panel. */
const TINT_HOVER = 0.22;
/** A selected row: stronger than a tint, still not a fill. */
const TINT_SELECTED = 0.3;
/** The edge of a tinted panel. */
const TINT_BORDER = 0.42;
/** A neutral surface under the cursor. */
const HOVER_STEP = 0.07;
/** How far a fill moves when the cursor is on it. */
const FILL_HOVER_STEP = 0.1;
/** A status colour drawn on an already-tinted panel rather than on the page. */
const ON_TINT_STEP = 0.25;

type Colors = Record<string, string>;

/** The first key this theme actually states, flattened onto `under`. */
function chain(colors: Colors, under: Rgba, keys: readonly string[]): Rgba | null {
  for (const key of keys) {
    const parsed = parseHex(colors[key]);
    // Fully transparent is a theme saying "nothing here", not a colour.
    if (parsed === null || parsed.a === 0) continue;
    return flatten(parsed, under);
  }
  return null;
}

/** How far apart two colours are, as a WCAG ratio. 1 means identical. */
function ratio(a: Rgba, b: Rgba): number {
  const one = colorUtils.relativeLuminance(toHex(a));
  const two = colorUtils.relativeLuminance(toHex(b));
  if (one === null || two === null) return 1;
  return colorUtils.contrastRatio(one, two);
}

/**
 * Is this stated value a structural border, or the theme's accent in disguise?
 *
 * `panel.border` is one divider in an editor and can afford to be decorative:
 * Dracula sets it to `#BD93F9`, a full-strength purple, and in VS Code that
 * draws a single line down the side of a panel. Here the same token draws every
 * control outline, every panel edge and every divider on the review page —
 * sixty declarations — and a page ruled in bright purple is not what a reviewer
 * chose when they chose Dracula. It would also collide with the purple this
 * system already uses to mean "merged".
 *
 * So a stated border is taken when it behaves like structure and declined when
 * it behaves like an accent. Below the floor it is invisible against the page
 * and separates nothing; above the ceiling it is a decoration. The band was set
 * against the list: it keeps GitHub Light's `#e1e4e8` at 1.25:1, Nord's
 * `#3b4252` at 1.2:1, Tokyo Night's `#101014` at 1.3:1 and Catppuccin Mocha's
 * `#585b70` at 2.7:1, and declines Dracula's purple at 5.9:1.
 */
function isStructural(border: Rgba, page: Rgba): boolean {
  const measured = ratio(border, page);
  return measured >= 1.15 && measured <= 4;
}

/**
 * The more readable of near-white and near-black on this one fill.
 *
 * Per fill rather than once for all of them, which is the point: it lets every
 * badge stay legible without a single theme colour being altered. See the note
 * on the `--on-*` group in `lib/theme/tokens.ts`.
 */
function labelFor(fill: Rgba, page: Rgba): Rgba {
  const light: Rgba = { r: 255, g: 255, b: 255, a: 255 };
  // The page's own colour rather than pure black, so a dark label on an amber
  // badge belongs to the theme instead of being a hole punched in it.
  const dark: Rgba = colorUtils.isDarkSurface(toHex(page))
    ? page
    : { r: 0, g: 0, b: 0, a: 255 };
  return ratio(light, fill) >= ratio(dark, fill) ? light : dark;
}

/**
 * The chrome palette for one resolved theme.
 *
 * `theme` is expected to have been through Shiki's `normalizeTheme` already —
 * which every loader in `@pierre/theming/themes` does — so `bg`, `fg` and
 * `type` are present. `normalizeThemeColors` then fills the workbench keys that
 * have mechanical fallbacks, which is where roughly half of the git-decoration
 * colours in the list come from.
 */
export function deriveChromeTheme(theme: ThemeLike): ChromeTheme {
  const normalized = normalizeThemeColors(theme);
  const colors: Colors = normalized.colors ?? {};

  const scheme: 'light' | 'dark' =
    normalized.type ??
    (colorUtils.isDarkSurface(normalized.bg, normalized.fg) ? 'dark' : 'light');
  const away = AWAY_FROM[scheme];
  const toward = AWAY_FROM[scheme === 'light' ? 'dark' : 'light'];
  /** Down into the page: a sunken surface, darker in both schemes. */
  const sunken = AWAY_FROM.light;

  // --------------------------------------------------------------- surfaces

  const canvas =
    parseHex(colors['editor.background']) ??
    parseHex(normalized.bg) ??
    (scheme === 'dark'
      ? { r: 13, g: 17, b: 23, a: 255 }
      : { r: 255, g: 255, b: 255, a: 255 });
  const page = flatten(canvas, scheme === 'dark' ? AWAY_FROM.light : AWAY_FROM.dark);
  const or = (value: Rgba | null, fallback: Rgba): Rgba => value ?? fallback;

  // The sidebar is the one second surface every theme actually has a colour
  // for, which is what "one step off the page" means. Themes that paint it the
  // same as the editor — Nord sets both to `#2e3440` — get the stepped value
  // instead: a subtle surface identical to the page is not a layer.
  //
  // `surfacesMatch` rather than a contrast threshold, and the difference
  // matters. Primer's own subtle is `#f6f8fa` on white, which measures 1.04:1;
  // any threshold loose enough to call that "not a layer" throws away the
  // correct answer on half the light themes. The question here is whether the
  // theme painted the same surface twice, not whether the step is a large one.
  const statedSubtle = chain(colors, page, ['sideBar.background']);
  const canvasSubtle =
    statedSubtle !== null && !colorUtils.surfacesMatch(toHex(statedSubtle), toHex(page))
      ? statedSubtle
      : mix(away, page, 0.05);

  // Sunken rather than raised, in both schemes: Primer's inset is darker than
  // the page whether the page is white or near-black. A theme already at black
  // has nowhere darker to go, so it rises instead.
  const canvasInset =
    (colorUtils.relativeLuminance(toHex(page)) ?? 1) < 0.02
      ? mix(AWAY_FROM.dark, page, 0.05)
      : mix(sunken, page, scheme === 'dark' ? 0.45 : 0.03);

  // Raised, always toward white — in dark mode a popover darker than the page
  // under it reads as a hole rather than as a thing above it, which
  // `ui/tokens.css` says at more length.
  const canvasOverlay = or(
    chain(colors, page, ['menu.background', 'editorWidget.background', 'dropdown.background']),
    scheme === 'dark' ? mix(AWAY_FROM.dark, page, 0.05) : page,
  );

  // `normalizeThemeColors` has already dropped a hover that equals the sidebar
  // or would erase the row text, so anything still here is usable.
  const neutralHover = or(
    chain(colors, canvasSubtle, ['list.hoverBackground']),
    mix(away, page, HOVER_STEP),
  );

  // ------------------------------------------------------------------- text

  const fgDefault =
    parseHex(
      colorUtils.pickReadableForeground(toHex(page), [
        colors['editor.foreground'],
        normalized.fg,
      ]),
    ) ?? or(chain(colors, page, ['editor.foreground']), toward);
  const fgMuted =
    parseHex(colorUtils.deriveMutedFg(toHex(fgDefault), toHex(page))) ??
    mix(page, fgDefault, 0.35);
  // Quieter still, and non-text only — the same rule `ui/tokens.css` states for
  // the default: icon strokes and disabled labels, never body copy.
  const fgSubtle = mix(page, fgMuted, 0.32);

  // ---------------------------------------------------------------- borders

  const statedBorder = chain(colors, page, [
    'panel.border',
    'editorGroup.border',
    'editorGroupHeader.tabsBorder',
  ]);
  // The one place a stated value is declined rather than taken. `isStructural`
  // carries the reasoning; in short, this token rules the whole page and a
  // theme's `panel.border` is sometimes a decoration rather than a rule.
  const borderDefault =
    statedBorder !== null && isStructural(statedBorder, page)
      ? statedBorder
      : mix(away, page, 0.2);
  const borderMuted = mix(borderDefault, page, 0.45);

  // ----------------------------------------------------------------- accent

  // `terminal.ansiBlue` second, ahead of the focus ring, and that order was
  // arrived at rather than assumed. A theme's focus ring is frequently a muted
  // neutral — Solarized Light's is `#b49471`, a tan — while its ansi blue is
  // the blue its author would name if asked. Taking the ring first gave
  // Solarized Light a brown for every link and the focus outline on a page
  // whose actual accent, `#268bd2`, was sitting one key away.
  //
  // `button.background` is not in this chain at all. In the GitHub themes it is
  // green, because VS Code's primary button is a confirm button; borrowing it
  // here would make "can I click this" and "this is the affirmative action" the
  // same colour, which The One Blue Rule in DESIGN.md exists to prevent.
  const accentFg = or(
    chain(colors, page, [
      'textLink.foreground',
      'terminal.ansiBlue',
      'list.focusOutline',
      'focusBorder',
    ]),
    parseHex(LAST_RESORT.accent) as Rgba,
  );
  // The fill and the text colour are the same hue by construction. Splitting
  // them would need a second stated blue, and no theme reliably has one.
  const accentEmphasis = accentFg;

  // ----------------------------------------------------------------- status

  const successFg = or(
    chain(colors, page, [
      'gitDecoration.addedResourceForeground',
      'terminal.ansiGreen',
      'editorGutter.addedBackground',
    ]),
    parseHex(LAST_RESORT.success) as Rgba,
  );
  const dangerFg = or(
    chain(colors, page, [
      'gitDecoration.deletedResourceForeground',
      'editorError.foreground',
      'terminal.ansiRed',
      'editorGutter.deletedBackground',
    ]),
    parseHex(LAST_RESORT.danger) as Rgba,
  );
  const attentionFg = or(
    chain(colors, page, [
      'editorWarning.foreground',
      'terminal.ansiYellow',
      'gitDecoration.modifiedResourceForeground',
    ]),
    parseHex(LAST_RESORT.attention) as Rgba,
  );
  const doneFg = or(
    chain(colors, page, [
      'terminal.ansiMagenta',
      'gitDecoration.untrackedResourceForeground',
      'editorInfo.foreground',
    ]),
    parseHex(LAST_RESORT.done) as Rgba,
  );

  // The draft badge's fill. Primer's own is within a shade of its muted text
  // colour, and every theme has that whether or not it has a neutral fill.
  const neutralEmphasis = fgMuted;

  const hex = (value: Rgba): string => toHex(value);
  const palette: Record<string, string> = {
    '--canvas-default': hex(page),
    '--canvas-subtle': hex(canvasSubtle),
    '--canvas-inset': hex(canvasInset),
    '--canvas-overlay': hex(canvasOverlay),
    '--neutral-hover': hex(neutralHover),

    '--fg-default': hex(fgDefault),
    '--fg-muted': hex(fgMuted),
    '--fg-subtle': hex(fgSubtle),
    '--on-accent': hex(labelFor(accentEmphasis, page)),
    '--on-success': hex(labelFor(successFg, page)),
    '--on-danger': hex(labelFor(dangerFg, page)),
    '--on-attention': hex(labelFor(attentionFg, page)),
    '--on-neutral': hex(labelFor(neutralEmphasis, page)),
    '--on-done': hex(labelFor(doneFg, page)),

    '--border-default': hex(borderDefault),
    '--border-muted': hex(borderMuted),

    '--neutral-emphasis': hex(neutralEmphasis),

    '--accent-fg': hex(accentFg),
    '--accent-fg-tinted': hex(mix(away, accentFg, ON_TINT_STEP)),
    '--accent-emphasis': hex(accentEmphasis),
    '--accent-emphasis-hover': hex(mix(away, accentEmphasis, FILL_HOVER_STEP)),
    '--accent-border': hex(mix(accentFg, page, TINT_BORDER)),
    '--accent-subtle-bg': hex(mix(accentFg, page, TINT)),
    '--accent-subtle-hover': hex(mix(accentFg, page, TINT_HOVER)),
    '--accent-muted-bg': hex(mix(accentFg, page, TINT_SELECTED)),

    '--success-fg': hex(successFg),
    '--success-emphasis': hex(successFg),
    '--success-emphasis-hover': hex(mix(away, successFg, FILL_HOVER_STEP)),
    '--success-border': hex(mix(away, successFg, 0.08)),
    '--success-subtle-bg': hex(mix(successFg, page, TINT)),

    '--danger-fg': hex(dangerFg),
    '--danger-fg-tinted': hex(mix(away, dangerFg, ON_TINT_STEP)),
    '--danger-emphasis': hex(dangerFg),
    '--danger-border': hex(mix(dangerFg, page, TINT_BORDER)),
    '--danger-subtle-bg': hex(mix(dangerFg, page, TINT)),
    '--danger-subtle-hover': hex(mix(dangerFg, page, TINT_HOVER)),

    '--attention-fg': hex(attentionFg),
    '--attention-fg-tinted': hex(mix(away, attentionFg, ON_TINT_STEP)),
    '--attention-border': hex(attentionFg),
    '--attention-border-muted': hex(mix(attentionFg, page, TINT_BORDER)),
    '--attention-subtle-bg': hex(mix(attentionFg, page, TINT)),
    '--attention-subtle-hover': hex(mix(attentionFg, page, TINT_HOVER)),

    '--done-fg': hex(doneFg),
    '--done-emphasis': hex(doneFg),
  };

  return { scheme, palette: palette as ChromePalette };
}

/** The palette packed the way `lib/theme/palettes.ts` stores it. */
export function packPalette(palette: ChromePalette): string {
  return CHROME_TOKENS.map((token) => palette[token]).join(',');
}
