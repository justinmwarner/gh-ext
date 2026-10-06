/**
 * The order a review is read in, when it is not folder order.
 *
 * Folder order is `ui/treeRows.ts`'s, and it is still the default: a review
 * opens laid out the way the repository is until the reviewer chooses another
 * order, and then every review after opens in theirs (`ARRANGEMENT_KEY` in
 * `lib/settings.ts` says why the order is kept when the filters are not). A
 * reviewer can change it in two ways, separately or together.
 *
 * - **Most changed first.** For a pull request that is mostly small edits.
 *   Moving a directory, for example, leaves dozens of `+1 −1` import fixes
 *   around the handful of files that changed for real. Sorted by size, the
 *   real changes come first and the one-line edits gather at the end, still
 *   there to tick off but no longer in the way.
 * - **Types read last.** For the files a team reads after the code, or not
 *   closely: specs, snapshots, images. Sent to the end in groups, in the order
 *   they were sent, rather than hidden.
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

import { typeMatches } from './fileFilters';

/** Which of the two orders the review is in. */
export type ReadingOrder = 'folders' | 'changes';

/**
 * How the review is laid out: an order, and the file types sent to the end.
 *
 * `last` is in the order the types were sent there. The first one sent comes
 * first after the rest of the review, and the last one ends it. The types are
 * the filter menu's own (`fileType`, or a longer `compoundType`), so reading
 * the specs last and hiding them speak the same language.
 */
export interface Arrangement {
  sort: ReadingOrder;
  last: readonly string[];
}

/**
 * Folder order, nothing sent to the end: how a review opens until the reviewer
 * picks another.
 */
export const AS_IS: Arrangement = Object.freeze({ sort: 'folders', last: [] });

/**
 * Whether two arrangements lay a review out alike.
 *
 * A remembered arrangement comes back from storage as a new object every time
 * it is written, the page's own write included. Handing the review a new
 * object that says the same thing would lay every surface out again for
 * nothing, so only a real change gets through.
 */
export function sameArrangement(a: Arrangement, b: Arrangement): boolean {
  return (
    a.sort === b.sort &&
    a.last.length === b.last.length &&
    a.last.every((type, n) => type === b.last[n])
  );
}

/** The files of one type read last, in reading order. */
export interface LastGroup<T> {
  type: string;
  files: readonly T[];
}

export interface Arranged<T> {
  /** Every file, in the order the review is read: the rest, then each group. */
  files: readonly T[];
  /** The groups at the end, in the order they are read. Empty ones left out. */
  groups: readonly LastGroup<T>[];
}

/**
 * The review in reading order, and the groups sent to its end.
 *
 * The rest of the review comes first, in the chosen order, then each type read
 * last as a group, each also in the chosen order. A file goes in the group of
 * the most recent type it matches. Sending `.tsx` to the end after `.spec.tsx`
 * takes the specs along with it, because that is what was just asked for.
 *
 * The list it was handed comes back as the same list when nothing moves, so a
 * caller that keys anything on identity sees no change.
 */
export function arrange<T extends CountedFile>(
  files: readonly T[],
  arrangement: Arrangement,
): Arranged<T> {
  const sorted = arrangement.sort === 'changes' ? mostChangedFirst(files) : files;
  if (arrangement.last.length === 0) return { files: sorted, groups: [] };

  const rest: T[] = [];
  const grouped = arrangement.last.map((type): { type: string; files: T[] } => ({
    type,
    files: [],
  }));
  for (const file of sorted) {
    let home: { type: string; files: T[] } | undefined;
    for (const group of grouped) {
      if (typeMatches(file.path, group.type)) home = group;
    }
    if (home === undefined) rest.push(file);
    else home.files.push(file);
  }

  const groups = grouped.filter((group) => group.files.length > 0);
  if (groups.length === 0) return { files: sorted, groups: [] };
  return { files: [...rest, ...groups.flatMap((group) => group.files)], groups };
}

/** A file as far as its size goes. `ReviewFile` satisfies it. */
export interface CountedFile {
  path: string;
  additions: number;
  deletions: number;
  /**
   * A lockfile, a vendored or built tree, generated output: the files the tree
   * dims. `ReviewFile.noise`, from a fixed list of paths, so it is known for
   * every file without asking the repository anything.
   */
  noise?: boolean;
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
 * Most changed first, with generated files after everything else.
 *
 * Stable, and that is half the rule. Files of the same size keep the order
 * they were handed in, which is folder order everywhere this is called, so a
 * run of `+1 −1` import fixes stays grouped by directory rather than shuffled.
 *
 * A file with nothing to count, such as an image, a pure move or a change of
 * mode, has a size of zero and so sinks to the end. That is a fact about
 * what can be measured, not a judgement that it does not matter: it is still
 * in the review, last.
 *
 * Generated files go after all of that, biggest first among themselves. By
 * size alone a regenerated lockfile would lead the review, and it is the one
 * file this order exists to get past. They are still in the review.
 */
export function mostChangedFirst<T extends CountedFile>(files: readonly T[]): T[] {
  const written = (file: CountedFile): number => (file.noise === true ? 1 : 0);
  return [...files].sort(
    (a, b) => written(a) - written(b) || changedLines(b) - changedLines(a),
  );
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
