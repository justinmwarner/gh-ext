/**
 * The order reviews open in, read before one is drawn and kept current.
 *
 * Modelled on {@link useModeMemory}, down to the ordering: listener first, then
 * the read, and a flag saying the read has been overtaken. One difference is
 * why this is a hook of its own. Until storage has answered it says so, with
 * `null`, rather than answering folder order, and `App` waits on it before it
 * draws the review. A review drawn before the answer is drawn twice: in folder
 * order, and then, when storage answers, in the reviewer's, with the whole
 * column and tree rearranging under someone who may already have started
 * reading. The read goes out alongside the request for the pull request, and
 * storage answers well before the pull request does, so the wait costs nothing
 * that can be seen.
 *
 * Returns the order and the way to change it, which writes it through for
 * every review after this one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AS_IS, type Arrangement, sameArrangement } from '@/lib/review/readingOrder';
import { onArrangementChanged, readArrangement, writeArrangement } from '@/lib/settings-store';

export type SetArrangement = (next: Arrangement) => void;

export function useStoredArrangement(): [Arrangement | null, SetArrangement] {
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);

  /** Whether anything newer than the opening read has decided. As in `useModeMemory`. */
  const superseded = useRef(false);

  /**
   * Take `next`, unless it says what is already held.
   *
   * Every surface lays the review out again when the order's identity changes,
   * and every write comes back through `onChanged` as a new object, this
   * page's own included.
   */
  const apply = useCallback((next: Arrangement) => {
    setArrangement((held) => (held !== null && sameArrangement(held, next) ? held : next));
  }, []);

  useEffect(() => {
    let live = true;

    const stop = onArrangementChanged((next) => {
      if (!live) return;
      superseded.current = true;
      apply(next);
    });

    void readArrangement()
      .then((stored) => {
        if (live && !superseded.current) apply(stored);
      })
      // Folder order rather than nothing. The page is waiting on this, and a
      // read that failed would otherwise keep it waiting for good.
      .catch(() => {
        if (live && !superseded.current) apply(AS_IS);
      });

    return () => {
      live = false;
      stop();
    };
  }, [apply]);

  const change = useCallback<SetArrangement>(
    (next) => {
      superseded.current = true;
      apply(next);
      // Not awaited. The review has already moved; a write that fails costs
      // the order at the next review and nothing on screen now.
      void writeArrangement(next).catch(() => {});
    },
    [apply],
  );

  return [arrangement, change];
}
