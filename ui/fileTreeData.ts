/**
 * Everything the file tree is allowed to say about a row.
 *
 * `@pierre/trees` gives a row two places to put information: a fixed-width git
 * lane, and exactly one decoration that is *either* a text cell *or* a single
 * sprite icon — never both, and never arbitrary DOM. So the whole of the tree's
 * vocabulary is decided in this file, before anything is handed over.
 *
 * The split follows §16.6 of the design: the git lane carries the change type,
 * the decoration carries the line counts, and the viewed checkbox lives in the
 * diff card header instead — it has to be clickable, and a decoration is an
 * inert `<span>`.
 *
 * Colours are the tree's own custom properties rather than literals, so light
 * and dark mode follow Pierre and there is no second theme to keep in sync.
 */

import type { GitStatus, GitStatusEntry } from '@pierre/trees';
import type { PatchStatus, ReviewThread } from '@/lib/github/types';
import type { ReviewFile } from './reviewFiles';

/**
 * The text half of `FileTreeRowDecoration`, which the package does not export
 * by name. Declared here so the counts can be read back in a test; assignment
 * into `renderRowDecoration` is what checks it still matches the library.
 */
export interface CountsDecoration {
  text: string;
  title: string;
  parts: readonly { text: string; color?: string }[];
}

export const ADDITION_COLOR = 'var(--trees-git-added-color)';
export const DELETION_COLOR = 'var(--trees-git-deleted-color)';
export const NOISE_COLOR = 'var(--trees-fg-muted)';

/**
 * The one colour here the tree does not already own.
 *
 * Set on `.filetree-host` and inherited into the shadow root, which is how a
 * custom property reaches a decoration the page cannot select. The fallback is
 * not decoration: an undeclared custom property makes the whole `color`
 * declaration invalid at computed-value time, and the dot would inherit the
 * lane's muted grey — which is exactly the colour that means "resolved".
 */
export const COMMENT_COLOR = 'var(--comment-dot-color, currentColor)';

/**
 * How much conversation a file is carrying.
 *
 * Two numbers rather than one because the row draws a different mark for
 * "there is something outstanding here" than for "this was discussed and
 * settled", and the difference is the only thing that makes the mark worth
 * looking at twice.
 */
export interface FileComments {
  total: number;
  unresolved: number;
}

/**
 * Tally threads by the file they are on.
 *
 * A path with no threads is **absent** rather than zeroed. `rowDecoration`
 * reads the absence directly, so a zero-filled map would put a mark on every
 * row in the tree.
 *
 * Threads on files the diff column never received are counted too. They cost
 * nothing here, and a tree that has no row for the path simply never asks.
 */
export function fileComments(
  threads: readonly ReviewThread[],
): Map<string, FileComments> {
  const byPath = new Map<string, FileComments>();

  for (const thread of threads) {
    const tally = byPath.get(thread.path) ?? { total: 0, unresolved: 0 };
    tally.total += 1;
    if (!thread.isResolved) tally.unresolved += 1;
    byPath.set(thread.path, tally);
  }

  return byPath;
}

/**
 * A copy is a new file at its destination, so it reads as `added`; `CHANGED` is
 * GitHub's word for a content change it declined to classify further, which is
 * `modified`. Everything else maps across by name.
 */
const GIT_STATUS: Record<PatchStatus, GitStatus> = {
  ADDED: 'added',
  DELETED: 'deleted',
  RENAMED: 'renamed',
  COPIED: 'added',
  MODIFIED: 'modified',
  CHANGED: 'modified',
};

/**
 * Which letter the git lane shows — or, for noise, that there is no letter.
 *
 * `ignored` is the only status that dims the row *name*, which is the whole
 * point: a lockfile has to stay reachable and stay out of the way, and the two
 * other levers (the decoration cell and the row's own text) cannot do the
 * second. The change type it displaces is still on the row, in the decoration's
 * hover title.
 */
export function gitStatusFor(file: ReviewFile): GitStatus {
  return file.noise ? 'ignored' : GIT_STATUS[file.changeType];
}

export function treeGitStatus(files: readonly ReviewFile[]): GitStatusEntry[] {
  return files.map((file) => ({ path: file.path, status: gitStatusFor(file) }));
}

export function treePaths(files: readonly ReviewFile[]): string[] {
  return files.map((file) => file.path);
}

/** U+2212 MINUS SIGN, which is what GitHub uses and what aligns with `+`. */
const MINUS = '−';

/**
 * U+00A0 NO-BREAK SPACE, and it has to be one.
 *
 * The library renders each part as its own `<span>` inside a **flex**
 * container, so a part holding an ordinary space is a flex item whose entire
 * content is collapsible whitespace: it lays out at zero width, and the runs
 * meet as `+12−3`. A no-break space is not collapsible, so it measures.
 */
export const SEPARATOR = ' ';

/** U+25CF BLACK CIRCLE: something here is still open. */
const OPEN_DOT = '●';
/** U+25CB WHITE CIRCLE: discussed and settled. */
const SETTLED_DOT = '○';

/**
 * The conversation mark, or nothing.
 *
 * Filled against hollow rather than one colour against another, because the
 * two states have to be distinguishable without colour vision — and the tree
 * gives a decoration no other way to differ. The `title` carries the count the
 * glyph deliberately does not.
 */
function commentMark(
  comments: FileComments | undefined,
): { text: string; color: string; title: string } | null {
  if (comments === undefined || comments.total === 0) return null;

  if (comments.unresolved > 0) {
    const n = comments.unresolved;
    return {
      text: OPEN_DOT,
      color: COMMENT_COLOR,
      title: `${n} unresolved ${n === 1 ? 'comment' : 'comments'}`,
    };
  }

  return {
    text: SETTLED_DOT,
    color: NOISE_COLOR,
    title:
      comments.total === 1
        ? '1 comment, resolved'
        : `${comments.total} comments, all resolved`,
  };
}

/**
 * The one decoration a row is allowed.
 *
 * `parts` exists precisely so a single decoration can carry two differently
 * coloured runs — the library's own source comment cites green additions beside
 * red deletions as the case it was added for. `text` stays the flat string so
 * the accessible name and the ellipsis fallback still read correctly. The
 * conversation mark rides in the same cell because there is no second one.
 *
 * `undefined` is a directory: it has no counts of its own, and the git lane
 * already rolls its descendants up into a dot.
 */
export function rowDecoration(
  file: ReviewFile | undefined,
  comments?: FileComments,
): CountsDecoration | null {
  if (file === undefined) return null;

  const added = `+${file.additions}`;
  const removed = `${MINUS}${file.deletions}`;
  const counts = `${file.additions} additions, ${file.deletions} deletions`;
  const countColor = file.noise ? NOISE_COLOR : ADDITION_COLOR;
  const removedColor = file.noise ? NOISE_COLOR : DELETION_COLOR;
  const base = file.noise ? `Generated, vendored or a lockfile — ${counts}` : counts;

  // Last, not first. The decoration lane is right-aligned with its overflow
  // hidden, so a rail dragged narrow loses the *start* of this cell — and the
  // counts survive being clipped in a way the mark does not, because they are
  // the only thing here that is also somewhere else.
  const mark = commentMark(comments);

  return {
    text: mark === null ? `${added} ${removed}` : `${added} ${removed} ${mark.text}`,
    title: mark === null ? base : `${base} — ${mark.title}`,
    parts: [
      { text: added, color: countColor },
      { text: SEPARATOR },
      { text: removed, color: removedColor },
      ...(mark === null
        ? []
        : [{ text: SEPARATOR }, { text: mark.text, color: mark.color }]),
    ],
  };
}
