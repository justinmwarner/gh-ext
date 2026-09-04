/**
 * Deciding which review threads Pierre can draw, and which have to be listed.
 *
 * `partitionThreads` answers "does this thread have a line to anchor to". It
 * cannot answer "will that line be on screen", because it is handed threads and
 * nothing else. This layer has the parsed patch, so it is the only place that
 * can — and it has to, because Pierre discards an annotation whose line falls
 * outside a rendered hunk **silently**. A thread that is neither anchored nor
 * listed is invisible: the reviewer is never told the comment exists, and
 * losing review feedback is the worst thing this application can do.
 *
 * So every anchor from `partitionThreads` is cross-checked against the real
 * hunk ranges here, and anything outside them is demoted into the per-file
 * section rather than handed to a renderer that will drop it.
 *
 * The second cross-check is worse than the first. A thread's line is a
 * position in the *pull request's* diff, and the diff on screen may be between
 * two other commits — so the same number counts against a different file.
 * There the annotation is not dropped, it is drawn, on whatever text occupies
 * that row. `sides` says which sides can be believed, and a thread on one that
 * cannot is demoted for that reason instead.
 */

import type { DiffLineAnnotation, FileDiffMetadata, Hunk } from '@pierre/diffs';
import type { DiffSide, ReviewThread } from '@/lib/github/types';
import type { AnchorableSides } from '@/lib/review/diffScope';
import { type AnnotationSide, isMultiLine, partitionThreads } from '@/lib/review/threads';

/** An inclusive, one-based span of lines on one side of the diff. */
export interface LineRange {
  start: number;
  end: number;
}

export interface RenderedLines {
  additions: LineRange[];
  deletions: LineRange[];
}

/** What a thread annotation carries across to `renderAnnotation`. */
export interface ThreadMetadata {
  kind: 'thread';
  threadId: string;
}

/** The open composer, anchored the same way a thread is. */
export interface ComposerMetadata {
  kind: 'composer';
}

export type AnnotationMetadata = ThreadMetadata | ComposerMetadata;

export type ListedReason =
  | 'outdated'
  | 'file-level'
  | 'no-line'
  | 'out-of-hunk'
  /** The diff on screen numbers this side's lines against a different commit. */
  | 'other-commit';

export interface ListedThread {
  thread: ReviewThread;
  reason: ListedReason;
}

export interface FileThreadLayout {
  annotations: DiffLineAnnotation<AnnotationMetadata>[];
  /** Everything Pierre cannot draw inline, and would otherwise lose. */
  listed: ListedThread[];
}

const spanOf = (hunk: Hunk, side: AnnotationSide): LineRange =>
  side === 'additions'
    ? { start: hunk.additionStart, end: hunk.additionStart + hunk.additionCount - 1 }
    : { start: hunk.deletionStart, end: hunk.deletionStart + hunk.deletionCount - 1 };

/**
 * The lines this file will actually put on screen, per side.
 *
 * Read off the hunk headers rather than counted from the rendered rows: the
 * counts include context lines, which are rendered and are perfectly valid
 * comment targets, and both are known before anything mounts.
 */
export function renderedLines(fileDiff: FileDiffMetadata): RenderedLines {
  const additions: LineRange[] = [];
  const deletions: LineRange[] = [];

  for (const hunk of fileDiff.hunks) {
    if (hunk.additionCount > 0) additions.push(spanOf(hunk, 'additions'));
    if (hunk.deletionCount > 0) deletions.push(spanOf(hunk, 'deletions'));
  }

  return { additions, deletions };
}

export function isRenderedLine(
  lines: RenderedLines,
  side: AnnotationSide,
  lineNumber: number,
): boolean {
  return lines[side].some(
    (range) => lineNumber >= range.start && lineNumber <= range.end,
  );
}

/**
 * "Nothing has been expanded", shared so the default costs no allocation.
 *
 * Expansion is reported per line and only ever on the additions side: Pierre's
 * `isLineRenderable` takes a one-based new-file line and there is no
 * deletion-side counterpart, so a deletion-side thread in collapsed context
 * stays listed. Listed is the safe verdict — it is visible either way.
 */
const EMPTY_LINES: ReadonlySet<number> = new Set();

const toAnnotationSide = (side: DiffSide): AnnotationSide =>
  side === 'LEFT' ? 'deletions' : 'additions';

export interface ThreadLayoutOptions {
  /**
   * Which sides of *this* diff number their lines the way the pull request's
   * own diff does.
   *
   * Required rather than defaulted, because forgetting it is the dangerous
   * outcome and a default would be exactly the forgotten case.
   */
  sides: AnchorableSides;
  /** Memoized annotation metadata, kept alive across renders. */
  metadata?: Map<string, ThreadMetadata>;
  /** Lines the renderer has reported drawable after expanding context. */
  revealed?: ReadonlySet<number>;
}

/**
 * Annotations for one file, plus everything that has to be listed instead.
 *
 * Two demotions happen here and they fail differently. A line outside the
 * rendered hunks is a comment Pierre would silently *not* draw. A line on a
 * side whose numbers belong to a different commit is a comment Pierre would
 * silently draw *in the wrong place* — which is worse, because the reviewer
 * has no way to suspect it. Both end up in the per-file list; only the second
 * needs its own sentence, because "not shown" and "shown against code it was
 * not written about" are not the same warning.
 *
 * `metadata` is passed in so its identity survives across renders: Pierre
 * compares annotation metadata **by reference**, so a fresh object each time
 * reads as a changed annotation and rebuilds the row's DOM on every render.
 * Keyed by thread id rather than by thread object, so a thread whose resolved
 * state just changed keeps the same annotation.
 */
export function layoutThreads(
  threads: readonly ReviewThread[],
  fileDiff: FileDiffMetadata,
  options: ThreadLayoutOptions,
): FileThreadLayout {
  const { sides, metadata = new Map(), revealed = EMPTY_LINES } = options;
  const lines = renderedLines(fileDiff);
  const { anchored, unanchorable } = partitionThreads([...threads]);

  const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [];
  const listed: ListedThread[] = [];

  for (const thread of unanchorable) {
    listed.push({
      thread,
      reason:
        thread.subjectType === 'FILE'
          ? 'file-level'
          : thread.isOutdated
            ? 'outdated'
            : 'no-line',
    });
  }

  for (const { thread, anchor } of anchored) {
    // Before the hunk check, and not subject to `revealed`. Expanding context
    // proves a row is on screen; it says nothing about whether the number on
    // that row means what this thread's line number means. Checked first so a
    // thread that fails both tests is explained by the one the reviewer can do
    // something about — going back to the whole diff.
    if (!sides[anchor.side]) {
      listed.push({ thread, reason: 'other-commit' });
      continue;
    }

    // The cross-check. Pierre would accept this annotation and then draw
    // nothing, so a line outside the hunks is demoted rather than trusted.
    //
    // `revealed` is the escape hatch, and it is not a guess: it holds lines
    // the renderer itself has reported as renderable after expanding
    // unchanged context. A hunk range is what the *patch* draws; expansion
    // draws more than that, and none of it is visible in the metadata.
    if (
      !isRenderedLine(lines, anchor.side, anchor.lineNumber) &&
      !(anchor.side === 'additions' && revealed.has(anchor.lineNumber))
    ) {
      listed.push({ thread, reason: 'out-of-hunk' });
      continue;
    }

    let memoized = metadata.get(thread.id);
    if (memoized === undefined) {
      memoized = { kind: 'thread', threadId: thread.id };
      metadata.set(thread.id, memoized);
    }

    annotations.push({
      side: anchor.side,
      lineNumber: anchor.lineNumber,
      metadata: memoized,
    });
  }

  return { annotations, listed };
}

/**
 * Where a thread sits, said in words.
 *
 * Multi-line threads need this most: `anchorThread` collapses them to their end
 * line because Pierre carries one line number per annotation, so without the
 * range spelled out here a comment on five lines is indistinguishable from a
 * comment on the last of them.
 */
export function threadPosition(thread: ReviewThread): string {
  if (thread.subjectType === 'FILE') return 'Whole file';

  if (thread.line === null) {
    // Outdated threads null out `line` but keep `originalLine`, so there is
    // always something better to say than "somewhere in this file".
    if (thread.originalLine === null) return 'Position unknown';
    return thread.originalStartLine !== null &&
      thread.originalStartLine !== thread.originalLine
      ? `was on lines ${thread.originalStartLine}-${thread.originalLine}`
      : `was on line ${thread.originalLine}`;
  }

  return isMultiLine(thread)
    ? `Lines ${thread.startLine}-${thread.line}`
    : `Line ${thread.line}`;
}

/**
 * The text of a span of lines, as the patch carries it.
 *
 * All or nothing. A suggestion seeded with only the lines the patch happened to
 * include would propose deleting the ones it did not, which is a worse outcome
 * than an empty suggestion the reviewer has to type into.
 */
export function sourceLines(
  fileDiff: FileDiffMetadata,
  side: DiffSide,
  startLine: number,
  endLine: number,
): string[] {
  const annotationSide = toAnnotationSide(side);
  const content =
    annotationSide === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines;

  const found: string[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    const text = lineText(fileDiff, annotationSide, content, line);
    if (text === null) return [];
    found.push(text);
  }
  return found;
}

function lineText(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  content: readonly string[],
  lineNumber: number,
): string | null {
  for (const hunk of fileDiff.hunks) {
    const span = spanOf(hunk, side);
    if (lineNumber < span.start || lineNumber > span.end) continue;
    const base = side === 'additions' ? hunk.additionLineIndex : hunk.deletionLineIndex;
    const text = content[base + (lineNumber - span.start)];
    // Pierre keeps each line's own terminator. Left in, every suggestion would
    // come out double-spaced with a stray blank line before the closing fence.
    return text === undefined ? null : text.replace(/\r?\n$/, '');
  }
  return null;
}

/**
 * One entry in the Overview's unresolved-thread jump list.
 *
 * `inDiff` is the honest half. `files` is capped at a page limit and
 * `reviewThreads` is followed separately, so a large pull request really can
 * carry comments on files the column never received — and a thread listed with
 * nowhere to jump to is still infinitely better than one that is not listed.
 */
export interface UnresolvedJump {
  threadId: string;
  path: string;
  /** Where it sits, in the same words the thread header uses. */
  position: string;
  /** The first line of the opening comment, to recognize it by. */
  excerpt: string;
  /** False when no card in the diff column can be scrolled to. */
  inDiff: boolean;
}

/** Long enough to recognize a comment, short enough for a rail entry. */
const EXCERPT_LIMIT = 90;

function excerptOf(thread: ReviewThread): string {
  const first = thread.comments.nodes[0];
  if (first === undefined) return '';

  const line = first.body.split('\n').find((text) => text.trim() !== '')?.trim() ?? '';
  return line.length > EXCERPT_LIMIT ? `${line.slice(0, EXCERPT_LIMIT - 1)}…` : line;
}

/**
 * Every open thread, in reading order.
 *
 * This list is the **only** global index of threads in the UI. The per-file
 * unanchorable section is rendered by `CodeView`'s custom header, so it exists
 * only for the files the column has actually drawn — a thread on a file further
 * down, or on one that never arrived, has no other surface at all. So nothing
 * is filtered out for being unreachable; it is marked unreachable instead.
 *
 * Ordered by the column's own file order so the list reads top to bottom
 * alongside the diff, with anything the column does not have appended after it.
 */
/** Sorts after every known file without depending on the list's length. */
const UNPLACED = Number.MAX_SAFE_INTEGER;

/**
 * Every thread in reading order, each with whether the column can reach it.
 *
 * The order `n` and `p` step through, and the order the Overview's jump list
 * reads in — one function, because two orderings of the same threads would put
 * the keyboard and the list out of step with each other after the first
 * outdated comment.
 */
export function orderedThreads(
  threads: readonly ReviewThread[],
  paths: readonly string[],
): { thread: ReviewThread; inDiff: boolean }[] {
  const order = new Map(paths.map((path, index) => [path, index]));

  return threads
    .map((thread) => ({ thread, rank: order.get(thread.path) ?? UNPLACED }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.thread.path !== b.thread.path) {
        return a.thread.path < b.thread.path ? -1 : 1;
      }
      // An outdated thread has no `line` at all, so it sorts to the end of its
      // file rather than to the top as a zero would.
      return (a.thread.line ?? Infinity) - (b.thread.line ?? Infinity);
    })
    .map(({ thread, rank }) => ({ thread, inDiff: rank !== UNPLACED }));
}

export function unresolvedJumps(
  threads: readonly ReviewThread[],
  paths: readonly string[],
): UnresolvedJump[] {
  const order = new Map(paths.map((path, index) => [path, index]));

  return threads
    .filter((thread) => !thread.isResolved)
    .map((thread) => ({ thread, rank: order.get(thread.path) ?? UNPLACED }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.thread.path !== b.thread.path) {
        return a.thread.path < b.thread.path ? -1 : 1;
      }
      // An outdated thread has no `line` at all, so it sorts to the end of its
      // file rather than to the top as a zero would.
      return (a.thread.line ?? Infinity) - (b.thread.line ?? Infinity);
    })
    .map(({ thread, rank }) => ({
      threadId: thread.id,
      path: thread.path,
      position: threadPosition(thread),
      excerpt: excerptOf(thread),
      inDiff: rank !== UNPLACED,
    }));
}
