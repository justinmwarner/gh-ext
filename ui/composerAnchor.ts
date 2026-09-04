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
import type { AnchorableSides } from '@/lib/review/diffScope';
import type { CommentAnchor } from '@/lib/review/selection';
import { normalizeSelection } from '@/lib/review/selection';
import type { AnnotationSide } from '@/lib/review/threads';

/** Why a selection cannot be turned into a comment. */
export type ComposerRejection = 'cross-side' | 'invalid-range' | 'other-commit';

export interface ComposerTarget {
  path: string;
  /** The Pierre side the composer's annotation attaches to. */
  side: AnnotationSide;
  /** The Pierre line the composer's annotation attaches to. */
  lineNumber: number;
  /** What to post, or null when the selection cannot be posted at all. */
  anchor: CommentAnchor | null;
  rejection: ComposerRejection | null;
}

/**
 * Returns null when there is nowhere on screen to put even the explanation, so
 * the caller can say so somewhere the reviewer will still see it.
 *
 * `sides` is the third refusal and the one that is not about the gesture.
 * A comment is posted as a line number in the *pull request's* diff —
 * `addPullRequestReviewThread` takes `path`, `line` and `side` and nothing to
 * say which commit they are counted in — so a line picked off a diff between
 * two other commits would attach to whatever occupies that number in the pull
 * request's own diff. The comment would look posted, on code the reviewer
 * never read. Nothing here can repair that, so it is refused where they can
 * see why.
 */
export function composerFor(
  path: string,
  range: SelectedLineRange,
  sides: AnchorableSides,
): ComposerTarget | null {
  const result = normalizeSelection(range);

  if (result.ok) {
    const side: AnnotationSide = result.value.side === 'LEFT' ? 'deletions' : 'additions';
    return {
      path,
      side,
      lineNumber: result.value.line,
      // Placed either way. The reviewer selected a line they can see, and an
      // explanation attached to it beats a control that does nothing.
      anchor: sides[side] ? result.value : null,
      rejection: sides[side] ? null : 'other-commit',
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
