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
import type { PatchStatus } from '@/lib/github/types';
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
 * The one decoration a row is allowed.
 *
 * `parts` exists precisely so a single decoration can carry two differently
 * coloured runs — the library's own source comment cites green additions beside
 * red deletions as the case it was added for. `text` stays the flat string so
 * the accessible name and the ellipsis fallback still read correctly.
 *
 * `undefined` is a directory: it has no counts of its own, and the git lane
 * already rolls its descendants up into a dot.
 */
export function rowDecoration(file: ReviewFile | undefined): CountsDecoration | null {
  if (file === undefined) return null;

  const added = `+${file.additions}`;
  const removed = `${MINUS}${file.deletions}`;
  const counts = `${file.additions} additions, ${file.deletions} deletions`;

  if (file.noise) {
    return {
      text: `${added} ${removed}`,
      title: `Generated, vendored or a lockfile — ${counts}`,
      parts: [
        { text: added, color: NOISE_COLOR },
        { text: ' ' },
        { text: removed, color: NOISE_COLOR },
      ],
    };
  }

  return {
    text: `${added} ${removed}`,
    title: counts,
    parts: [
      { text: added, color: ADDITION_COLOR },
      { text: ' ' },
      { text: removed, color: DELETION_COLOR },
    ],
  };
}
