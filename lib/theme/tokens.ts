/**
 * The names of every colour the chrome is drawn with, in one ordered list.
 *
 * This is the contract between three things that otherwise have no way to agree:
 * `ui/tokens.css`, which declares each of these as a Primer `light-dark()` pair
 * and is what a reviewer sees by default; `lib/theme/derive.ts`, which produces
 * one value for each from a chosen syntax theme; and `lib/theme/palettes.ts`,
 * which stores those values positionally and would otherwise be a table of
 * numbers nobody could check.
 *
 * **The order is load-bearing.** The generated table encodes a palette as a
 * comma-joined run of hex values in exactly this sequence, because seventy-five
 * copies of thirty-nine property names is the one part of this feature that
 * would actually be worth worrying about in a script injected into every
 * github.com page. Inserting a name in the middle silently reinterprets every
 * stored palette, so `npm run palettes` has to be re-run whenever this changes
 * and a test asserts the two have not drifted.
 *
 * Pure data. No DOM, no `chrome.*`, no network.
 */

/**
 * Every chrome token, grouped the way `ui/tokens.css` groups them.
 *
 * Read that file for what each one means and what it is not allowed to be used
 * for — the reasoning lives there, beside the default values, rather than being
 * split across two files that would then have to be kept in step.
 */
export const CHROME_TOKENS = [
  // surfaces
  '--canvas-default',
  '--canvas-subtle',
  '--canvas-inset',
  '--canvas-overlay',
  '--neutral-hover',
  // text
  '--fg-default',
  '--fg-muted',
  '--fg-subtle',
  // A label for each fill, rather than one white for all of them.
  //
  // Six tokens where two would nearly do, and the extra four are the whole
  // reason a badge stays readable without this system editing anybody's theme.
  // A fill and the text on it are one decision, and the answer differs per
  // fill: white reads on GitHub Light's red and is unreadable on its green,
  // which is 2.8:1. Repairing that by darkening the green would be this
  // system overruling a colour the theme's author chose; choosing black for
  // the label instead leaves the green exactly as written and still clears
  // 7.5:1. So the fills are taken verbatim and the labels do the adapting.
  '--on-accent',
  '--on-success',
  '--on-danger',
  '--on-attention',
  '--on-neutral',
  '--on-done',
  // borders
  '--border-default',
  '--border-muted',
  // neutral
  '--neutral-emphasis',
  // accent
  '--accent-fg',
  '--accent-fg-tinted',
  '--accent-emphasis',
  '--accent-emphasis-hover',
  '--accent-border',
  '--accent-subtle-bg',
  '--accent-subtle-hover',
  '--accent-muted-bg',
  // status: ok
  '--success-fg',
  '--success-emphasis',
  '--success-emphasis-hover',
  '--success-border',
  '--success-subtle-bg',
  // status: wrong
  '--danger-fg',
  '--danger-fg-tinted',
  '--danger-emphasis',
  '--danger-border',
  '--danger-subtle-bg',
  '--danger-subtle-hover',
  // status: waiting
  '--attention-fg',
  '--attention-fg-tinted',
  '--attention-border',
  '--attention-border-muted',
  '--attention-subtle-bg',
  '--attention-subtle-hover',
  // status: done
  '--done-fg',
  '--done-emphasis',
] as const;

export type ChromeToken = (typeof CHROME_TOKENS)[number];

/** One value per name in {@link CHROME_TOKENS}. Always opaque six-digit hex. */
export type ChromePalette = Readonly<Record<ChromeToken, string>>;

/**
 * The one extra thing a palette carries that is not a colour.
 *
 * `color-scheme` has to be pinned alongside the values, because pinning it is
 * what makes the reviewer's choice beat the operating system — and because
 * anything this feature has not reached yet is still written as `light-dark()`
 * and will at least resolve to the half the theme was built for.
 */
export interface ChromeTheme {
  readonly scheme: 'light' | 'dark';
  readonly palette: ChromePalette;
}

/**
 * Unpack the generated table's positional encoding.
 *
 * Exported rather than inlined into the generated file so that the encoding is
 * described once, next to the order it depends on, instead of in a file with a
 * "do not edit" banner on it.
 */
export function decodePalette(packed: string): ChromePalette {
  const values = packed.split(',');
  if (values.length !== CHROME_TOKENS.length) {
    throw new Error(
      `palette has ${values.length} values, expected ${CHROME_TOKENS.length}: run \`npm run palettes\``,
    );
  }
  const palette: Record<string, string> = {};
  CHROME_TOKENS.forEach((token, index) => {
    palette[token] = values[index] as string;
  });
  return palette as ChromePalette;
}
