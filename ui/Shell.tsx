/**
 * The loaded layout: top bar, resizable rail, diff column.
 *
 * Deliberately the same shape as GitHub's Files-changed tab. A reviewer who
 * arrives here from that page should not have to find anything twice.
 */

import type { PrPayload } from '@/lib/messages';
import { DiffColumn } from './DiffColumn';
import { RailResizer } from './RailResizer';
import { SideRail } from './SideRail';
import { TopBar } from './TopBar';
import { TruncationNotice } from './TruncationNotice';
import { prPermalink } from './prNode';
import { useRailWidth } from './useRailWidth';

export function Shell({ payload }: { payload: PrPayload }) {
  const rail = useRailWidth();

  return (
    <div className="shell">
      <TopBar payload={payload} />
      <TruncationNotice
        truncated={payload.truncated}
        pr={payload.ref}
        href={prPermalink(payload.pullRequest)}
      />
      <div className="shell-body">
        <SideRail width={rail.width} />
        <RailResizer {...rail} />
        <DiffColumn diff={payload.diff} />
      </div>
    </div>
  );
}
