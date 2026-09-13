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

import { useCallback, useMemo, useState } from 'react';
import { RAW } from '@/lib/compare/modes';
import type { PostingComment } from '@/lib/review/posting';
import { type WhitespaceDiff, whitespaceNotice } from '@/lib/review/whitespace';
import type { BlobRefs } from './blobLoader';
import { NOTHING_UNPLACED, type UnplacedComments } from './MarkdownCompare';
import { PostingCard } from './PostingCard';
import { RichCompare } from './RichCompare';
import { UnanchoredThreads } from './UnanchoredThreads';
import { fileBody } from './diffItems';
import type { ReviewFile } from './reviewFiles';
import type { ListedThread } from './reviewThreads';

export interface FileBodyProps {
  file: ReviewFile;
  /** How this file is being compared. Already resolved against what it offers. */
  mode: string;
  /** Threads on this file that the diff cannot draw. */
  unanchored: readonly ListedThread[];
  /**
   * Comments in flight on this file whose line the diff cannot draw either.
   *
   * The rare half of an optimistic post: the reviewer changed what is on
   * screen while one was in the air, or while a failed one was still waiting
   * to be dealt with. The entry holds writing that is on GitHub nowhere, so
   * losing it off the bottom of a hunk is the worst outcome available — this
   * is the same safety net `UnanchoredThreads` is, for the same reason.
   */
  posting: readonly PostingComment[];
  /** The two commits a rich comparison reads whole files from. */
  blobs: BlobRefs | null;
  /**
   * Whether this diff's line numbers are the pull request's own.
   *
   * Carried through to `RichCompare`, which is where it decides something: a
   * rendered Markdown block can be commented on, and under a narrowed scope the
   * line it names belongs to a different compare. See the prop there.
   */
  anchorable: boolean;
}

export function FileBody({
  file,
  mode,
  unanchored,
  posting,
  blobs,
  anchorable,
}: FileBodyProps) {
  const body = fileBody(file);
  const raw = mode === RAW.id;

  /**
   * What the rendered Markdown view had a line for and no block for.
   *
   * Held here rather than decided here, because only the view that drew the
   * blocks knows which source lines they covered — and reported upward rather
   * than listed down there, because a card has one drawer and this is where it
   * is. `MarkdownCompare` has the argument for why such a comment exists at
   * all; the short version is that its line is inside a hunk, so it is made an
   * annotation, and a rich card is handed a diff with no rows to hang one on.
   *
   * State rather than a ref: the list has to be on screen, and the report
   * arrives from an effect one render after the document settles. It clears
   * itself when that view goes away, which is what keeps the drawer from
   * listing comments the raw diff has just put back on their own rows.
   */
  const [unplaced, setUnplaced] = useState<UnplacedComments>(NOTHING_UNPLACED);
  // Stable, because the callback travels into an effect's dependencies: a
  // fresh function each render would clear and refill the list on every render
  // of the card, which is a loop rather than an inefficiency.
  const report = useCallback((next: UnplacedComments) => setUnplaced(next), []);

  /**
   * The two lists as the drawer and the strip above it will show them.
   *
   * The filters are not tidiness. `layoutThreads` has one verdict this view
   * cannot see — `whitespace-only`, about a patch this page recomputed — and a
   * thread carrying it can also arrive here as unplaced, so without the guard
   * the same comment is listed twice under two sentences that contradict each
   * other. Listing it once, under the verdict that already has a reason and a
   * remedy, is the honest half of the pair.
   */
  const listed = useMemo(() => {
    if (unplaced.threads.length === 0) return unanchored;
    const already = new Set(unanchored.map((entry) => entry.thread.id));
    return [
      ...unanchored,
      ...unplaced.threads
        .filter((thread) => !already.has(thread.id))
        .map((thread): ListedThread => ({ thread, reason: 'no-block' })),
    ];
  }, [unanchored, unplaced]);

  const stranded = useMemo(() => {
    if (unplaced.posting.length === 0) return posting;
    const already = new Set(posting.map((entry) => entry.id));
    return [...posting, ...unplaced.posting.filter((entry) => !already.has(entry.id))];
  }, [posting, unplaced]);

  return (
    <div className="file-body" data-file-body={file.path}>
      {/* The sentence explaining an absent diff belongs to the raw view alone.
          Left on, a PNG in its side-by-side comparison would carry "Binary
          file changed. There is no text diff to show" directly above the two
          images that are showing it. */}
      {raw && body.message !== null && (
        <p className="file-note" role="note">
          {body.message}
        </p>
      )}

      <RichCompare
        file={file}
        mode={mode}
        refs={blobs}
        anchorable={anchorable}
        onUnplaced={report}
      />

      {stranded.length > 0 && (
        <ul className="unplaceable-posting" data-unplaceable-posting={file.path}>
          {stranded.map((entry) => (
            <li key={entry.id}>
              <p className="unanchored-reason">
                {/* A file comment is not stranded here, it lives here: this is
                    where its thread will land once GitHub answers, beside the
                    file-level threads `UnanchoredThreads` lists below. So it
                    borrows that list's sentence rather than the apology, which
                    would tell the reviewer something had gone wrong. */}
                {entry.anchor.subject === 'file'
                  ? 'Left on the file as a whole rather than on a line.'
                  : `This comment was written on line ${entry.anchor.line}, which the ` +
                    'diff on screen is not showing. It is here so it is not lost.'}
              </p>
              <PostingCard postId={entry.id} />
            </li>
          ))}
        </ul>
      )}

      <UnanchoredThreads path={file.path} threads={listed} />
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
 *
 * The whitespace caveat is not one of the conditions, since it moved onto the
 * header: with the setting on for the whole pull request, that used to mean
 * every text file in it grew an annotation, which is precisely the strip of
 * chrome this predicate exists to avoid.
 *
 * A comment in flight that could not be anchored is the second condition, and
 * it is the one that must never be forgotten: without it the body is left off
 * the card entirely and the entry is drawn nowhere at all.
 */
export function hasBodyContent(
  unanchored: readonly ListedThread[],
  posting: readonly PostingComment[] = [],
): boolean {
  return unanchored.length > 0 || posting.length > 0;
}
