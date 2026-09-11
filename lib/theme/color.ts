/**
 * The colour arithmetic the chrome palette is derived with.
 *
 * `@pierre/theming/color` already ships the measuring half — luminance,
 * contrast, compositing, "is this surface dark" — and this file deliberately
 * does not duplicate any of it. What it adds is the *mixing* half, which that
 * package has no opinion about because its own consumers reach for CSS
 * `color-mix()` at render time.
 *
 * This palette cannot. It is baked into a table at build time so that the
 * content script on github.com pays nothing to read it, and a table holds
 * values rather than expressions. So the mixing happens here, once, in sRGB,
 * and what lands in the table is plain opaque hex.
 *
 * Pure, like everything under `lib/`: no DOM, no `chrome.*`, no network. It is
 * arithmetic on six-character strings.
 */

/** Red, green, blue and alpha, each 0–255. Alpha is 255 for an opaque colour. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, and nothing else.
 *
 * All four appear in the theme files this reads — `list.hoverBackground` is
 * very often eight digits, because a hover that tints rather than replaces is
 * the natural way to write one for an editor. Anything else (a named colour, a
 * `rgb()` call) returns null rather than guessing, and the caller falls through
 * to the next link in its chain. VS Code's own theme format is hex-only, so
 * this is a completeness check rather than a real branch.
 */
export function parseHex(value: string | undefined): Rgba | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim();
  if (hex.length === 0 || hex[0] !== '#') return null;
  const body = hex.slice(1);

  const short = body.length === 3 || body.length === 4;
  const long = body.length === 6 || body.length === 8;
  if (!short && !long) return null;
  if (!/^[0-9a-fA-F]+$/.test(body)) return null;

  const width = short ? 1 : 2;
  const at = (index: number): number => {
    const piece = body.slice(index * width, index * width + width);
    const full = short ? piece + piece : piece;
    return Number.parseInt(full, 16);
  };

  const hasAlpha = body.length === 4 || body.length === 8;
  return { r: at(0), g: at(1), b: at(2), a: hasAlpha ? at(3) : 255 };
}

/** Six digits, lower case, always opaque. Alpha is dropped, not encoded. */
export function toHex({ r, g, b }: Rgba): string {
  const pair = (value: number): string => clamp(value).toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/**
 * `amount` of `top` over `bottom`, ignoring both alphas.
 *
 * Linear in sRGB rather than in a perceptual space, and that is the right
 * choice here rather than a shortcut: every value this mixes came out of a
 * theme whose author picked their own surfaces by eye in sRGB, so a mix that
 * agrees with them looks like part of their theme. A perceptually-even blend
 * lands somewhere they never chose.
 */
export function mix(top: Rgba, bottom: Rgba, amount: number): Rgba {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: clamp(bottom.r + (top.r - bottom.r) * t),
    g: clamp(bottom.g + (top.g - bottom.g) * t),
    b: clamp(bottom.b + (top.b - bottom.b) * t),
    a: 255,
  };
}

/**
 * `over` composited onto `under` using `over`'s own alpha.
 *
 * The reason the table can be opaque hex at all. A theme's hover tint is
 * usually translucent, and a translucent value in the table would composite
 * against whatever happened to be behind it on the page rather than against
 * the surface it was designed for.
 */
export function flatten(over: Rgba, under: Rgba): Rgba {
  if (over.a >= 255) return { ...over, a: 255 };
  return mix(over, under, over.a / 255);
}

/**
 * The direction "away from the page" points in.
 *
 * On a light theme a raised surface is darker than the page; on a dark theme it
 * is lighter. Every step this file takes between surfaces is expressed as a mix
 * toward this rather than as "lighten" or "darken", which is what lets one
 * derivation serve both halves of the list.
 */
export const AWAY_FROM: Record<'light' | 'dark', Rgba> = {
  light: { r: 0, g: 0, b: 0, a: 255 },
  dark: { r: 255, g: 255, b: 255, a: 255 },
};
