/**
 * Noticing that the pull request moved while it was being read.
 *
 * A review page is a photograph of one commit. Every line number under it —
 * the hunk headers, the thread anchors, and the `line`/`side` pair a queued
 * comment is addressed with — was counted in the patch that was loaded. When
 * someone pushes, that patch stops existing, and nothing on screen changes to
 * say so: the reviewer carries on writing comments against line numbers GitHub
 * will re-interpret or mark outdated the moment the review is submitted. So
 * this is a correctness problem rather than a freshness one, and the page has
 * to be able to find out.
 *
 * Three decisions, each of which is the reason this is not a poller:
 *
 * - **The trigger is free.** `focus` on the window, which fires when the
 *   reviewer comes back to the tab and when they come back to the browser from
 *   another application — the two moments a push is most likely to have
 *   happened, because they are the moments they were somewhere else. A timer
 *   would go on asking in a tab nobody is looking at, for an answer nobody is
 *   there to read. `visibilitychange` was the other candidate and is strictly
 *   worse: it does not fire when the browser regains focus with this tab
 *   already frontmost, which is exactly the alt-tab-back-from-a-terminal case.
 * - **There is a floor.** See {@link HEAD_CHECK_FLOOR_MS}. Focus is free to
 *   *observe* and not free to *act on*: a page left open all day is focused
 *   hundreds of times.
 * - **The answer is a fact, not an action.** This hook reports the commit and
 *   stops. Reloading would replace the file list under someone mid-comment,
 *   which is a worse outcome than the staleness it fixes; the reviewer decides,
 *   and `HeadMovedNotice` is where they are asked.
 *
 * The check is an ordinary `get-pr` with `refresh: true`, the same request the
 * review-presence lookups in `reviewSession.tsx` make. Its reply is thrown away
 * apart from the SHA, but not wasted: it re-reads under the new head and leaves
 * the worker's cache holding it, so the reload the reviewer may then ask for is
 * usually served from storage rather than from GitHub again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type PrRef, message } from '@/lib/messages';
import { request } from './background';

/**
 * The shortest interval between two head checks.
 *
 * Focus is a free signal and a very frequent one, so the bound has to come from
 * what a check costs rather than from how often one could be justified. On an
 * unmoved pull request a refresh is three GraphQL reads and no diff fetch — the
 * diff slot is keyed on the head SHA and never expires, so `loadDiff` answers
 * it from storage — which at two minutes is at most ninety requests an hour for
 * one open tab, comfortably inside an hourly quota of five thousand. It is also
 * the ceiling on how long a reviewer can be writing against a commit that has
 * been superseded, which is the thing actually being traded away here: halving
 * it doubles the cost to buy a minute, and the reviewer is told at the next
 * focus either way.
 *
 * Deliberately unrelated to `DEFAULT_TTL_MS`. That governs how long a cached
 * answer may be served; this check refuses the cache outright.
 */
export const HEAD_CHECK_FLOOR_MS = 120_000;

export interface HeadMoved {
  /**
   * The commit the pull request is on now, when that is not the one the page
   * is showing and the reviewer has not already waved it away. Null otherwise,
   * which is the ordinary case.
   */
  movedTo: string | null;
  /** Keep reading. The same commit will not be raised again. */
  dismiss: () => void;
}

export function useHeadMoved(pr: PrRef, loadedSha: string): HeadMoved {
  /** The head SHA the last completed check reported. */
  const [seen, setSeen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  /**
   * When a check last went out.
   *
   * Seeded at mount rather than at zero, because the payload on screen *is* a
   * check: it was read moments ago, and asking again on the first focus after
   * it would spend a request to be told what the page already knows.
   */
  const checkedAt = useRef(Date.now());

  // Read inside the listener, which is installed once and outlives the render
  // that created it.
  const latest = useRef(pr);
  latest.current = pr;

  useEffect(() => {
    let live = true;

    const check = (): void => {
      const now = Date.now();
      if (now - checkedAt.current < HEAD_CHECK_FLOOR_MS) return;
      // Written before the request goes out and not after it answers. A burst
      // of focus events, or a check still in flight when the next one arrives,
      // would otherwise all read the same stale timestamp and all pass. It is
      // also not rolled back on failure: a token GitHub has started refusing
      // must not turn every alt-tab into another request it will refuse.
      checkedAt.current = now;

      void request(message('get-pr', { pr: latest.current, refresh: true })).then(
        (response) => {
          // The reply outlived the page, or the route moved on to another pull
          // request while it was in flight.
          if (!live || !response.ok) return;
          setSeen(response.data.headSha);
        },
      );
    };

    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  const dismiss = useCallback(() => {
    setSeen((current) => {
      if (current !== null) setDismissed(current);
      return current;
    });
  }, []);

  /**
   * Derived rather than stored, so it un-says itself.
   *
   * Once the reviewer reloads, the payload arrives at the commit this hook was
   * complaining about and `loadedSha` catches up — and the comparison goes
   * quiet on its own, with no effect to reset it and no window in which the
   * notice outlives the thing it was about.
   */
  const movedTo = seen !== null && seen !== loadedSha && seen !== dismissed ? seen : null;

  return { movedTo, dismiss };
}
