/**
 * What an arrow key means in a tree, decided without touching one.
 *
 * Two trees on this page walk the same rows with the same keys: the file tree,
 * which is a checklist, and the find panel's results, which are not. What they
 * share is the *navigation* — six keys, four of which are obvious and two of
 * which are not. Left is the awkward one: on an open directory it shuts it, on
 * a shut one it walks to the parent, and on a file it walks to the parent too,
 * which is three rules wearing one key and exactly the sort of thing that
 * drifts when it is copied.
 *
 * `Enter` and `Space` are deliberately *not* here. In a checklist Space ticks a
 * file viewed and Enter selects; in a result list Space does nothing and Enter
 * sends the reviewer to a line. Those are different products of the same
 * keystroke, so each tree answers them itself.
 *
 * Pure, and structural rather than typed to `TreeRow`: the result rows carry a
 * match on them and the file rows carry a viewed state, and neither is any of
 * this function's business.
 */

/** As much of a row as the keyboard reads. */
export interface KeyRow {
  /** Directory paths end in `/`; file paths do not. Same spelling as `treeRows`. */
  path: string;
  depth: number;
  kind: 'file' | 'directory';
  /** Directories only; a file is never expanded. */
  expanded: boolean;
}

/** Move the focus, or fold something. Never both, and often neither. */
export type TreeKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'fold'; path: string; shut: boolean };

/** The directory a path sits in, or null at the top level. */
function parentOf(path: string): string | null {
  const body = path.endsWith('/') ? path.slice(0, -1) : path;
  const cut = body.lastIndexOf('/');
  return cut === -1 ? null : body.slice(0, cut + 1);
}

/** A move to `index`, or nothing when there is no row there. */
const moveTo = (rows: readonly KeyRow[], index: number): TreeKeyAction | null =>
  rows[index] === undefined ? null : { kind: 'move', index };

/**
 * One keystroke against a flat row list, resolved.
 *
 * Returns null for a key this does not claim, which is what tells the caller to
 * leave the event alone rather than prevent it.
 *
 * Nothing wraps. A tree is a place rather than a carousel, and walking off the
 * bottom of four hundred files to land back at the top loses the reviewer where
 * they were.
 */
export function resolveTreeKey(
  rows: readonly KeyRow[],
  index: number,
  key: string,
): TreeKeyAction | null {
  const row = rows[index];
  if (row === undefined) return null;

  switch (key) {
    case 'ArrowDown':
      return moveTo(rows, index + 1);
    case 'ArrowUp':
      return moveTo(rows, index - 1);
    case 'Home':
      return moveTo(rows, 0);
    case 'End':
      return moveTo(rows, rows.length - 1);
    case 'ArrowRight':
      if (row.kind !== 'directory') return null;
      // Open it, or — if it is already open — step into what it holds, which
      // is the next row by construction.
      return row.expanded ? moveTo(rows, index + 1) : { kind: 'fold', path: row.path, shut: false };
    case 'ArrowLeft': {
      if (row.kind === 'directory' && row.expanded) {
        return { kind: 'fold', path: row.path, shut: true };
      }
      const parent = parentOf(row.path);
      if (parent === null) return null;
      const at = rows.findIndex((candidate) => candidate.path === parent);
      return at === -1 ? null : { kind: 'move', index: at };
    }
    default:
      return null;
  }
}
