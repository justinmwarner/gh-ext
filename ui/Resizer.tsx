/**
 * The drag handle between two regions, on either axis.
 *
 * A focusable separator, which ARIA treats as a range widget — so it reports
 * its size and responds to the arrow keys rather than being a pointer-only
 * affordance.
 *
 * `aria-orientation` describes the separator, not the drag: the handle between
 * the rail and the diff is a vertical line, and the one between the rail's
 * panel and its file tree is a horizontal one.
 */

import type { DragSize } from './useDragSize';

export interface ResizerProps extends DragSize {
  orientation: 'horizontal' | 'vertical';
  label: string;
  min: number;
  max: number;
  className: string;
}

export function Resizer({
  orientation,
  label,
  className,
  size,
  min,
  max,
  onPointerDown,
  onKeyDown,
}: ResizerProps) {
  return (
    <div
      className={className}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
