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

/**
 * Alphabetical, but counting the way a person does: `file9` before `file10`.
 * A plain codepoint sort puts every `1x` ahead of `2`, which reads as broken
 * in any directory that numbers its files.
 */
const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function treeRows(
  paths: readonly string[],
  collapsed: ReadonlySet<string>,
): TreeRow[] {
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

  walk(root, '', 0, false);
  return rows;
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
