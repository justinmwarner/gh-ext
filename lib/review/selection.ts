import type { DiffSide } from '../github/types';
import type { AnnotationSide } from './threads';

/** Mirrors Pierre's SelectedLineRange. See docs/reference/pierre-diffs-api.md section C. */
export interface SelectedLineRange {
  start: number;
  end: number;
  side?: AnnotationSide;
  endSide?: AnnotationSide;
}

/** A comment on one line, or on the range ending at one. */
export interface LineAnchor {
  subject: 'line';
  line: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
}

/**
 * A comment on the file rather than on a line.
 *
 * GitHub has always taken these — `subjectType: FILE` — and this application
 * has always *read* them; `ui/reviewThreads.ts` labels them "Whole file". It
 * has never posted one, because until now every comment started from a gutter
 * and a gutter is made of lines.
 *
 * The rendered Markdown view is what needs it: it draws the whole document, so
 * most of what is on screen is outside every hunk, and a block that cannot take
 * a line comment can still take this one.
 */
export interface FileAnchor {
  subject: 'file';
}

/**
 * Discriminated, rather than a line anchor whose `line` may be null.
 *
 * The nullable shape is the one GitHub's own thread carries, and it is the
 * reason `ReviewThread` needs `subjectType` beside it to be read at all: a null
 * line means "on the file" and also "outdated, we lost the number". Copying it
 * here would leave `.line` legal to write at every site and answer nothing, so
 * the first file comment would reach the screen as the word `undefined` in a
 * sentence. The discriminant makes the typechecker ask instead.
 */
export type CommentAnchor = LineAnchor | FileAnchor;

/**
 * The file anchor, made rather than written out.
 *
 * A constructor for a field-less object looks like ceremony until it gains a
 * field — a position within the rendered document, say, so two file comments
 * can be told apart. Then it is one edit rather than a search for every
 * `subject: 'file'` in the tree.
 */
export const fileAnchor = (): FileAnchor => ({ subject: 'file' });

/**
 * Widening the success case to `CommentAnchor` would suggest this could answer
 * "about the file", and it cannot: it is handed a range of lines and lines are
 * the only thing it can honestly return. Nor is a selection it refuses thereby
 * a comment about the file — whether the reviewer meant one is a question, and
 * nothing down here is in a position to ask it.
 */
export type NormalizeResult =
  | { ok: true; value: LineAnchor }
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

  if (lo === hi) return { ok: true, value: { subject: 'line', line: hi, side: ghSide } };

  return {
    ok: true,
    value: { subject: 'line', line: hi, side: ghSide, startLine: lo, startSide: ghSide },
  };
}
