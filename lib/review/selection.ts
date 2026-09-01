import type { DiffSide } from '../github/types';
import type { AnnotationSide } from './threads';

/** Mirrors Pierre's SelectedLineRange. See docs/reference/pierre-diffs-api.md section C. */
export interface SelectedLineRange {
  start: number;
  end: number;
  side?: AnnotationSide;
  endSide?: AnnotationSide;
}

export interface CommentAnchor {
  line: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
}

export type NormalizeResult =
  | { ok: true; value: CommentAnchor }
  | { ok: false; reason: 'cross-side' };

const toDiffSide = (s: AnnotationSide): DiffSide =>
  s === 'deletions' ? 'LEFT' : 'RIGHT';

export function normalizeSelection(range: SelectedLineRange): NormalizeResult {
  const side = range.side ?? 'additions';
  const endSide = range.endSide ?? side;

  // GitHub has no representation for a range spanning both diff sides.
  if (side !== endSide) return { ok: false, reason: 'cross-side' };

  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const ghSide = toDiffSide(side);

  if (lo === hi) return { ok: true, value: { line: hi, side: ghSide } };

  return {
    ok: true,
    value: { line: hi, side: ghSide, startLine: lo, startSide: ghSide },
  };
}
