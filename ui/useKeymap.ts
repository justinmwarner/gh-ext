/**
 * The one keyboard listener on the review page.
 *
 * All it does is carry state across keystrokes and turn `resolveShortcut`'s
 * answer into a call. The map, the platform rule, the typing rule and the
 * sequence timeout all live in `lib/keymap.ts`, where they are pure and tested
 * without a DOM; this is the wire.
 *
 * One listener, on `document`, because these shortcuts are global: the reviewer
 * is reading the diff column, and requiring them to focus something first would
 * defeat the point. The tree deliberately runs with `search: false` so that
 * single letters reach here at all.
 *
 * A keystroke is prevented only when a handler actually ran. An action nobody
 * is listening for — submitting a review when none is pending — leaves the key
 * to the browser rather than eating it.
 */

import { useEffect, useRef } from 'react';
import {
  type PendingSequence,
  type ShortcutAction,
  resolveShortcut,
} from '@/lib/keymap';
import { platformString } from './platform';

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

export function useKeymap(handlers: ShortcutHandlers): void {
  // Read inside the listener, which is installed once and outlives every
  // render that produced a handler.
  const latest = useRef(handlers);
  latest.current = handlers;

  const pending = useRef<PendingSequence | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const resolution = resolveShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          target: event.target,
        },
        {
          platform: platformString(),
          now: Date.now(),
          pending: pending.current,
        },
      );

      pending.current = resolution.pending;
      if (resolution.action === null) return;

      const handler = latest.current[resolution.action];
      if (handler === undefined) return;

      // Only now. `Mod+F` has to beat the browser's find bar, and `/` has to
      // beat Firefox's quick find — but only when there is something to run.
      if (resolution.handled) event.preventDefault();
      handler();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
