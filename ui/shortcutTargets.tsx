/**
 * Shortcuts whose target is a component, not the page.
 *
 * Two bindings act on something that may or may not be on screen: `Mod+Enter`
 * posts whatever comment is open, and `Shift+Mod+Enter` submits the review that
 * is pending. Neither the composer nor the footer can own a document listener
 * — there is one keymap and one listener, deliberately — and neither can be
 * driven from the shell, because the text being submitted lives inside them.
 *
 * So they register. The shell resolves the keystroke as it does every other
 * one, then asks here for the handler; when nothing is mounted to answer, the
 * key is left to the browser rather than swallowed.
 *
 * Last registration wins. That is not an arbitrary tie-break: a composer opens
 * *over* the page, and while it is open `Mod+Enter` means its comment.
 */

import { type ReactNode, createContext, useContext, useEffect, useRef } from 'react';
import type { ShortcutAction } from '@/lib/keymap';

export type ShortcutHandler = () => void;

export interface ShortcutTargets {
  /** Take this action for as long as the caller is mounted. */
  claim(action: ShortcutAction, handler: ShortcutHandler): () => void;
  /** Run the innermost claim, and say whether there was one. */
  run(action: ShortcutAction): boolean;
}

const ShortcutTargetsContext = createContext<ShortcutTargets | null>(null);

export function ShortcutTargetsProvider({ children }: { children: ReactNode }) {
  // A ref rather than state: registering must not re-render the page, and the
  // shell reads through this at keystroke time, never at render time.
  const claims = useRef(new Map<ShortcutAction, ShortcutHandler[]>());

  const value = useRef<ShortcutTargets>({
    claim(action, handler) {
      const stack = claims.current.get(action) ?? [];
      stack.push(handler);
      claims.current.set(action, stack);
      return () => {
        const current = claims.current.get(action);
        if (current === undefined) return;
        const at = current.lastIndexOf(handler);
        if (at !== -1) current.splice(at, 1);
      };
    },
    run(action) {
      const stack = claims.current.get(action);
      const handler = stack?.[stack.length - 1];
      if (handler === undefined) return false;
      handler();
      return true;
    },
  });

  return (
    <ShortcutTargetsContext.Provider value={value.current}>
      {children}
    </ShortcutTargetsContext.Provider>
  );
}

export function useShortcutTargets(): ShortcutTargets | null {
  return useContext(ShortcutTargetsContext);
}

/**
 * Answer for `action` while mounted, or pass — a null handler claims nothing.
 *
 * The handler is read through a ref, so a component may hand in a fresh closure
 * every render without re-registering. Only whether it exists is a dependency.
 */
export function useShortcutTarget(
  action: ShortcutAction,
  handler: ShortcutHandler | null,
): void {
  const targets = useShortcutTargets();
  const latest = useRef(handler);
  latest.current = handler;

  const active = handler !== null;
  useEffect(() => {
    if (targets === null || !active) return;
    return targets.claim(action, () => {
      latest.current?.();
    });
  }, [targets, action, active]);
}
