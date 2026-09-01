/**
 * The left rail's width, and the two ways to change it.
 *
 * Width lives in React state rather than in a CSS variable poked at from an
 * event handler, so the rail and the resize handle's `aria-valuenow` can never
 * disagree about how wide it is.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

export const MIN_RAIL_PX = 180;
export const MAX_RAIL_PX = 560;
export const DEFAULT_RAIL_PX = 296;

/** One arrow key press. Coarse enough to be useful, fine enough to aim. */
const STEP_PX = 16;

const clamp = (px: number): number =>
  Math.min(MAX_RAIL_PX, Math.max(MIN_RAIL_PX, Math.round(px)));

export interface RailWidth {
  width: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useRailWidth(initial: number = DEFAULT_RAIL_PX): RailWidth {
  const [width, setWidth] = useState(() => clamp(initial));

  /** Tears down an in-progress drag. Held so unmount can end one. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // Text selection across the whole page is the default outcome of dragging,
    // and it makes the resize look broken.
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = width;

    const onMove = (moveEvent: PointerEvent): void => {
      setWidth(clamp(startWidth + moveEvent.clientX - startX));
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
    if (event.key === 'ArrowLeft') setWidth((current) => clamp(current - STEP_PX));
    else if (event.key === 'ArrowRight') setWidth((current) => clamp(current + STEP_PX));
    else if (event.key === 'Home') setWidth(MIN_RAIL_PX);
    else if (event.key === 'End') setWidth(MAX_RAIL_PX);
    else return;

    event.preventDefault();
  };

  return { width, onPointerDown, onKeyDown };
}
