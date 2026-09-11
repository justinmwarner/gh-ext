/**
 * Comments that have been written and are on their way to GitHub.
 *
 * The review page posts optimistically: the composer closes the moment the
 * reviewer presses the button, and what they wrote appears on the line
 * straight away. Publishing a single comment is three round trips and
 * sometimes four, so waiting for them meant the box sat on "Posting…" for a
 * second or more — and because the thread arrives from the *second* of those
 * trips, the line held the finished comment and the open composer at the same
 * time, showing the same words twice.
 *
 * This is the record that makes the optimistic half safe. Every entry is
 * writing that exists nowhere on GitHub yet, so the two rules are:
 *
 * - **An entry is only ever removed by something that replaced it.** The real
 *   thread landing, or the reviewer deciding to throw it away. A post that
 *   fails keeps its entry, with the reason on it, because the entry is now the
 *   only copy of the comment on screen.
 * - **Nothing is edited in place.** Every function returns a new array, or the
 *   one it was given when there was nothing to do. The array reaches Pierre as
 *   annotation input, where a fresh array for an unchanged file is a whole
 *   card re-rendered.
 *
 * Pure, like the rest of `lib/`: the session owns the requests, this owns what
 * is on screen while they are in flight.
 */

import type { CommentAnchor } from './selection';

/** What a comment needs to be posted, and to be shown before it has been. */
export interface PostingInput {
  path: string;
  body: string;
  anchor: CommentAnchor;
}

export interface PostingComment extends PostingInput {
  /**
   * This session's own id, not GitHub's.
   *
   * GitHub has not seen the comment yet and has no name for it. The id exists
   * so a retry, a discard and the annotation metadata can all mean the same
   * entry — and so the metadata object survives the entry changing, which is
   * what stops Pierre rebuilding the row when a post fails.
   */
  id: string;
  /** Why it did not go out, or null while it is still in flight. */
  error: string | null;
}

/**
 * Ids for entries that only exist on this page.
 *
 * A counter rather than anything derived from the comment: two identical
 * comments on the same line are a thing a reviewer may legitimately do — the
 * second is usually a retry they gave up waiting on — and they have to be two
 * entries.
 */
let counter = 0;

export function nextPostId(): string {
  counter += 1;
  return `posting:${counter}`;
}

/** Add one comment in flight. */
export function beginPost(
  list: readonly PostingComment[],
  id: string,
  input: PostingInput,
): readonly PostingComment[] {
  return [...list, { ...input, id, error: null }];
}

/**
 * Record why a post failed, keeping the comment itself.
 *
 * The words are the point. Dropping the entry here would throw away the only
 * copy of them on screen, which is the failure this whole module exists to
 * avoid — see principle 4 in `PRODUCT.md`.
 */
export function failPost(
  list: readonly PostingComment[],
  id: string,
  message: string,
): readonly PostingComment[] {
  if (!list.some((entry) => entry.id === id)) return list;
  return list.map((entry) => (entry.id === id ? { ...entry, error: message } : entry));
}

/**
 * Put a failed entry back in flight.
 *
 * The error is cleared rather than left beside a spinner: a message saying the
 * post failed, on a comment that is being posted right now, is the previous
 * attempt described in the present tense.
 */
export function retryPost(
  list: readonly PostingComment[],
  id: string,
): readonly PostingComment[] {
  const found = list.find((entry) => entry.id === id);
  if (found === undefined || found.error === null) return list;
  return list.map((entry) => (entry.id === id ? { ...entry, error: null } : entry));
}

/** Forget one entry: the real thread arrived, or the reviewer discarded it. */
export function dropPost(
  list: readonly PostingComment[],
  id: string,
): readonly PostingComment[] {
  if (!list.some((entry) => entry.id === id)) return list;
  return list.filter((entry) => entry.id !== id);
}

/** The entries on one file, in the order they were written. */
export function postsOnPath(
  list: readonly PostingComment[],
  path: string,
): readonly PostingComment[] {
  return list.filter((entry) => entry.path === path);
}
