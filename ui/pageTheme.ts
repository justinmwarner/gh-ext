/**
 * The chosen theme, on one of the two extension pages, from the first frame.
 *
 * `ui/chromeTheme.ts` knows how to dress an element. This knows *which*
 * element, *when*, and what to do about the fact that the answer arrives too
 * late. The two are split because the card shares the first and none of the
 * second: it is handed a theme id at mount, lives in a shadow root, and has no
 * `<html>` to own.
 *
 * ## The two faults this exists to fix
 *
 * **Nobody owned the document.** `applyChromeTheme` used to be called from
 * `Shell`, which mounts only on the `ready` branch of a pull request route. So
 * the dashboard at `#/prs`, the loading state, and the error, setup, locked and
 * no-route states all drew themselves in Primer's defaults with
 * `color-scheme: light dark` — which is to say they followed the operating
 * system rather than the reviewer. Leaving a themed options page for the pull
 * request list turned the window back to light. It is owned here now, and
 * `App` calls it once for every route there is.
 *
 * **The answer arrives after the paint.** `storage.local` is asynchronous and
 * there is no synchronous way to read it, so the first frame of every load was
 * the default palette and the theme landed on the second. That is the flicker.
 * The fix is a mirror: the chosen theme id is a short string, both extension
 * pages are one origin, and `localStorage` on that origin *is* readable
 * synchronously. {@link bootPageTheme} reads it before React renders;
 * everything below keeps it honest.
 *
 * The mirror is a cache and never a source. Settings still live in
 * `storage.local`; this holds a copy of one field, rewritten every time the
 * real value is seen. An empty or cleared mirror — a fresh install, or a
 * reviewer who wiped site data — costs exactly the frame it used to cost
 * always.
 */

import { useEffect } from 'react';
import { THEME_FOLLOWS_PAGE, isDiffTheme } from '@/lib/compare/themes';
import { onSettingsChanged, readSettings } from '@/lib/settings-store';
import { applyChromeTheme } from './chromeTheme';

/**
 * Namespaced, because this is the extension's own origin but not its own key
 * space — `localStorage` here is shared by every page this extension serves.
 */
const MIRROR_KEY = 'abr:chrome-theme';

/**
 * Put `themeId` on `<html>`, and remember it for the next load.
 *
 * Two things rather than one, and they go together because they are the same
 * decision seen from either side of the diff's edge. The attribute tells the
 * stylesheet to stop overriding Pierre's addition and deletion colours, since
 * the reviewer has chosen a theme and those are its job now — the themes most
 * worth choosing are the ones built for colour vision deficiency, and keeping
 * a Primer red and green on the changed lines would undo the thing they were
 * chosen to do. `applyChromeTheme` extends that concession to everything
 * outside the diff, because recolouring the code and leaving the page around
 * it in GitHub's white is a seam down the middle of one screen.
 *
 * Both land on `<html>`: the attribute because the rule it gates sits on
 * `:root` with the rest of the Pierre slots, and the palette because `:root`
 * is where `ui/tokens.css` declares the tokens and therefore the only element
 * an inline property can outrank them on.
 */
export function wearPageTheme(themeId: string): void {
  const root = document.documentElement;
  if (themeId === THEME_FOLLOWS_PAGE) root.removeAttribute('data-syntax-theme');
  else root.setAttribute('data-syntax-theme', themeId);
  applyChromeTheme(root, themeId);
  remember(themeId);
}

/**
 * Wear whatever the last load wore, synchronously, before anything is drawn.
 *
 * Called as the first import of each page's entry module rather than from a
 * component: by the time React has a root to render into, the frame this is
 * trying to get in front of has already gone.
 *
 * Does nothing at all when the mirror is empty or unreadable. That is not a
 * failure to handle — the page's own stylesheet is the default, and a `catch`
 * here is for a browser refusing `localStorage` rather than for a value we are
 * missing.
 *
 * The value is validated rather than trusted, which a value out of
 * `storage.local` does not need to be: `parseSettings` has already been over
 * that one. This mirror can outlive the build that wrote it — a reviewer on a
 * newer version who rolls back has a theme id here that this build has never
 * heard of — and setting `data-syntax-theme` to it would turn off the
 * stylesheet's Primer fallback in favour of a theme that does not exist.
 */
export function bootPageTheme(): void {
  const themeId = read();
  // Not `wearPageTheme('')`. An absent mirror should leave `<html>` exactly as
  // the markup left it, so the default really is the absence of this code path
  // rather than something equivalent to it.
  if (themeId === null || themeId === THEME_FOLLOWS_PAGE) return;
  if (!isDiffTheme(themeId)) return;
  wearPageTheme(themeId);
}

/**
 * Keep the page wearing whatever the reviewer has chosen, for as long as it is
 * open.
 *
 * Reads storage itself rather than taking `useSettings`, and the reason is the
 * flicker this file exists to remove. `useSettings` starts on
 * `DEFAULT_SETTINGS` — a perfectly good answer for every other caller, and the
 * wrong one here, because "no theme yet" and "the reviewer chose no theme" are
 * the same value and acting on the first would strip what {@link bootPageTheme}
 * has already put on. So nothing is worn until a real value arrives.
 *
 * The listener goes on before the read, so a write landing between the two is
 * not lost — the same ordering `followLoggingSetting` uses.
 */
export function usePageTheme(): void {
  useEffect(() => {
    let live = true;
    // A change already applied outranks the opening read, which was issued
    // before it and may still be in flight holding the superseded value.
    let changed = false;

    const stop = onSettingsChanged((settings) => {
      if (!live) return;
      changed = true;
      wearPageTheme(settings.diffTheme);
    });

    void readSettings()
      .then((settings) => {
        if (live && !changed) wearPageTheme(settings.diffTheme);
      })
      // Storage that cannot be read is not a reason to undress the page. What
      // the mirror supplied is the best answer available and it is already on.
      .catch(() => {});

    return () => {
      live = false;
      stop();
    };
  }, []);
}

/** `null` when there is no mirror, or no `localStorage` to hold one. */
function read(): string | null {
  try {
    return window.localStorage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
}

function remember(themeId: string): void {
  try {
    window.localStorage.setItem(MIRROR_KEY, themeId);
  } catch {
    // A browser that refuses storage gets today's behaviour, which is a frame
    // of the default palette. Nothing else here depends on the write.
  }
}
