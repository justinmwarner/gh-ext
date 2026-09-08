/**
 * Everything on a card that is not a fixed row, and the one place it can be
 * measured.
 *
 * `CodeView` sizes an item's header from a single global metric — 44px here —
 * and never measures it. Anything variable rendered up there is scroll range
 * the viewer does not know it owes, and the error is not only cumulative: the
 * column *lurches* by a card's whole shortfall each time it releases one while
 * scrolling, which is what made a run of rich cards look like it was skipping
 * files. A file-level annotation is measured and folded into the item's height.
 * `lib/review/columnTail.ts` has both library facts and the numbers.
 *
 * So the division is not aesthetic. The header keeps exactly what is fixed —
 * the name, the counts, the viewed box, the controls — and everything whose
 * height depends on the file lives here, in an annotation, where the viewer can
 * see it.
 *
 * Rendered through `renderAnnotation`, which means it is ordinary light DOM
 * slotted into the shadow row, exactly as the header is.
 */

import { RAW } from '@/lib/compare/modes';
import { type WhitespaceDiff, whitespaceNotice } from '@/lib/review/whitespace';
import type { BlobRefs } from './blobLoader';
import { RichCompare } from './RichCompare';
import { UnanchoredThreads } from './UnanchoredThreads';
import { fileBody } from './diffItems';
import type { ReviewFile } from './reviewFiles';
import type { ListedThread } from './reviewThreads';

export interface FileBodyProps {
  file: ReviewFile;
  /** How this file is being compared. Already resolved against what it offers. */
  mode: string;
  /** The rewrite this file is being read through, or null for GitHub's diff. */
  whitespace: WhitespaceDiff | null;
  /** Threads on this file that the diff cannot draw. */
  unanchored: readonly ListedThread[];
  /** The two commits a rich comparison reads whole files from. */
  blobs: BlobRefs | null;
}

export function FileBody({
  file,
  mode,
  whitespace,
  unanchored,
  blobs,
}: FileBodyProps) {
  const body = fileBody(file);
  const raw = mode === RAW.id;

  return (
    <div className="file-body" data-file-body={file.path}>
      {/* Not `role="status"`. This does not announce an event, it labels what
          is underneath it for as long as it is underneath it — and it is the
          only thing on the page that says the body is not GitHub's diff. */}
      {whitespace !== null && (
        <p className="file-note" data-whitespace-note role="note">
          {whitespaceNotice(whitespace)}
        </p>
      )}

      {/* The sentence explaining an absent diff belongs to the raw view alone.
          Left on, a PNG in its side-by-side comparison would carry "Binary
          file changed. There is no text diff to show" directly above the two
          images that are showing it. */}
      {raw && body.message !== null && (
        <p className="file-note" role="note">
          {body.message}
        </p>
      )}

      <RichCompare file={file} mode={mode} refs={blobs} />

      <UnanchoredThreads path={file.path} threads={unanchored} />
    </div>
  );
}

/**
 * Has this file anything to put in a body beyond a comparison?
 *
 * Asked by the column so it can leave the annotation off entirely for the
 * common card — an ordinary source file with an ordinary diff. An annotation
 * host that renders nothing is still a strip of empty space between the header
 * and the first hunk, on every file in the review.
 *
 * A rich comparison is not asked about here: it always has a body, and the
 * column knows that from the mode without consulting this.
 */
export function hasBodyContent(
  whitespace: WhitespaceDiff | null,
  unanchored: readonly ListedThread[],
): boolean {
  return whitespace !== null || unanchored.length > 0;
}
