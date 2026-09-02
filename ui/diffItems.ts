/**
 * Turning changed files into `CodeView` items.
 *
 * `CodeView` owns one scroll region and virtualizes the whole stack itself,
 * which is the only way a five-hundred-file pull request stays interactive. The
 * price is that every file has to be an item — including the ones with no diff
 * to show.
 *
 * Four kinds of file have nothing to render:
 *
 * - a binary blob, which has no text diff by definition
 * - a file whose patch GitHub declined to send, on the oversized-PR fallback
 * - a rename that moved a file without changing a line of it
 * - a mode change, which is a patch with a header and no hunks
 *
 * Each becomes a collapsed item carrying its own sentence. A blank card is
 * indistinguishable from a card that failed to load, and the difference matters
 * to a reviewer deciding whether they have seen everything.
 */

import { parsePatchFiles } from '@pierre/diffs';
import type { CodeViewItem, FileDiffMetadata } from '@pierre/diffs';
import type { ReviewFile } from './reviewFiles';

export type FileBodyKind = 'diff' | 'binary' | 'omitted' | 'renamed-only' | 'no-content';

export interface FileBody {
  kind: FileBodyKind;
  /** What to show in place of a diff. Null when there is a diff to show. */
  message: string | null;
}

/**
 * Does this patch contain anything to render?
 *
 * Anchored per line, so a `+` line that happens to contain `@@ -1 +1 @@` inside
 * a string literal is not mistaken for a hunk header. Cheaper and more robust
 * than parsing, and the answer is needed before deciding whether to parse.
 */
export function hasHunks(patch: string): boolean {
  return /^@@ /m.test(patch);
}

export function fileBody(file: ReviewFile): FileBody {
  // Checked before `isBinary`: both are true of a large binary on the fallback
  // path, and "GitHub did not send it" is the more actionable of the two — it
  // tells the reviewer the file is unread rather than unreadable.
  if (file.patchOmitted) {
    return {
      kind: 'omitted',
      message:
        'GitHub did not send a patch for this file. It is too large for the ' +
        'files endpoint to include one — open it on GitHub to read the change.',
    };
  }

  if (file.isBinary) {
    return { kind: 'binary', message: 'Binary file. There is no text diff to show.' };
  }

  if (hasHunks(file.patch)) return { kind: 'diff', message: null };

  if (file.isRename) {
    return {
      kind: 'renamed-only',
      message: `Renamed from ${file.oldPath} to ${file.path}, with no content changes.`,
    };
  }

  return {
    kind: 'no-content',
    message: 'No content changes. The file mode or its git metadata moved instead.',
  };
}

/**
 * A metadata object for a file the renderer will never draw.
 *
 * Built by hand rather than parsed. `parsePatchFiles` returns nothing at all
 * for the empty patch a withheld file carries, and synthesizing a patch header
 * to feed it would mean escaping paths for a parser whose quoting rules we do
 * not own. These items are always collapsed, so no hunk is ever walked.
 */
function placeholderFileDiff(file: ReviewFile): FileDiffMetadata {
  return {
    name: file.path,
    ...(file.isRename ? { prevName: file.oldPath } : {}),
    type: file.isRename ? 'rename-pure' : 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
  };
}

function parseFileDiff(file: ReviewFile): FileDiffMetadata {
  if (file.patch === '') return placeholderFileDiff(file);

  try {
    const parsed = parsePatchFiles(file.patch)[0]?.files[0];
    return parsed ?? placeholderFileDiff(file);
  } catch {
    // A malformed patch must not take the whole column down with it. The card
    // still renders, with its header and its own explanation.
    return placeholderFileDiff(file);
  }
}

/**
 * Parsed diffs, kept for as long as the file they came from.
 *
 * Two reasons, and the second is not an optimisation. Parsing every patch in a
 * five-hundred-file pull request is not something to do again each time the
 * reviewer collapses a card. And `CodeView` compares controlled items by
 * content: handing it a freshly parsed metadata object for a file that did not
 * change reads as new content and throws away the render it already has.
 *
 * Keyed on the `ReviewFile` itself, so a payload that really did change gets
 * fresh parses and the old ones are collected with it.
 */
const parsedByFile = new WeakMap<ReviewFile, FileDiffMetadata>();

function fileDiffFor(file: ReviewFile): FileDiffMetadata {
  const cached = parsedByFile.get(file);
  if (cached !== undefined) return cached;

  const parsed = parseFileDiff(file);
  parsedByFile.set(file, parsed);
  return parsed;
}

/**
 * `version` tells `CodeView` a controlled item changed.
 *
 * Without it the viewer keeps the record it already measured and the collapse
 * toggle moves our state and nothing else. It is derived rather than counted so
 * that re-deriving the list — which happens on every render — is idempotent.
 */
const versionOf = (collapsed: boolean): number => (collapsed ? 1 : 0);

export function codeViewItems(
  files: readonly ReviewFile[],
  collapsedPaths: ReadonlySet<string>,
): CodeViewItem[] {
  return files.map((file) => {
    // A file with no diff is collapsed whatever the reviewer chose: expanding
    // it would reveal an empty rectangle where its message used to be.
    const collapsed =
      fileBody(file).kind !== 'diff' || collapsedPaths.has(file.path);

    return {
      id: file.path,
      type: 'diff',
      fileDiff: fileDiffFor(file),
      collapsed,
      version: versionOf(collapsed),
    };
  });
}
