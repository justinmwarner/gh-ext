/**
 * Where the reviewer is in the list of changed sections, published without
 * re-rendering the column.
 *
 * `DiffColumn` has always known this — `hunkCursor` is a ref beside `goToHunk`
 * — and has never been able to say it, because a ref is not something a
 * component can subscribe to. This is that ref, made subscribable, and it is
 * still not `useState` for the reason the ref exists: `handleScroll` fires at
 * frame rate, and hunk boundaries are crossed far more often than the file
 * boundaries the existing report already guards against. A cursor in React
 * state would re-render the column several times a second through a scroll, on
 * a page whose entire proposition is that it is faster than the one it
 * replaces.
 *
 * So: a ref with subscribers, read through `useSyncExternalStore`. Two
 * components subscribe — the counter on each card header and the pill at the
 * foot — and nothing else in the column moves when the cursor does. `ShortcutTargetsProvider` is the
 * existing instance of this pattern in this codebase, and it is here for the
 * same reason.
 *
 * The verb travels with the state in one context. A second provider for it
 * would mean `DiffColumn` nesting two and both consumers reaching for each, to
 * no end: they have the same owner and the same lifetime.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { HunkStop } from '@/lib/review/hunkNav';

export interface HunkCursorState {
  /** Every reachable section in the column, in reading order. */
  stops: readonly HunkStop[];
  /**
   * Global index of the section at the top of the viewport, or -1 when it is
   * not known — an unscrolled column, or a reading that found no row.
   */
  index: number;
  /** The file the reviewer is on. What the pill is about. */
  path: string | null;
  /** Sections of {@link path} still below the fold. What the pill counts. */
  below: number;
}

/**
 * The state of a column nobody has scrolled yet, and of no column at all.
 *
 * Shared and frozen: it is the snapshot every consumer outside a provider
 * reads, and `useSyncExternalStore` compares snapshots by identity — a fresh
 * object per call would be an infinite render loop rather than a default.
 */
const EMPTY: HunkCursorState = Object.freeze({
  stops: Object.freeze([]) as readonly HunkStop[],
  index: -1,
  path: null,
  below: 0,
});

export interface HunkCursorStore {
  subscribe(listener: () => void): () => void;
  get(): HunkCursorState;
  /** Merge a partial state. A no-op, silently, when nothing in it moved. */
  set(next: Partial<HunkCursorState>): void;
}

/**
 * Has anything actually changed?
 *
 * `stops` by identity rather than by contents, deliberately. It is memoized
 * upstream and rebuilt only when a file list or a fold really moved, so
 * identity *is* the question — and walking a thousand hunks element by element
 * on every scroll frame to learn that none of them moved is precisely the cost
 * this store exists to avoid.
 */
const same = (a: HunkCursorState, b: HunkCursorState): boolean =>
  a.stops === b.stops && a.index === b.index && a.path === b.path && a.below === b.below;

export function createHunkCursorStore(): HunkCursorStore {
  let state = EMPTY;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get() {
      return state;
    },
    set(next) {
      const merged = { ...state, ...next };
      if (same(state, merged)) return;
      state = merged;
      for (const listener of listeners) listener();
    },
  };
}

/** The column's navigation, as much of it as the two surfaces need. */
export interface HunkNav {
  store: HunkCursorStore;
  /** Step to the next section (`1`) or the previous one (`-1`). `goToHunk`. */
  step(direction: 1 | -1): void;
}

export const HunkNavContext = createContext<HunkNav | null>(null);

/**
 * A store that never changes, for a consumer mounted outside the provider.
 *
 * `useSyncExternalStore` must be called unconditionally, so "there is no
 * context" cannot be an early return — it has to be a store that answers.
 * This one holds the empty snapshot and drops every listener on the floor.
 *
 * Not hypothetical: the options page mounts a diff preview of its own, and
 * card headers reach the page through Pierre's slot machinery. Neither should
 * have to know this context exists in order not to crash.
 */
const INERT: HunkCursorStore = {
  subscribe: () => () => {},
  get: () => EMPTY,
  set: () => {},
};

/** Subscribes. Re-renders the caller only when the state really moved. */
export function useHunkCursor(): HunkCursorState {
  const nav = useContext(HunkNavContext);
  const store = nav?.store ?? INERT;
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Does not subscribe. The verb is stable for the column's lifetime. */
export function useHunkNav(): HunkNav | null {
  return useContext(HunkNavContext);
}
