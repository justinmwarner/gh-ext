/**
 * A list of matches, as the rows a result tree draws.
 *
 * The find panel's answer to what `treeRows` is for the file tree — and built
 * *on* it rather than beside it, which is the whole point. CLAUDE.md records
 * why: the rail and the diff column once disagreed about where a root-level
 * `README.md` sat, and the fix was to give one walk authority over the order.
 * A second tree that sorted its own files would put that bug back somewhere
 * new, so this one asks `treeRows` for the shape and only splices matches into
 * what comes out.
 *
 * Three row kinds rather than two. A `match` is a line inside a file, and it is
 * a row rather than a decoration on the file row because a file with nine hits
 * is nine places the reviewer can be sent — and because stepping through them
 * with the arrow keys is the thing the panel exists to do.
 *
 * A hit on a *path* is deliberately not a match row. The file row is already
 * that destination, so a child repeating the path underneath it would be the
 * same place listed twice; it becomes `nameMatch` on the file row instead, which
 * is what lets the name be drawn with its hit picked out.
 *
 * Pure, and no DOM: what a row looks like is `SearchTree`'s business.
 */

import type { DiffMatch, Span } from '@/lib/review/search';
import { treeRows } from './treeRows';

/** One drawable row. Directory paths end in `/`; file paths do not. */
export type SearchRow =
  | {
      kind: 'directory';
      path: string;
      /** The last segment, which is what the row shows. */
      name: string;
      depth: number;
      expanded: boolean;
      /** Every match at or under this row, counted through collapsed ones. */
      matches: number;
      /** Unique and stable across a redraw, for React. */
      key: string;
    }
  | {
      kind: 'file';
      path: string;
      name: string;
      depth: number;
      expanded: boolean;
      matches: number;
      key: string;
      /** Where the query hit the path, when it did. Null when it did not. */
      nameMatch: Span | null;
    }
  | {
      kind: 'match';
      /** The file this line belongs to, not a path of its own. */
      path: string;
      depth: number;
      key: string;
      match: DiffMatch;
    };

/** Everything a file row needs that is not in `treeRows`' answer. */
interface FileMatches {
  /** The line hits, in the order the search reported them. */
  lines: DiffMatch[];
  /** Where the query hit the path, if it did. */
  nameMatch: Span | null;
  /** Line hits plus one for a name hit — what the row says it holds. */
  total: number;
}

/**
 * Matches grouped by file, in first-seen order.
 *
 * Insertion order is not the draw order and does not have to be: `treeRows`
 * decides where the files go. What this preserves is the order of the lines
 * *within* a file, which is patch order, which is the order the reviewer reads
 * that file in.
 */
function byFile(matches: readonly DiffMatch[]): Map<string, FileMatches> {
  const grouped = new Map<string, FileMatches>();

  for (const match of matches) {
    let file = grouped.get(match.path);
    if (file === undefined) {
      file = { lines: [], nameMatch: null, total: 0 };
      grouped.set(match.path, file);
    }

    file.total += 1;
    if (match.kind === 'path') file.nameMatch = { start: match.start, end: match.end };
    else file.lines.push(match);
  }

  return grouped;
}

/**
 * The rows a result tree draws, flat and already in draw order.
 *
 * `collapsed` holds both folded directories and folded *files* — a file with
 * two hundred hits is as worth shutting as a directory — which is why the set
 * is keyed by path and the two kinds share it. A collapsed row keeps its count:
 * hiding the matches must not make the number disagree with them, or the panel
 * reads as broken rather than as folded.
 */
export function searchRows(
  matches: readonly DiffMatch[],
  collapsed: ReadonlySet<string>,
): SearchRow[] {
  const grouped = byFile(matches);
  if (grouped.size === 0) return [];

  // The structure, from the one walk that is allowed to decide it. Directories
  // are folded here; files are folded below, because `treeRows` has no notion
  // of a file with children.
  const structure = treeRows([...grouped.keys()], collapsed);
  const rows: SearchRow[] = [];

  for (const row of structure) {
    if (row.kind === 'directory') {
      let held = 0;
      for (const path of row.files) held += grouped.get(path)?.total ?? 0;
      rows.push({
        kind: 'directory',
        path: row.path,
        name: row.name,
        depth: row.depth,
        expanded: row.expanded,
        matches: held,
        key: row.path,
      });
      continue;
    }

    const file = grouped.get(row.path);
    if (file === undefined) continue;

    const expanded = !collapsed.has(row.path);
    rows.push({
      kind: 'file',
      path: row.path,
      name: row.name,
      depth: row.depth,
      expanded,
      matches: file.total,
      key: row.path,
      nameMatch: file.nameMatch,
    });

    if (!expanded) continue;

    for (const [at, match] of file.lines.entries()) {
      rows.push({
        kind: 'match',
        path: row.path,
        depth: row.depth + 1,
        // The index is in the key because two hits on one line are two rows
        // with the same path, line and side, and React needs to tell them
        // apart. `start` alone would do it today; the index cannot be wrong.
        key: `${row.path}:${match.line ?? 'path'}:${match.start}:${at}`,
        match,
      });
    }
  }

  return rows;
}
