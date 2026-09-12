/**
 * Which mode each remembered kind opens in, kept current while the page is open.
 *
 * Modelled on {@link useSettings} down to the ordering, because it has the same
 * two hazards: a second review tab can change the preference while this one is
 * reading, and a write landing between the listener going on and the opening
 * read resolving would otherwise be lost. Listener first, then read, and a flag
 * saying the read has been superseded.
 *
 * Returns the memory and the way to add to it, because the only caller does
 * both and a separate writer would be a second copy of the current value to
 * keep in step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComparisonKind } from '@/lib/compare/modes';
import { EMPTY_MODE_MEMORY, type ModeMemory } from '@/lib/settings';
import { onModeMemoryChanged, readModeMemory, writeModeMemory } from '@/lib/settings-store';

export type RememberMode = (kind: ComparisonKind, mode: string) => void;

export function useModeMemory(): [ModeMemory, RememberMode] {
  const [memory, setMemory] = useState<ModeMemory>(EMPTY_MODE_MEMORY);

  /**
   * The current value, for `remember` to build on.
   *
   * A ref rather than reading `memory` through the closure, so `remember` keeps
   * one identity for the life of the page — it is handed to every card, and a
   * callback that changed on each press would re-render the whole column.
   */
  const current = useRef<ModeMemory>(EMPTY_MODE_MEMORY);

  /**
   * Whether anything newer than the opening read has already decided.
   *
   * A ref rather than the flag inside the effect it started as, because
   * {@link remember} has to be able to set it and cannot reach in there. Left
   * effect-local, a press made while the first read is still in flight is
   * overwritten a tick later by a value that was already stale when it was
   * asked for — the reviewer presses Raw, the cards turn, and then they turn
   * back on their own.
   *
   * `live` stays inside the effect, because that one really is a fact about
   * this effect's lifetime rather than about the value.
   */
  const superseded = useRef(false);

  const apply = useCallback((next: ModeMemory) => {
    current.current = next;
    setMemory(next);
  }, []);

  useEffect(() => {
    let live = true;

    const stop = onModeMemoryChanged((next) => {
      if (!live) return;
      superseded.current = true;
      apply(next);
    });

    void readModeMemory()
      .then((stored) => {
        if (live && !superseded.current) apply(stored);
      })
      // Storage that cannot be read leaves every kind on its default, which is
      // what the page would draw anyway.
      .catch(() => {});

    return () => {
      live = false;
      stop();
    };
  }, [apply]);

  const remember = useCallback<RememberMode>(
    (kind, mode) => {
      const next = { ...current.current, [kind]: mode };
      // Before `apply`, so an opening read that resolves after this press finds
      // the flag already set. The reviewer's own action outranks a read that
      // was issued before they took it.
      superseded.current = true;
      apply(next);
      // Not awaited. The page has already moved; a storage write that fails
      // costs the preference at the next reload and nothing on screen now.
      void writeModeMemory(next).catch(() => {});
    },
    [apply],
  );

  return [memory, remember];
}
