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
import type { CodeViewItem, DiffLineAnnotation, FileDiffMetadata } from '@pierre/diffs';
import type { ReviewFile } from './reviewFiles';
import type { AnnotationMetadata } from './reviewThreads';

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

export function fileDiffFor(file: ReviewFile): FileDiffMetadata {
  const cached = parsedByFile.get(file);
  if (cached !== undefined) return cached;

  const parsed = parseFileDiff(file);
  parsedByFile.set(file, parsed);
  return parsed;
}

/**
 * A number that changes exactly when a file's parsed diff does.
 *
 * The column memoizes each file's thread layout, and the obvious cache key —
 * the threads themselves — is not enough. Switching to "changes since my last
 * review" hands the same path a *different patch* while every thread field
 * stays identical, so a memo keyed on threads alone keeps the old
 * anchored-or-listed verdict. A thread whose line is no longer inside any hunk
 * would then still be handed to Pierre as an annotation, and Pierre drops an
 * annotation outside a rendered hunk in silence: the comment disappears with no
 * error anywhere.
 *
 * A revision number rather than the object itself so it composes into the
 * string signature the layout cache already builds, and a `WeakMap` so a diff
 * that is collected takes its number with it.
 */
const diffRevisions = new WeakMap<FileDiffMetadata, number>();
let nextDiffRevision = 0;

export function fileDiffRevision(file: ReviewFile): number {
  const parsed = fileDiffFor(file);
  const seen = diffRevisions.get(parsed);
  if (seen !== undefined) return seen;

  nextDiffRevision += 1;
  diffRevisions.set(parsed, nextDiffRevision);
  return nextDiffRevision;
}

/**
 * A number identifying one *set* of parsed diffs.
 *
 * `CodeView` reuses the record it holds for an item id and, in practice, keeps
 * the code it first rendered for it: handing the same path a different
 * `fileDiff` updates the item and leaves the old rows on screen (verified
 * against 1.3.6 — see the test that pins it). Replacing the whole diff is
 * exactly what "changes since my last review" does, so the viewer is remounted
 * under a new key instead, which is the library's own advice for changing what
 * a viewer holds.
 *
 * Keyed on the array so this is O(1) and idempotent: the file list is memoized
 * upstream, so a re-render that changed nothing produces the same number and
 * nothing is remounted.
 */
const listRevisions = new WeakMap<object, number>();
let nextListRevision = 0;

export function diffGeneration(files: readonly ReviewFile[]): number {
  const seen = listRevisions.get(files);
  if (seen !== undefined) return seen;

  nextListRevision += 1;
  listRevisions.set(files, nextListRevision);
  return nextListRevision;
}

/** One hunk's first line, on the side the hunk actually shows. */
export interface HunkStop {
  path: string;
  side: 'additions' | 'deletions';
  line: number;
}

/**
 * The top of every hunk in the column, in reading order.
 *
 * What `J` and `K` move between. Read off the parsed hunk headers rather than
 * measured, so it is known before anything is on screen, and flattened across
 * files so hunk navigation runs off the end of one file into the next — which
 * is how a reviewer reads a pull request.
 *
 * A pure addition hunk has no deletion lines to land on and vice versa, so the
 * side is chosen per hunk rather than fixed.
 */
export function hunkStops(files: readonly ReviewFile[]): HunkStop[] {
  const stops: HunkStop[] = [];

  for (const file of files) {
    for (const hunk of fileDiffFor(file).hunks) {
      if (hunk.additionCount > 0) {
        stops.push({ path: file.path, side: 'additions', line: hunk.additionStart });
      } else if (hunk.deletionCount > 0) {
        stops.push({ path: file.path, side: 'deletions', line: hunk.deletionStart });
      }
    }
  }

  return stops;
}

/**
 * `version` tells `CodeView` a controlled item changed.
 *
 * Without it the viewer keeps the record it already measured and the collapse
 * toggle moves our state and nothing else. It is derived rather than counted so
 * that re-deriving the list — which happens on every render — is idempotent.
 *
 * It is derived from **both** halves of what an item draws: the parsed diff and
 * the annotations over it. The diff half is not theoretical — switching to
 * "changes since my last review" replaces the patch for a path the viewer
 * already has an item for, and a version that only watched the annotations
 * would leave the old code on screen under the new file list.
 *
 * Both halves are read from object *identity*, not contents. Both are memoized
 * upstream and only rebuilt when something real moved, so identity is exactly
 * the question "did this change" — and asking it this way keeps a resolve on
 * one file from re-rendering every other file's diff.
 */
const pairRevisions = new WeakMap<object, WeakMap<object, number>>();
let nextRevision = 0;

/** Stands in for "this item has no annotations", which has no array to key on. */
const NO_ANNOTATIONS_KEY: object = {};

const revisionOf = (
  fileDiff: object,
  annotations: readonly unknown[] | undefined,
): number => {
  const key =
    annotations === undefined || annotations.length === 0
      ? NO_ANNOTATIONS_KEY
      : annotations;

  let byAnnotations = pairRevisions.get(fileDiff);
  if (byAnnotations === undefined) {
    byAnnotations = new WeakMap();
    pairRevisions.set(fileDiff, byAnnotations);
  }

  const seen = byAnnotations.get(key);
  if (seen !== undefined) return seen;

  nextRevision += 1;
  byAnnotations.set(key, nextRevision);
  return nextRevision;
};

const versionOf = (
  fileDiff: object,
  collapsed: boolean,
  annotations: readonly unknown[] | undefined,
): number => revisionOf(fileDiff, annotations) * 2 + (collapsed ? 1 : 0);

export function codeViewItems(
  files: readonly ReviewFile[],
  collapsedPaths: ReadonlySet<string>,
  annotationsByPath: ReadonlyMap<string, DiffLineAnnotation<AnnotationMetadata>[]> = new Map(),
): CodeViewItem<AnnotationMetadata>[] {
  return files.map((file) => {
    // A file with no diff is collapsed whatever the reviewer chose: expanding
    // it would reveal an empty rectangle where its message used to be.
    const collapsed =
      fileBody(file).kind !== 'diff' || collapsedPaths.has(file.path);
    const annotations = annotationsByPath.get(file.path);
    const fileDiff = fileDiffFor(file);

    return {
      id: file.path,
      type: 'diff',
      fileDiff,
      collapsed,
      ...(annotations !== undefined ? { annotations } : {}),
      version: versionOf(fileDiff, collapsed, annotations),
    };
  });
}
