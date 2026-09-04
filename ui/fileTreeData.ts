/**
 * How much conversation each file is carrying.
 *
 * The tree draws a mark for it and the Conversations view groups by it, and
 * both want the same answer, so it is worked out once here rather than twice
 * at the two call sites.
 */

import type { ReviewThread } from '@/lib/github/types';

/**
 * Two numbers rather than one, because a row draws a different mark for
 * "there is something outstanding here" than for "this was discussed and
 * settled", and the difference is the only thing that makes the mark worth
 * looking at twice.
 */
export interface FileComments {
  total: number;
  unresolved: number;
}

/**
 * Tally threads by the file they are on.
 *
 * A path with no threads is **absent** rather than zeroed. The tree reads the
 * absence directly, so a zero-filled map would put a mark on every row.
 *
 * Threads on files the diff column never received are counted too. They cost
 * nothing here, and a tree with no row for the path simply never asks.
 */
export function fileComments(
  threads: readonly ReviewThread[],
): Map<string, FileComments> {
  const byPath = new Map<string, FileComments>();

  for (const thread of threads) {
    const tally = byPath.get(thread.path) ?? { total: 0, unresolved: 0 };
    tally.total += 1;
    if (!thread.isResolved) tally.unresolved += 1;
    byPath.set(thread.path, tally);
  }

  return byPath;
}
