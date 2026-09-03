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

/** One arrow key press. Coarse enough to be useful, fine enough to aim. */
const STEP_PX = 16;

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

export function useDragSize({ axis, min, max, initial }: DragBounds): DragSize {
  const clamp = (px: number): number => Math.min(max, Math.max(min, Math.round(px)));
  const [size, setSize] = useState(() => clamp(initial));

  /** Tears down an in-progress drag. Held so unmount can end one. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // Text selection across the whole page is the default outcome of dragging,
    // and it makes the resize look broken.
    event.preventDefault();

    const along = (from: { clientX: number; clientY: number }): number =>
      axis === 'x' ? from.clientX : from.clientY;
    const start = along(event);
    const startSize = size;

    const onMove = (moveEvent: PointerEvent): void => {
      setSize(clamp(startSize + along(moveEvent) - start));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      endDrag.current = null;
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
    const direction = ARROWS[axis][event.key];
    if (direction !== undefined) {
      setSize((current) => clamp(current + direction * STEP_PX));
    } else if (event.key === 'Home') setSize(min);
    else if (event.key === 'End') setSize(max);
    else return;

    event.preventDefault();
  };

  return { size, onPointerDown, onKeyDown };
}
