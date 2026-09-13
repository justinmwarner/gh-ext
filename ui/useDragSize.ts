/**
 * One resizable region, on either axis.
 *
 * The size lives in React state rather than in a CSS variable poked at from an
 * event handler, so the region and the handle's `aria-valuenow` can never
 * disagree about how big it is.
 *
 * Two regions use this — the rail's width and the tab panel's height — and the
 * only thing that differs between them is which pointer coordinate is read and
 * which pair of arrow keys steps. Everything that is easy to get wrong is
 * shared: clamping, the listeners on `window`, and tearing a drag down.
 *
 * A region can also be remembered, through the optional {@link DragMemory}. The
 * hook owns *when* — at the end of a gesture, never during one — and the caller
 * owns where, because only one of the two regions is worth keeping and this
 * module has no opinion about which.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

export type DragAxis = 'x' | 'y';

export interface DragBounds {
  axis: DragAxis;
  min: number;
  max: number;
  initial: number;
}

export interface DragSize {
  size: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Somewhere to keep a size between sessions, for the regions that want one.
 *
 * Injected rather than imported, and that is what keeps this hook honest about
 * two things at once. Only one of its two callers persists anything — a rail
 * width is an answer to a monitor, a tab panel's height is an answer to what is
 * in it — and the hook has no business deciding which. It also means the
 * storage round trip is a pair of functions a test can hand in, so none of the
 * timing below needs an extension to exercise.
 */
export interface DragMemory {
  /** The stored size, or `null` for "no answer yet, keep the default". */
  read: () => Promise<number | null>;
  /**
   * Called once when a gesture ends, never while one is running.
   *
   * The distinction is the whole point of it: a pointer drag is a few hundred
   * `pointermove` events, and a storage write on each of them is a write queue
   * the length of the drag.
   */
  write: (size: number) => void;
}

/** One arrow key press. Coarse enough to be useful, fine enough to aim. */
const STEP_PX = 16;

/**
 * How long a keyboard adjustment waits before it is stored.
 *
 * A held arrow key repeats around thirty times a second, and each repeat is a
 * finished keystroke rather than a gesture with an end to hook — so the end has
 * to be inferred from the reviewer stopping. A pointer drag needs none of this:
 * `pointerup` says exactly when it is over.
 */
const KEY_SETTLE_MS = 400;

/**
 * Which arrows this axis answers, and which way each one goes.
 *
 * Only its own two. A vertical separator that also swallowed ArrowUp would
 * take page scrolling with it for as long as it held focus.
 */
const ARROWS: Record<DragAxis, Record<string, -1 | 1 | undefined>> = {
  x: { ArrowLeft: -1, ArrowRight: 1 },
  y: { ArrowUp: -1, ArrowDown: 1 },
};

export function useDragSize(
  { axis, min, max, initial }: DragBounds,
  remember?: DragMemory,
): DragSize {
  const clamp = (px: number): number => Math.min(max, Math.max(min, Math.round(px)));
  const [size, setSize] = useState(() => clamp(initial));

  /**
   * The current size, readable outside a render.
   *
   * The keyboard handler needs the number it is about to produce — to render
   * *and* to hand to {@link DragMemory.write} — and a functional `setSize`
   * would only give it to React.
   */
  const latest = useRef(size);
  latest.current = size;

  /** Held so the restore below can be skipped, and so the listener can read it. */
  const store = useRef(remember);
  store.current = remember;

  /** Tears down an in-progress drag. Held so unmount can end one. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  /**
   * Whether the reviewer has moved the handle in this session.
   *
   * Guards the restore below against landing late. Storage is asynchronous, so
   * a reviewer who grabs the rail in the first moments of a page can finish a
   * drag before the stored width arrives — and a restore that then overwrote it
   * would undo a deliberate act to reinstate a stale one.
   */
  const touched = useRef(false);

  /** Coalesces a burst of arrow presses into one write. */
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Store a size, once the gesture that produced it is over.
   *
   * The delay is for the keyboard; a pointer drag calls this from `pointerup`,
   * by which point there is nothing left to coalesce and the wait is invisible.
   */
  const commit = (next: number): void => {
    if (store.current === undefined) return;
    if (settle.current !== null) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      settle.current = null;
      store.current?.write(next);
    }, KEY_SETTLE_MS);
  };

  // The stored size, if there is one and the reviewer has not already spoken.
  // Run once: this is where the region *starts*, not a value it tracks.
  useEffect(() => {
    const memory = store.current;
    if (memory === undefined) return;

    let live = true;
    void memory
      .read()
      .then((stored) => {
        if (live && !touched.current && stored !== null) setSize(clamp(stored));
      })
      // A width that cannot be read is not a reason to render nothing. The
      // default is already on screen and is the honest fallback — the same
      // answer `useSettings` gives to the same failure.
      .catch(() => {});

    return () => {
      live = false;
      if (settle.current !== null) clearTimeout(settle.current);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // Text selection across the whole page is the default outcome of dragging,
    // and it makes the resize look broken.
    event.preventDefault();

    const along = (from: { clientX: number; clientY: number }): number =>
      axis === 'x' ? from.clientX : from.clientY;
    const start = along(event);
    const startSize = size;
    touched.current = true;

    /**
     * Where the drag has got to, carried in the closure rather than read back
     * out of state. `stop` runs in its own task, and this is the size it has to
     * store without depending on React having re-rendered first.
     */
    let moved = startSize;

    const onMove = (moveEvent: PointerEvent): void => {
      moved = clamp(startSize + along(moveEvent) - start);
      setSize(moved);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      endDrag.current = null;
      // Here, and not in `onMove`. Once per drag rather than once per pointer
      // event — and only when the drag actually moved something, so a click on
      // the handle writes nothing.
      if (moved !== startSize) commit(moved);
    };

    // Listeners on the window, not on the handle: a handle a few pixels wide
    // loses the pointer constantly, and `setPointerCapture` is not available
    // everywhere this component is rendered.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    endDrag.current = stop;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    /** Render it and remember it, which have to be the same number. */
    const goTo = (next: number): void => {
      touched.current = true;
      setSize(next);
      commit(next);
    };

    const direction = ARROWS[axis][event.key];
    if (direction !== undefined) goTo(clamp(latest.current + direction * STEP_PX));
    else if (event.key === 'Home') goTo(min);
    else if (event.key === 'End') goTo(max);
    else return;

    event.preventDefault();
  };

  return { size, onPointerDown, onKeyDown };
}
