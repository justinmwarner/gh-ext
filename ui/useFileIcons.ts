/**
 * The file tree's icons: which drawing each row gets, and where it lives.
 *
 * Two things have to be true before a row can draw one, and neither is true on
 * the first render.
 *
 * **The tables arrive late, on purpose.** `lib/icons/material.ts` is 268
 * kilobytes of mapping, and PRODUCT.md's third principle is that speed is the
 * budget every change spends from. So it is a dynamic import rather than a
 * static one: the rail paints with its names, its counts and its checkboxes,
 * and the icons land a frame or two later. That gap is invisible in practice —
 * the review page is waiting on GitHub for the diff anyway — and the row
 * reserves the icon's width from the start, so nothing reflows when they
 * arrive.
 *
 * **The scheme has to be resolved rather than assumed.** A couple of hundred
 * of these drawings are near-white and the theme ships a second version of each
 * for light backgrounds. Which one to use is not `prefers-color-scheme` alone:
 * `applyChromeTheme` pins `color-scheme` to a concrete `light` or `dark` when
 * the reviewer has chosen one of the seventy-five themes, and that choice beats
 * the operating system — deliberately, and `lib/theme/tokens.ts` says why. So
 * the computed value is read first and the media query is only the fallback for
 * the default's `light dark`.
 *
 * The drawings themselves are files under `public/file-icons`, fetched by
 * `<img>` when a row first needs one. `scripts/make-file-icons.mjs` sets out
 * why they are not in the module: a pull request touches a dozen kinds of file
 * and there are eleven hundred drawings, and a third of them carry `<defs>`
 * with ids that would collide the moment two copies shared a document.
 */

import { useEffect, useState } from 'react';
import type { ColourScheme, IconTables } from '@/lib/icons/lookup';
import { fileIcon, folderIcon } from '@/lib/icons/lookup';
import { extensionUrl } from './extensionUrl';

/** Where `make-file-icons.mjs` writes, and where WXT copies it to. */
const DRAWINGS = '/file-icons';

/**
 * Which way round the page is, as the page itself has resolved it.
 *
 * `light dark` — the default's value, meaning "follow the machine" — is the
 * only case the media query is asked about. Anything else is a theme the
 * reviewer picked, and a picked theme outranks the operating system.
 */
function resolveScheme(): ColourScheme {
  if (typeof document !== 'undefined') {
    const declared = getComputedStyle(document.documentElement).colorScheme.trim();
    if (declared === 'light' || declared === 'dark') return declared;
  }
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * One shared promise for the whole page.
 *
 * The tree mounts once, but the module lives longer than any one review: a
 * reviewer moving between pull requests must not re-import a quarter of a
 * megabyte each time. A rejected import is cached as `null` rather than
 * retried — the file is in the extension package or it is not, and a retry
 * loop against a missing chunk is just a slower way to draw no icons.
 */
let tables: Promise<IconTables | null> | null = null;

function loadTables(): Promise<IconTables | null> {
  tables ??= import('@/lib/icons/material')
    .then(({ MATERIAL_ICONS }) => MATERIAL_ICONS)
    .catch(() => null);
  return tables;
}

export interface FileIcons {
  /**
   * The drawing for one row, or `null` while the tables are still loading.
   *
   * Null rather than a placeholder URL: a row that drew a generic sheet of
   * paper and then swapped it for the real icon would flicker on every file in
   * the tree at once. The row reserves the space and fills it when it can.
   */
  urlFor(path: string, kind: 'file' | 'directory', expanded: boolean): string | null;
}

const NO_ICONS: FileIcons = { urlFor: () => null };

export function useFileIcons(): FileIcons {
  const [loaded, setLoaded] = useState<IconTables | null>(null);
  const [scheme, setScheme] = useState<ColourScheme>(resolveScheme);

  useEffect(() => {
    let live = true;
    void loadTables().then((found) => {
      if (live) setLoaded(found);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Follow the machine, and follow the reviewer changing their theme.
   *
   * The media query covers the first; the second arrives as an inline style on
   * `<html>`, which fires no event of its own, so the observer is what notices
   * it. Both are cheap and both are rare — this is one of the few things on the
   * page that can change without anything having rendered.
   */
  useEffect(() => {
    const settle = () => setScheme(resolveScheme());

    const query =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    query?.addEventListener('change', settle);

    const watcher =
      typeof MutationObserver === 'function' ? new MutationObserver(settle) : null;
    watcher?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });

    return () => {
      query?.removeEventListener('change', settle);
      watcher?.disconnect();
    };
  }, []);

  if (loaded === null) return NO_ICONS;

  return {
    urlFor: (path, kind, expanded) =>
      extensionUrl(
        `${DRAWINGS}/${
          kind === 'directory'
            ? folderIcon(path, expanded, loaded, scheme)
            : fileIcon(path, loaded, scheme)
        }.svg`,
      ),
  };
}
