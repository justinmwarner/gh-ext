/**
 * The github.com content script.
 *
 * It does four things and nothing else: read the pull request coordinates out
 * of the URL, ask the worker to start prefetching, put the card on the page,
 * and ask the worker to open a review — either because the reviewer pressed the
 * button, or because they asked for it to happen by itself.
 *
 * It performs no network calls and reads no token — both live in the background
 * worker, out of reach of anything running on github.com.
 *
 * ## Why this matches all of github.com
 *
 * It used to match `https://github.com/*&#47;*&#47;pull/*`, which looks tighter and was
 * the single largest bug in this extension. Chrome decides whether to inject a
 * content script from the URL the **document was loaded at**. GitHub is a
 * single-page app, so arriving at a pull request from the pull request list, the
 * repository home, a notification or a search result is a `pushState`
 * navigation: the document was loaded at a non-matching URL and this script was
 * never injected at all. Reloading injected it, which is why reloading appeared
 * to fix it.
 *
 * `wxt:locationchange` cannot rescue that — it is not running, because nothing
 * loaded it. So the script loads on every github.com page and {@link sync}
 * decides whether there is anything to do. On a page that is not a pull request
 * that decision is one regex against `location.href`, and no permission
 * changes: `host_permissions` already covers github.com.
 *
 * Every entry point here is wrapped so a failure logs and stops. This script
 * runs inside someone else's page, and a thrown error from something we
 * injected is not an acceptable way to find out that an assumption broke.
 */

import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { parsePrUrl } from '@/lib/github/pr-url';
import { logWarn } from '@/lib/log';
import { type Message, type PrRef, type Response, isErr, message } from '@/lib/messages';
import { CARD_COLLAPSED_KEY, autoOpenAvailable } from '@/lib/settings';
import {
  followLoggingSetting,
  readCardCollapsed,
  readSettings,
  writeCardCollapsed,
} from '@/lib/settings-store';
import { type CardHandle, CARD_HOST_ID, githubColorScheme, mountCard } from './card';

const log = logWarn;

/** Shown on the card itself, so a click that did nothing is never silent. */
const OPEN_FAILED = 'Could not open the review. See the extension console.';

const key = (pr: PrRef) => `${pr.owner}/${pr.repo}/${pr.number}`;

function guard(label: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    log(`${label} failed`, error);
  }
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',

  async main(ctx: ContentScriptContext) {
    // First, so nothing below can warn before the reviewer's preference is
    // known. This script runs on every github.com page, which is exactly why
    // it must not write to the console uninvited.
    await followLoggingSetting();

    /** The pull request we have already asked the worker to prefetch. */
    let prefetchedKey: string | null = null;
    /**
     * The pull request auto-open has already been decided for.
     *
     * "Considered", not "opened": it is set before the settings are read, so a
     * second `sync` cannot race the first through the same decision. Moving
     * between the Conversation and Files tabs of one pull request is a
     * navigation, and must not open a second review.
     */
    let autoOpenConsidered: string | null = null;
    /** Waiting for this tab to be looked at. See {@link maybeAutoOpen}. */
    let pendingAutoOpen: PrRef | null = null;
    let card: CardHandle | null = null;

    /**
     * Read once before the first mount, so the card does not appear expanded
     * and then visibly collapse a frame later.
     */
    let collapsed = await readCardCollapsed().catch((error: unknown) => {
      log('could not read the collapsed state', error);
      return false;
    });

    /**
     * Send a request and get the reply, or null if it could not be sent.
     *
     * The worker answers failures rather than rejecting, so a reply has to be
     * inspected; and `sendMessage` throws synchronously once the extension is
     * reloaded and this script is orphaned, which is neither a rejection nor a
     * reply.
     */
    async function request(msg: Message): Promise<Response | undefined | null> {
      try {
        return (await browser.runtime.sendMessage(msg)) as Response | undefined;
      } catch (error) {
        log('could not reach the extension', error);
        return null;
      }
    }

    function prefetch(pr: PrRef): void {
      const prKey = key(pr);
      if (prKey === prefetchedKey) return;
      prefetchedKey = prKey;

      void request(message('prefetch-pr', { pr })).then((response) => {
        if (response && isErr(response)) {
          log('prefetch rejected:', response.error.message);
        }
      });
    }

    /**
     * Ask the worker to show this pull request.
     *
     * The worker chooses the destination, because that is a stored preference
     * and this script has no business resolving it — and because a page on
     * github.com cannot navigate to an extension resource without
     * `review.html` being web-accessible, which would let github.com probe for
     * the extension.
     */
    function openReview(pr: PrRef, reason: 'click' | 'auto'): void {
      void request(message('open-review', { pr, reason })).then((response) => {
        const failed = response === null || response === undefined || isErr(response);
        if (!failed) return;

        if (response && isErr(response)) log('open-review rejected:', response.error.message);

        // Only for a click. An action the reviewer did not request must not put
        // an error on github.com; the console is the right place for it.
        if (reason === 'click') card?.setStatus(OPEN_FAILED);
      });
    }

    /**
     * Open a review by itself, if that is what the reviewer asked for.
     *
     * Three guards, and the second is the one that matters most: middle-clicking
     * eight pull requests out of the list would otherwise spawn eight review
     * tabs nobody looked at. So a hidden tab defers until it is actually looked
     * at, and re-checks the URL when it gets there.
     */
    async function maybeAutoOpen(pr: PrRef): Promise<void> {
      const prKey = key(pr);
      if (prKey === autoOpenConsidered) return;
      autoOpenConsidered = prKey;

      const settings = await readSettings();
      if (!settings.autoOpen) return;
      // The worker refuses this pairing too. Checked here as well so a tab that
      // cannot be configured into the trap is never even asked to enter it.
      if (!autoOpenAvailable(settings.openIn)) return;

      if (document.visibilityState === 'hidden') {
        pendingAutoOpen = pr;
        return;
      }

      openReview(pr, 'auto');
    }

    /**
     * Bring the page in line with a URL. Safe to call repeatedly.
     *
     * Takes the URL rather than reading `location` because of when it is
     * called. `wxt:locationchange` is dispatched from the Navigation API's
     * `navigate` event, which fires *before* the navigation commits — so
     * `location.href` inside that handler is still the page being left. Reading
     * it there meant leaving a pull request kept the card and arriving at one
     * never mounted it, which is precisely the bug this file exists to fix.
     */
    function sync(href: string): void {
      const pr = parsePrUrl(href);

      if (!pr) {
        // Soft-navigated off the pull request. Take the card with us rather
        // than leave one offering a review of a page that is no longer here.
        card?.destroy();
        card = null;
        prefetchedKey = null;
        autoOpenConsidered = null;
        pendingAutoOpen = null;
        return;
      }

      prefetch(pr);

      // `isConnected`, not just `card !== null`. The handle is a closure
      // variable and stays truthy after its host leaves the document — which
      // github.com does routinely, because Turbo replaces <body> on a page
      // render, and which any other extension or userscript can do at any time.
      // Testing the variable alone means one such navigation removes the
      // extension's only entry point for the life of the tab: every later pull
      // request reached by soft navigation gets no card, with no error to say
      // why. Re-mounting is cheap; being silently absent is not.
      if (!card || !card.host.isConnected) {
        card?.destroy();
        card = mountCard(document, {
          collapsed,
          onOpen: () => {
            // Read the URL now rather than closing over the ref this card was
            // built for: GitHub soft-navigates between pull requests, and the
            // card outlives any single one of them.
            guard('open-review', () => {
              const current = parsePrUrl(window.location.href);
              if (current) openReview(current, 'click');
            });
          },
          onCollapsedChange: (next) => {
            collapsed = next;
            void writeCardCollapsed(next).catch((error: unknown) => {
              log('could not save the collapsed state', error);
            });
          },
        });
      }

      void maybeAutoOpen(pr).catch((error: unknown) => {
        log('auto-open failed', error);
      });
    }

    const resync = (href: string) => guard('sync', () => sync(href));

    resync(window.location.href);

    // GitHub is a single-page app: navigating between pull requests, or from
    // the conversation tab to the files tab, never reloads this script.
    ctx.addEventListener(window, 'wxt:locationchange', (event) => {
      resync(event.newUrl.href);
    });

    // The deferred half of the visibility guard in `maybeAutoOpen`.
    ctx.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const pr = pendingAutoOpen;
      pendingAutoOpen = null;
      if (!pr) return;

      guard('auto-open', () => {
        // The tab may have moved on while it sat in the background.
        const current = parsePrUrl(window.location.href);
        if (current && key(current) === key(pr)) openReview(pr, 'auto');
      });
    });

    // Collapse is one choice about one extension, not a per-tab one. Without
    // this, collapsing on one pull request leaves every other open tab showing
    // an expanded card until it is reloaded.
    const onCollapsedChanged = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ): void => {
      if (areaName !== 'local') return;
      const change = changes[CARD_COLLAPSED_KEY];
      if (change === undefined) return;
      collapsed = change.newValue === true;
      card?.setCollapsed(collapsed);
    };
    browser.storage.onChanged.addListener(onCollapsedChanged);

    // Narrow on purpose: one attribute on one element. Its predecessor watched
    // every mutation under `<body>` to keep a button wedged in GitHub's header,
    // which the card no longer needs.
    const theme = new MutationObserver(() => {
      guard('theme', () => card?.setColorScheme(githubColorScheme(document)));
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode'],
    });

    ctx.onInvalidated(() => {
      theme.disconnect();
      // WXT's context cleans up addEventListener, the timers and the animation
      // frame callbacks, but it does not know about browser.storage — this is
      // the one listener that would otherwise outlive the teardown the rest of
      // this file keeps carefully.
      browser.storage.onChanged.removeListener(onCollapsedChanged);
      card?.destroy();
      card = null;
    });
  },
});

export { CARD_HOST_ID };
