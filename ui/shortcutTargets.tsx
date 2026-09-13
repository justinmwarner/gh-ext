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
 *
 * **A claim may name a file, and then only that file answers it.** `J`, `K` and
 * `c` are not like the two above: they belong to whichever card the reviewer is
 * on, and a review holds several rendered Markdown documents at once. Last one
 * mounted is the wrong answer there — it would hand the keyboard to whichever
 * card the column happened to virtualize in most recently, including while the
 * reviewer is reading a source file. So a scope is part of the key rather than
 * a tie-break on top of it: a scoped claim answers only a scoped ask for the
 * same path, an unscoped claim only an unscoped ask, and the shell asks with
 * the file it already knows the reviewer is on.
 */

import { type ReactNode, createContext, useContext, useEffect, useRef } from 'react';
import type { ShortcutAction } from '@/lib/keymap';

export type ShortcutHandler = () => void;

export interface ShortcutTargets {
  /** Take this action for as long as the caller is mounted. */
  claim(action: ShortcutAction, handler: ShortcutHandler, scope?: string): () => void;
  /** Run the innermost claim on this scope, and say whether there was one. */
  run(action: ShortcutAction, scope?: string): boolean;
}

/**
 * One registry key.
 *
 * A NUL between the two halves because a path may contain anything a file name
 * may contain, and an action must never be able to spell the start of one.
 */
const slot = (action: ShortcutAction, scope: string | undefined): string =>
  `${action}\u0000${scope ?? ''}`;

const ShortcutTargetsContext = createContext<ShortcutTargets | null>(null);

export function ShortcutTargetsProvider({ children }: { children: ReactNode }) {
  // A ref rather than state: registering must not re-render the page, and the
  // shell reads through this at keystroke time, never at render time.
  const claims = useRef(new Map<string, ShortcutHandler[]>());

  const value = useRef<ShortcutTargets>({
    claim(action, handler, scope) {
      const key = slot(action, scope);
      const stack = claims.current.get(key) ?? [];
      stack.push(handler);
      claims.current.set(key, stack);
      return () => {
        const current = claims.current.get(key);
        if (current === undefined) return;
        const at = current.lastIndexOf(handler);
        if (at !== -1) current.splice(at, 1);
      };
    },
    run(action, scope) {
      const stack = claims.current.get(slot(action, scope));
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
  scope?: string,
): void {
  const targets = useShortcutTargets();
  const latest = useRef(handler);
  latest.current = handler;

  const active = handler !== null;
  useEffect(() => {
    if (targets === null || !active) return;
    return targets.claim(
      action,
      () => {
        latest.current?.();
      },
      scope,
    );
  }, [targets, action, active, scope]);
}
