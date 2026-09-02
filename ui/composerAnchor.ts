/**
 * Where the composer goes for a given gutter gesture.
 *
 * `normalizeSelection` answers whether GitHub can express the range. It cannot
 * answer where to put the box when the answer is no, and that matters: a
 * cross-side drag needs an explanation attached to a line the reviewer can see,
 * not a silent refusal. The end of the drag is always such a line — it is where
 * the pointer was released.
 */

import type { SelectedLineRange } from '@pierre/diffs';
import type { CommentAnchor } from '@/lib/review/selection';
import { normalizeSelection } from '@/lib/review/selection';
import type { AnnotationSide } from '@/lib/review/threads';

export interface ComposerTarget {
  path: string;
  /** The Pierre side the composer's annotation attaches to. */
  side: AnnotationSide;
  /** The Pierre line the composer's annotation attaches to. */
  lineNumber: number;
  /** What to post, or null when the selection cannot be posted at all. */
  anchor: CommentAnchor | null;
  rejection: 'cross-side' | 'invalid-range' | null;
}

/**
 * Returns null when there is nowhere on screen to put even the explanation, so
 * the caller can say so somewhere the reviewer will still see it.
 */
export function composerFor(
  path: string,
  range: SelectedLineRange,
): ComposerTarget | null {
  const result = normalizeSelection(range);

  if (result.ok) {
    return {
      path,
      side: result.value.side === 'LEFT' ? 'deletions' : 'additions',
      lineNumber: result.value.line,
      anchor: result.value,
      rejection: null,
    };
  }

  // `endSide` is omitted when it equals `side`, so it is read this way round
  // everywhere — including by Pierre itself.
  const side = range.endSide ?? range.side ?? 'additions';
  if (!Number.isInteger(range.end) || range.end <= 0) return null;

  return {
    path,
    side,
    lineNumber: range.end,
    anchor: null,
    rejection: result.reason,
  };
}
