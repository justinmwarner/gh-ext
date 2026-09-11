/**
 * Puts the reviewer's chosen theme on a surface, or takes it back off.
 *
 * The only part of this feature that touches the DOM. Everything upstream is
 * pure — `lib/theme/derive.ts` decides the colours and `lib/theme/palettes.ts`
 * holds them — so this file is two dozen `setProperty` calls and the reasoning
 * for where they go.
 *
 * ## Why inline properties rather than a stylesheet
 *
 * `ui/tokens.css` declares every token on `:root, :host`. An inline style on
 * the element that rule matches outranks it without `!important` and without a
 * second stylesheet to load, and — this is the part that decided it — the same
 * three lines work inside the card's shadow root, where a page stylesheet
 * cannot reach at all. One mechanism for all three surfaces.
 *
 * ## Why `color-scheme` travels with the values
 *
 * Two reasons, and the second is the one that is easy to miss. It is what makes
 * the reviewer's choice beat the operating system: choosing a dark theme has to
 * give a dark page on a machine set to light, the same way choosing a dark
 * theme in an editor does. And it is the safety net for anything this feature
 * has not reached — a `light-dark()` pair left in a stylesheet still resolves
 * to the half the chosen theme expects, so a straggler is merely off-palette
 * rather than a white panel in a black page.
 */

import { CHROME_TOKENS } from '@/lib/theme/tokens';
import { chromeTheme } from '@/lib/theme/palettes';

/**
 * Dress `element` in `themeId`, or strip it back to the defaults.
 *
 * `themeId` is a value straight out of settings, so the empty string — meaning
 * "match the page" — and an id this build does not recognise both land on the
 * same branch: remove everything and let `ui/tokens.css` speak. That is what
 * makes the default free of this code path rather than merely equivalent to it.
 *
 * `restScheme` is what `color-scheme` goes back to when no theme is set, and it
 * differs by surface. The two pages follow the operating system with
 * `light dark`; the card follows whatever GitHub's own `data-color-mode` says,
 * because a reviewer who has pinned GitHub to dark should not get a light card
 * sitting on it.
 */
export function applyChromeTheme(
  element: HTMLElement,
  themeId: string,
  restScheme = 'light dark',
): void {
  const chosen = chromeTheme(themeId);

  if (chosen === null) {
    for (const token of CHROME_TOKENS) element.style.removeProperty(token);
    element.style.colorScheme = restScheme;
    return;
  }

  for (const token of CHROME_TOKENS) {
    element.style.setProperty(token, chosen.palette[token]);
  }
  // After the values, not before. Both orders paint the same frame, but a
  // reader should see the scheme being pinned as the last word on the subject.
  element.style.colorScheme = chosen.scheme;
}
