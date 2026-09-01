/**
 * The drag handle between the rail and the diff.
 *
 * A focusable separator, which ARIA treats as a range widget — so it reports
 * its width and responds to the arrow keys rather than being a pointer-only
 * affordance.
 */

import type { RailWidth } from './useRailWidth';
import { MAX_RAIL_PX, MIN_RAIL_PX } from './useRailWidth';

export function RailResizer({ width, onPointerDown, onKeyDown }: RailWidth) {
  return (
    <div
      className="rail-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_RAIL_PX}
      aria-valuemax={MAX_RAIL_PX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
