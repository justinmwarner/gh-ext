/**
 * An absolute URL for one of this extension's own pages.
 *
 * Its own module for the same reason `ui/openOptions.ts` is: this is the third
 * place `ui/` touches an extension API, and a test that wants to replace it
 * should not have to replace the messaging transport as well.
 *
 * Needed because the two standalone pages are two documents. The dashboard
 * lives at `review.html#/prs`, so a bare `#/prs` written on the options page
 * sets the fragment of *options.html* and goes nowhere — a link that looks
 * right, does nothing, and gives no clue why.
 */

import { browser } from 'wxt/browser';

/** @param path Rooted at the extension, e.g. `/review.html#/prs`. */
export function extensionUrl(path: string): string {
  return browser.runtime.getURL(path as Parameters<typeof browser.runtime.getURL>[0]);
}
