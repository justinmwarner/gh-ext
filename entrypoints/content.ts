/**
 * The github.com pull request content script.
 *
 * It does four things and nothing else: read the pull request coordinates out
 * of the URL, ask the worker to start prefetching, put a button in the header,
 * and ask the worker to open the review page when that button is clicked.
 *
 * It performs no network calls and reads no token — both live in the background
 * worker, out of reach of anything running on github.com.
 *
 * Every entry point here is wrapped so a failure logs and stops. This script
 * runs inside someone else's page; a thrown error from a button we injected is
 * not an acceptable way to find out that GitHub changed a class name.
 */

import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { parsePrUrl } from '@/lib/github/pr-url';
import { type Message, type PrRef, isErr, message } from '@/lib/messages';

const BUTTON_ID = 'fast-review-open-button';

/**
 * Where the button goes, most specific first.
 *
 * These are GitHub's class names, which are not a public API and change without
 * notice. The list is a preference order, not a promise: if none of them match,
 * {@link warnMissingAnchor} fires and the script does nothing further.
 */
const ANCHOR_SELECTORS = [
  '.gh-header-actions',
  '[data-testid="pr-header-actions"]',
  '[data-testid="issue-header-actions"]',
  '.gh-header-meta',
] as const;

/** How long GitHub gets to render its header before we call the anchor missing. */
const ANCHOR_GRACE_MS = 3_000;

/** How long to let a burst of DOM mutations settle before re-checking. */
const RESYNC_DEBOUNCE_MS = 250;

const log = (...args: unknown[]) => console.warn('[fast-review]', ...args);

function guard(label: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    log(`${label} failed`, error);
  }
}

export default defineContentScript({
  matches: ['https://github.com/*/*/pull/*'],
  runAt: 'document_idle',

  main(ctx: ContentScriptContext) {
    /** The pull request we have already asked the worker to prefetch. */
    let prefetchedKey: string | null = null;
    let anchorWarned = false;
    let anchorWarningTimer: number | null = null;
    let resyncPending = false;

    function send(kind: string, msg: Message): void {
      try {
        void browser.runtime
          .sendMessage(msg)
          .then((response: unknown) => {
            // The worker answers failures rather than rejecting, so a rejected
            // request is invisible unless the reply is inspected.
            if (isErr(response)) log(`${kind} rejected:`, response.error.message);
          })
          .catch((error: unknown) => log(`${kind} failed`, error));
      } catch (error) {
        // sendMessage throws synchronously once the extension is reloaded and
        // this script is orphaned.
        log(`${kind} could not be sent`, error);
      }
    }

    function findAnchor(): Element | null {
      for (const selector of ANCHOR_SELECTORS) {
        const anchor = document.querySelector(selector);
        if (anchor) return anchor;
      }
      return null;
    }

    /**
     * Complain once, and only after GitHub has had time to render.
     *
     * At `document_idle` the header may still be on its way, and on a soft
     * navigation it is briefly gone, so warning on the first miss would cry
     * wolf on a page that ends up working.
     */
    function warnMissingAnchor(): void {
      if (anchorWarned || anchorWarningTimer !== null) return;

      anchorWarningTimer = ctx.setTimeout(() => {
        anchorWarningTimer = null;
        if (anchorWarned || document.getElementById(BUTTON_ID)) return;
        anchorWarned = true;
        log(
          'No pull request header found, so the Fast review button was not added. ' +
            'GitHub markup has probably changed. Tried:',
          ANCHOR_SELECTORS.join(', '),
        );
      }, ANCHOR_GRACE_MS);
    }

    function buildButton(): HTMLButtonElement {
      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      // GitHub's own button classes, so it looks native where they still
      // exist. An unstyled button is a fine fallback where they do not.
      button.className = 'btn btn-sm';
      button.textContent = 'Fast review';
      button.style.marginRight = '8px';

      button.addEventListener('click', (event) => {
        event.preventDefault();
        // Read the URL now rather than closing over the ref this button was
        // built for: GitHub soft-navigates between pull requests without
        // rebuilding the header, which would leave a stale ref captured here.
        guard('open-review', () => {
          const pr = parsePrUrl(window.location.href);
          if (!pr) return;
          send('open-review', message('open-review', { pr }));
        });
      });

      return button;
    }

    function prefetch(pr: PrRef): void {
      const key = `${pr.owner}/${pr.repo}/${pr.number}`;
      if (key === prefetchedKey) return;
      prefetchedKey = key;
      send('prefetch-pr', message('prefetch-pr', { pr }));
    }

    /** Bring the page in line with the current URL. Safe to call repeatedly. */
    function sync(): void {
      const pr = parsePrUrl(window.location.href);
      const existing = document.getElementById(BUTTON_ID);

      if (!pr) {
        // Soft-navigated off the pull request. Take the button with us rather
        // than leave one pointing at a page that is no longer here.
        existing?.remove();
        prefetchedKey = null;
        return;
      }

      prefetch(pr);

      if (existing) return;

      const anchor = findAnchor();
      if (!anchor) {
        warnMissingAnchor();
        return;
      }

      anchor.prepend(buildButton());
    }

    const resync = () => guard('sync', sync);

    resync();

    // GitHub is a single-page app: navigating between pull requests, or from
    // the conversation tab to the files tab, never reloads this script.
    ctx.addEventListener(window, 'wxt:locationchange', resync);

    // A URL change is not the only way the header goes away — GitHub also
    // re-renders it in place. Debounced, because this fires constantly.
    const observer = new MutationObserver(() => {
      if (resyncPending) return;
      resyncPending = true;
      ctx.setTimeout(() => {
        resyncPending = false;
        resync();
      }, RESYNC_DEBOUNCE_MS);
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      ctx.onInvalidated(() => observer.disconnect());
    }
  },
});
