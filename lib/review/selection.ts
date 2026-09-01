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
  | { ok: false; reason: 'cross-side' | 'invalid-range' };

const toDiffSide = (s: AnnotationSide): DiffSide =>
  s === 'deletions' ? 'LEFT' : 'RIGHT';

const isLineNumber = (n: number): boolean => Number.isInteger(n) && n > 0;

export function normalizeSelection(range: SelectedLineRange): NormalizeResult {
  // Pierre leaves `side` undefined in single-file mode while still emitting
  // `endSide`. Defaulting to 'additions' here would read that as a cross-side
  // drag and reject an ordinary selection, so fall back to endSide first.
  const side = range.side ?? range.endSide ?? 'additions';
  const endSide = range.endSide ?? side;

  // GitHub has no representation for a range spanning both diff sides.
  if (side !== endSide) return { ok: false, reason: 'cross-side' };

  // Without this, NaN or a fractional endpoint reaches GitHub as `line: NaN`
  // and comes back as an opaque 422.
  if (!isLineNumber(range.start) || !isLineNumber(range.end)) {
    return { ok: false, reason: 'invalid-range' };
  }

  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const ghSide = toDiffSide(side);

  if (lo === hi) return { ok: true, value: { line: hi, side: ghSide } };

  return {
    ok: true,
    value: { line: hi, side: ghSide, startLine: lo, startSide: ghSide },
  };
}
