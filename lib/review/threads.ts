import type { ReviewThread } from '../github/types';

export type AnnotationSide = 'deletions' | 'additions';

export type ThreadAnchor =
  | { kind: 'anchored'; side: AnnotationSide; lineNumber: number }
  | { kind: 'unanchorable'; reason: 'outdated' | 'file-level' | 'no-line' };

/**
 * A thread is multi-line only when its endpoints differ. GitHub sets
 * `startLine === line` for single-line threads rather than leaving it null,
 * so a null check here would classify every thread as multi-line.
 */
export function isMultiLine(t: ReviewThread): boolean {
  return t.startLine != null && t.line != null && t.startLine !== t.line;
}

/**
 * Pierre annotations carry exactly one line number, so a multi-line thread
 * anchors to its end line and the range travels in annotation metadata.
 *
 * Callers MUST render `unanchorable` threads in a per-file section. Pierre
 * discards annotations outside rendered hunks without warning, so a thread that
 * is neither anchored nor listed is simply invisible.
 */
export function anchorThread(t: ReviewThread): ThreadAnchor {
  if (t.subjectType === 'FILE') {
    return { kind: 'unanchorable', reason: 'file-level' };
  }
  if (t.line == null) {
    return { kind: 'unanchorable', reason: t.isOutdated ? 'outdated' : 'no-line' };
  }
  return {
    kind: 'anchored',
    side: t.diffSide === 'LEFT' ? 'deletions' : 'additions',
    lineNumber: t.line,
  };
}

/** Splits threads for one file into those Pierre can render inline and those it cannot. */
export function partitionThreads(threads: ReviewThread[]): {
  anchored: Array<{ thread: ReviewThread; anchor: Extract<ThreadAnchor, { kind: 'anchored' }> }>;
  unanchorable: ReviewThread[];
} {
  // Explicit types: an empty literal would infer as never[] and fail to compile.
  const anchored: Array<{
    thread: ReviewThread;
    anchor: Extract<ThreadAnchor, { kind: 'anchored' }>;
  }> = [];
  const unanchorable: ReviewThread[] = [];
  for (const thread of threads) {
    const anchor = anchorThread(thread);
    if (anchor.kind === 'anchored') anchored.push({ thread, anchor });
    else unanchorable.push(thread);
  }
  return { anchored, unanchorable };
}
