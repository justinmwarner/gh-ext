/**
 * The order a review is read in, when it is not folder order.
 *
 * Folder order is `ui/treeRows.ts`'s, and it is still the default: a review
 * opens laid out the way the repository is. This is the other one a reviewer
 * can ask for: most changed first. It is for a pull request that is mostly
 * small edits. Moving a directory, for example, leaves dozens of `+1 −1`
 * import fixes around the handful of files that changed for real. Sorted by
 * size, the real changes come first and the one-line edits gather at the end,
 * still there to tick off but no longer in the way.
 *
 * One rule decides the order, and every surface takes it from the shell: the
 * diff column, the tree, `j`/`k`, `n`/`p`, the Conversations list and the find
 * panel. Most surfaces are simply handed the list already sorted. Two cannot
 * be. The column keys its viewer on the identity of its file list, so a sorted
 * copy would rebuild the viewer and lose the reviewer's place. The find panel
 * walks every patch once against its list, so a sorted copy would walk them
 * all again. Those two are handed a rank instead, and lay their own list out by
 * it through {@link inReadingOrder}: they follow the shell's order rather than
 * deciding one.
 *
 * Pure by contract: no DOM, no `chrome.*`, no transport.
 */

/** Which of the two orders the review is in. Never stored, like the filters. */
export type ReadingOrder = 'folders' | 'changes';

/** A file as far as its size goes. `ReviewFile` satisfies it. */
export interface CountedFile {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * How much of a file changed: lines added plus lines removed.
 *
 * The same two figures the file's row shows as `+N −M`, so the order can be
 * checked by eye. A deleted file counts by what it removed, so deleting a
 * large file puts it near the top, which is right: it is a decision someone
 * should look at. A reviewer who disagrees can untick "Deleted".
 */
export function changedLines(file: CountedFile): number {
  return file.additions + file.deletions;
}

/**
 * Most changed first.
 *
 * Stable, and that is half the rule. Files of the same size keep the order
 * they were handed in, which is folder order everywhere this is called, so a
 * run of `+1 −1` import fixes stays grouped by directory rather than shuffled.
 *
 * A file with nothing to count, such as an image, a pure move or a change of
 * mode, has a size of zero and so sinks to the end. That is a fact about
 * what can be measured, not a judgement that it does not matter: it is still
 * in the review, last.
 */
export function mostChangedFirst<T extends CountedFile>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => changedLines(b) - changedLines(a));
}

/** Each path's place in a list, for a surface that lays out its own list by it. */
export function rankOf(files: readonly { path: string }[]): Map<string, number> {
  return new Map(files.map((file, at) => [file.path, at]));
}

/**
 * A list laid out by a rank from elsewhere, or left exactly as it is.
 *
 * The same list, not a copy, when there is no rank. The diff column depends on
 * that: anything it would rebuild on a new identity is spared a rebuild while
 * the review is in folder order. A path the rank does not know goes last
 * rather than first, because the honest place for a file nobody placed is at
 * the end, not the first thing the reviewer sees. It is the rule
 * `reviewFiles` follows for the same case.
 */
export function inReadingOrder<T extends { path: string }>(
  items: readonly T[],
  rank: ReadonlyMap<string, number> | null,
): readonly T[] {
  if (rank === null) return items;
  const place = (item: T): number => rank.get(item.path) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => place(a) - place(b));
}
