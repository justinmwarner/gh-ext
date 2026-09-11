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
 * Each becomes a `file` item with no contents, carrying its own sentence in a
 * measured annotation. A blank card is indistinguishable from a card that
 * failed to load, and the difference matters to a reviewer deciding whether
 * they have seen everything.
 *
 * The split between the two item shapes is a measurement decision, not a
 * rendering one. `CodeView` sizes an item's header from one global metric and
 * never measures it, so anything variable up there is scroll range it does not
 * know it owes; it *does* measure a file-level annotation, and only on an
 * expanded item. So every card that is not a plain text diff is an expanded
 * item with nothing to draw and its whole body in an annotation.
 * `lib/review/columnTail.ts` has the library facts and the measurements.
 */

import { parsePatchFiles } from '@pierre/diffs';
import type { CodeViewItem, DiffLineAnnotation, FileDiffMetadata } from '@pierre/diffs';
import { MODE_SLOTS, RAW, changeSides, modeIndex } from '@/lib/compare/modes';
import type { ReviewFile } from './reviewFiles';
import type { AnnotationMetadata, BodyMetadata } from './reviewThreads';

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
    // Named by what happened to it. "Binary file changed" on a file that was
    // added is not wrong, exactly, but it is the least of what is known — and
    // for a reviewer scanning a card with nothing else in it, the difference
    // between a new asset and an edited one is most of the review.
    const sides = changeSides(file);
    const what =
      sides === 'added'
        ? 'Binary file added.'
        : sides === 'deleted'
          ? 'Binary file removed.'
          : 'Binary file changed.';
    return {
      kind: 'binary',
      message: `${what} There is no text diff to show — open it on GitHub to see it.`,
    };
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
 * not own. Nothing renders from it — a file with no hunks is a `file` item —
 * but the thread layout, the hunk stops and the composer all ask every file for
 * its metadata, and they need an answer rather than an exception.
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
 * A value that changes exactly when a file's parsed diff does — including when
 * it changes without becoming a different object.
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
 * **Identity alone is not enough either, and this is the subtler half.** When
 * `loadDiffFiles` hydrates a partial diff, Pierre upgrades the metadata *in
 * place*: `CodeView.recomputeLayout` calls `Object.assign(item.item.fileDiff,
 * hydrated)` on the very object handed to it (verified against 1.4.1 — see the
 * test that pins it). `isPartial` flips to false, `hunks` is rebuilt and both
 * line arrays grow to the whole file, and through all of it `===` still holds.
 * A `WeakMap`-keyed revision number can never notice, so a thread demoted while
 * its line was collapsed would stay in the per-file list forever after the
 * reviewer expanded to it.
 *
 * So the signature is the identity number *plus* the mutable state hydration
 * rewrites. The identity term keeps two structurally identical parses of
 * different files apart; the rest is what changes underneath one.
 */
const diffRevisions = new WeakMap<FileDiffMetadata, number>();
let nextDiffRevision = 0;

function identityOf(parsed: FileDiffMetadata): number {
  const seen = diffRevisions.get(parsed);
  if (seen !== undefined) return seen;

  nextDiffRevision += 1;
  diffRevisions.set(parsed, nextDiffRevision);
  return nextDiffRevision;
}

/**
 * The state hydration rewrites, as a string.
 *
 * Lengths and counts rather than contents: this runs for every file on every
 * render of the column, and a five-hundred-file pull request cannot afford to
 * hash half a million lines to find out that nothing moved. Every one of these
 * is rewritten by `hydrateTwoSidedFileDiff`, so any of them alone would do —
 * together they also catch a re-parse that produced a different shape.
 */
export function fileDiffSignature(file: ReviewFile): string {
  const parsed = fileDiffFor(file);
  return [
    identityOf(parsed),
    parsed.isPartial ? 'partial' : 'whole',
    parsed.hunks.length,
    parsed.additionLines.length,
    parsed.deletionLines.length,
    parsed.unifiedLineCount,
  ].join('.');
}

/**
 * A number identifying one *set* of parsed diffs.
 *
 * `CodeView` reuses the record it holds for an item id. Through 1.3.6 that
 * record kept the code it first rendered: handing the same path a different
 * `fileDiff` updated the item and left the old rows on screen, which under
 * "changes since my last review" would have shown the wrong diff silently.
 * **1.4.1 draws the new patch** — see the test that pins it — so the remount is
 * no longer what keeps the right code on screen. It is kept because replacing
 * every patch at once is also the one moment where resetting the scroll and
 * each card's collapsed and mode choices is the honest thing to do, and
 * remounting under a new key is the library's own advice for that.
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

/**
 * The mode is folded in beside the diff and the annotations for a reason.
 *
 * `CodeView` reuses the record it holds for an item id and only reconsiders it
 * when `version` moves. Switching a file from its grid to the raw diff changes
 * `collapsed`, which this already watched — but switching between two *rich*
 * modes changes neither the diff nor the annotations nor the collapsed flag,
 * and the card's whole body has still been replaced.
 *
 * Today that would very likely repaint anyway: `SlotPortals` memoizes on the
 * identity of `renderCustomHeader` as well as on the item versions, and the
 * column passes an inline arrow, so the portals are rebuilt on every render
 * regardless. Which is exactly why this is here. Memoizing that callback is a
 * natural optimization for somebody to make later, and the day it happens the
 * mode buttons would stop changing what the card shows — with no error, in one
 * file type at a time, and nothing in the diff to suggest the cause.
 */
const versionOf = (
  subject: object,
  collapsed: boolean,
  annotations: readonly unknown[] | undefined,
  mode: string,
  body: boolean,
): number =>
  ((revisionOf(subject, annotations) * MODE_SLOTS + modeIndex(mode)) * 2 +
    (collapsed ? 1 : 0)) *
    2 +
  (body ? 1 : 0);

/**
 * Does this card show Pierre's own diff in its body?
 *
 * Only in the raw mode, and only when there is a patch to draw. Every rich
 * comparison renders in the card header instead — which is the same route the
 * "binary file changed" sentence has always taken, and the reason it is
 * available at all: `CodeView` has no hook for replacing an item's body, and
 * a collapsed item is one whose header is the whole of it.
 */
export function showsTextDiff(file: ReviewFile, mode: string): boolean {
  return mode === RAW.id && fileBody(file).kind === 'diff';
}

/**
 * The metadata a card uses when its body is a comparison rather than a diff.
 *
 * A diff with no hunks, so the renderer draws no rows at all and the card is
 * its header and its annotation — which is what it looked like when these were
 * collapsed items, and the appearance is not meant to change.
 *
 * **Why not a `file` item.** One was tried and refused, for one reason. A
 * file's line count comes from `linesFromFileContents`, whose offsets start at
 * `[0]`, so *even empty contents are one line* — every rich card grew a blank
 * row with a `1` in its gutter, in both views, under a PNG. A constant piece of
 * wrong chrome on every rich card is not worth it.
 *
 * This used to be a trade rather than a plain refusal: a `diff` item lays its
 * annotations out per side, so in split view the comparison drew in one column,
 * measured at 407px of an 880px card against 848px for a `file` item. That cost
 * is gone — `FULL_WIDTH_RICH_BODY` in `DiffColumn.tsx` collapses the empty pair
 * to one column, and the body now measures 845px. Both halves are had, and the
 * phantom line is the only thing still deciding this.
 *
 * Cached on the `ReviewFile` for the same reason the parsed diffs are: a fresh
 * object every render reads to `CodeView` as a different file to render.
 */
const emptyByFile = new WeakMap<ReviewFile, FileDiffMetadata>();

function emptyDiffFor(file: ReviewFile): FileDiffMetadata {
  const held = emptyByFile.get(file);
  if (held !== undefined) return held;

  const made = placeholderFileDiff(file);
  emptyByFile.set(file, made);
  return made;
}

/**
 * The one annotation that says "the card's body goes here".
 *
 * A single frozen object rather than one per file. It carries no payload —
 * which file it belongs to is the item it hangs off, and `renderAnnotation` is
 * handed that item — and sharing it keeps two cards' annotation arrays from
 * differing in a way nothing downstream cares about.
 */
const BODY: BodyMetadata = Object.freeze({ kind: 'body' });

export function codeViewItems(
  files: readonly ReviewFile[],
  collapsedPaths: ReadonlySet<string>,
  annotationsByPath: ReadonlyMap<string, DiffLineAnnotation<AnnotationMetadata>[]> = new Map(),
  modes: ReadonlyMap<string, string> = new Map(),
  /**
   * Paths whose card has something to put in a body beyond its comparison —
   * threads the diff cannot show, or a notice about how it was rewritten.
   *
   * Passed in rather than derived because both live in the column's state. A
   * file not named here and not in a rich mode gets no annotation at all, which
   * is the common card by a wide margin: an unfilled annotation host is a strip
   * of empty space between every header and its first hunk.
   */
  withBody: ReadonlySet<string> = new Set(),
): CodeViewItem<AnnotationMetadata>[] {
  return files.map((file) => {
    const mode = modes.get(file.path) ?? RAW.id;
    const rich = !showsTextDiff(file, mode);
    const collapsed = rich ? false : collapsedPaths.has(file.path);
    const threads = annotationsByPath.get(file.path);
    // Nowhere to put it: a collapsed item is sized at its header region and
    // renders no annotation host at all. Collapsed goes on meaning header only.
    const body = !collapsed && (rich || withBody.has(file.path));

    // The empty one for a comparison, so no rows are drawn under it. The real
    // parse is still what every other reader of this file gets: the thread
    // layout, the hunk stops and the composer all ask for it by path.
    const fileDiff = rich ? emptyDiffFor(file) : fileDiffFor(file);
    // The array the column memoized, untouched, whenever there is nothing to
    // add to it — an item whose annotations are a fresh array every render is
    // an item that re-renders every render. `lineNumber: 0` is the file level,
    // which Pierre draws above the first hunk, so the body sits between the
    // header and the diff wherever the threads happen to be anchored.
    const annotations = !body
      ? threads
      : [...(threads ?? []), { side: 'additions' as const, lineNumber: 0, metadata: BODY }];

    return {
      id: file.path,
      type: 'diff',
      fileDiff,
      collapsed,
      ...(annotations !== undefined ? { annotations } : {}),
      version: versionOf(fileDiff, collapsed, threads, mode, body),
    };
  });
}
