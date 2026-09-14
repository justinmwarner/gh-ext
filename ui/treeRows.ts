/**
 * A list of changed paths, as the rows a tree draws.
 *
 * Everything about *what* the tree shows is decided here — the nesting, the
 * order, what a collapsed directory hides, and which files a folder's checkbox
 * acts on. None of it needs a DOM, so none of it is in the component.
 *
 * The rows come out flat, already in draw order, with the depth each one sits
 * at. A flat list is what a tree wants anyway: it is what the keyboard steps
 * through, and it is what lets the browser skip the rows that are off screen.
 */

import type { FileViewedState } from '@/lib/github/types';

/**
 * What a row's checkbox shows.
 *
 * `mixed` carries two different truths, and both of them want the same
 * drawing. On a folder it means some of its files are viewed and some are
 * not. On a file it means DISMISSED — the reviewer marked it and it changed
 * underneath them, so they have not seen this version but they did look. A
 * plain empty box would lose that they ever looked; a tick would claim they
 * had seen the current one.
 */
export type CheckState = 'checked' | 'unchecked' | 'mixed';

/** One drawable row. Directory paths end in `/`; file paths do not. */
export interface TreeRow {
  path: string;
  /** The last segment, which is what the row actually shows. */
  name: string;
  depth: number;
  kind: 'file' | 'directory';
  /** Directories only; a file is never expanded. */
  expanded: boolean;
  /**
   * Every file at or under this row, in draw order.
   *
   * What a folder's checkbox acts on, and what decides whether it reads as
   * ticked, empty or partial. Counted through collapsed directories too —
   * ticking a folder shut is still ticking every file in it.
   */
  files: readonly string[];
}

interface Node {
  name: string;
  /** Child directories, keyed by name. */
  dirs: Map<string, Node>;
  /** Leaf file names at this level. */
  files: string[];
}

const node = (name: string): Node => ({ name, dirs: new Map(), files: [] });

/** No folds, shared so a repeated call does not allocate one per file list. */
const NOTHING_FOLDED: ReadonlySet<string> = new Set();

/**
 * Alphabetical, but counting the way a person does: `file9` before `file10`.
 * A plain codepoint sort puts every `1x` ahead of `2`, which reads as broken
 * in any directory that numbers its files.
 */
const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * One walk, both answers.
 *
 * The rows a tree draws and the sequence its files run in are the same fact
 * seen twice, and they used to be worked out in two places — here, and not at
 * all in the diff column, which simply drew the order GitHub's diff arrived
 * in. That is the bug this shape exists to make impossible: a root-level
 * `README.md` came first in the column and last in the tree, because
 * folders-first is this walk's rule and GitHub's list has never heard of it.
 *
 * So the walk returns its `beneath` rather than discarding it. {@link treeRows}
 * takes the rows, {@link fileOrder} takes the files, and neither can drift from
 * the other without this function moving underneath both.
 */
function walkTree(
  paths: readonly string[],
  collapsed: ReadonlySet<string>,
): { rows: TreeRow[]; files: string[] } {
  const root = node('');

  for (const path of paths) {
    const segments = path.split('/').filter((segment) => segment !== '');
    const file = segments.pop();
    if (file === undefined) continue;

    let at = root;
    for (const segment of segments) {
      let next = at.dirs.get(segment);
      if (next === undefined) {
        next = node(segment);
        at.dirs.set(segment, next);
      }
      at = next;
    }
    at.files.push(file);
  }

  const rows: TreeRow[] = [];

  /**
   * Walk one directory, appending its rows.
   *
   * Returns every file beneath it so a parent can carry its descendants
   * without a second pass. `hidden` is threaded down rather than checked at
   * the top: a collapsed directory still has to be *walked*, because its files
   * belong to its own checkbox and to every checkbox above it.
   */
  const walk = (at: Node, prefix: string, depth: number, hidden: boolean): string[] => {
    const beneath: string[] = [];

    for (const name of [...at.dirs.keys()].sort(byName)) {
      const child = at.dirs.get(name);
      if (child === undefined) continue;

      const path = `${prefix}${name}/`;
      const expanded = !collapsed.has(path);
      // Claimed before the walk so the row sits above its children, and filled
      // in after, because `files` is what the walk returns.
      const row: TreeRow = { path, name, depth, kind: 'directory', expanded, files: [] };
      if (!hidden) rows.push(row);

      const under = walk(child, path, depth + 1, hidden || !expanded);
      row.files = under;
      beneath.push(...under);
    }

    for (const name of [...at.files].sort(byName)) {
      const path = `${prefix}${name}`;
      if (!hidden) {
        rows.push({ path, name, depth, kind: 'file', expanded: false, files: [] });
      }
      beneath.push(path);
    }

    return beneath;
  };

  const files = walk(root, '', 0, false);
  return { rows, files };
}

/** The rows a tree draws, flat and already in draw order. */
export function treeRows(
  paths: readonly string[],
  collapsed: ReadonlySet<string>,
): TreeRow[] {
  return walkTree(paths, collapsed).rows;
}

/**
 * Every changed file, in the order the tree lays them out.
 *
 * What the diff column, `j`/`k` and the thread list all read, so that the
 * checklist on the left and the reading order on the right are one sequence
 * rather than two. Folding is not part of it: the column draws every file
 * whatever the reviewer has shut, so this walks with nothing collapsed.
 */
export function fileOrder(paths: readonly string[]): string[] {
  return walkTree(paths, NOTHING_FOLDED).files;
}

/**
 * Every directory a list of paths implies, including the ones in between.
 *
 * What "start the tree shut" needs, and it is here rather than in the component
 * because the answer has to be spelled the way {@link treeRows} spells it —
 * segment names joined with a trailing slash, empty segments dropped. A set
 * built any other way would name directories the rows do not have, and the
 * tree would open with folders that could not be closed and closed ones that
 * could not be opened.
 *
 * Intermediate directories are in it too. `src/` as well as `src/review/`, so
 * a deep tree collapses to its top level rather than to a spine of single
 * children the reviewer has to walk down.
 */
export function directoryPaths(paths: readonly string[]): Set<string> {
  const directories = new Set<string>();

  for (const path of paths) {
    const segments = path.split('/').filter((segment) => segment !== '');
    // The file name. Dropped rather than read: a path with nothing but a file
    // name in it implies no directory at all.
    segments.pop();

    let prefix = '';
    for (const segment of segments) {
      prefix += `${segment}/`;
      directories.add(prefix);
    }
  }

  return directories;
}

/**
 * Whether a row reads as viewed, not viewed, or partly.
 *
 * A folder is only ticked when every file beneath it is, and a DISMISSED file
 * counts against that: a folder cannot claim to be done on the strength of a
 * file the reviewer has been told to look at again.
 */
export function checkState(
  row: TreeRow,
  viewed: ReadonlyMap<string, FileViewedState>,
): CheckState {
  if (row.kind === 'file') {
    const state = viewed.get(row.path);
    if (state === 'VIEWED') return 'checked';
    if (state === 'DISMISSED') return 'mixed';
    return 'unchecked';
  }

  let done = 0;
  for (const path of row.files) {
    if (viewed.get(path) === 'VIEWED') done += 1;
  }

  if (row.files.length === 0 || done === 0) return 'unchecked';
  return done === row.files.length ? 'checked' : 'mixed';
}
