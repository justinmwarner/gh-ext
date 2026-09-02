/**
 * Searching the review, over the patch text the page already has.
 *
 * Two searches, one mechanism. `searchDiff` looks inside the diff — file paths
 * and changed lines — and `filterPaths` looks at the file list. Both are plain
 * case-insensitive substring matches that report *where* they matched, so the
 * two surfaces highlight the same way and a reviewer only has to learn one
 * behaviour.
 *
 * Nothing here is fetched, and nothing is asked of GitHub. The whole diff is
 * already in the page, so the answer is local and instant.
 *
 * The rule that shapes the parser: **only changed lines match.** A hit on a
 * context line sends the reviewer to a line nobody touched, which is precisely
 * what searching a diff rather than a file is meant to avoid. And a line is
 * changed by *position* — inside a hunk body — not by its first character:
 * `--- a/x` is a header that starts with a dash, and a removed `---` from a
 * YAML file is an ordinary deletion. Only tracking the hunk tells them apart.
 */

export interface SearchableFile {
  path: string;
  /** Raw unified-diff text for this file, header included. May be empty. */
  patch: string;
}

export type DiffMatchKind = 'path' | 'addition' | 'deletion';

/** Which side of the diff a line lives on, spelled the way Pierre spells it. */
export type MatchSide = 'additions' | 'deletions';

export interface DiffMatch {
  path: string;
  kind: DiffMatchKind;
  /** The line number on its own side. Null for a match on the path itself. */
  line: number | null;
  side: MatchSide | null;
  /** What matched: the path, or the changed line without its +/- marker. */
  text: string;
  /** Where the query begins in `text`, so the caller can highlight it. */
  start: number;
  /** One past where it ends. */
  end: number;
}

export interface SearchOptions {
  /**
   * How many matches to return.
   *
   * A one-letter query against a large pull request matches tens of thousands
   * of lines, and a jump list nobody can read is not a better answer than a
   * truncated one.
   */
  limit?: number;
}

const DEFAULT_LIMIT = 200;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** One changed line, as the walk sees it. */
interface ChangedLine {
  kind: 'addition' | 'deletion';
  side: MatchSide;
  line: number;
  text: string;
}

/**
 * Every changed line in one file's patch, numbered on its own side.
 *
 * Exported because the search is not the only thing that wants "which lines did
 * this patch actually change" — but it is the only caller today.
 */
export function changedLines(patch: string): ChangedLine[] {
  if (patch === '') return [];

  const found: ChangedLine[] = [];
  let inHunk = false;
  let additionLine = 0;
  let deletionLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header !== null) {
      deletionLine = Number(header[1]);
      additionLine = Number(header[2]);
      inHunk = true;
      continue;
    }

    // A combined diff carries several files; a `ReviewFile` patch carries one.
    // Resetting on the header costs nothing and makes this correct for both.
    if (raw.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }

    if (!inHunk) continue;

    const marker = raw[0];
    if (marker === '+') {
      found.push({
        kind: 'addition',
        side: 'additions',
        line: additionLine,
        text: raw.slice(1),
      });
      additionLine += 1;
    } else if (marker === '-') {
      found.push({
        kind: 'deletion',
        side: 'deletions',
        line: deletionLine,
        text: raw.slice(1),
      });
      deletionLine += 1;
    } else if (marker === ' ' || raw === '') {
      // Context: rendered, and a valid comment target, but not a change.
      additionLine += 1;
      deletionLine += 1;
    } else if (marker === '\\') {
      // "\ No newline at end of file" annotates the line above it and occupies
      // no line of its own on either side.
      continue;
    } else {
      // Anything else has left the hunk body behind.
      inHunk = false;
    }
  }

  return found;
}

/** Where `needle` sits in `haystack`, both folded, or null. */
function locate(haystack: string, needle: string): { start: number; end: number } | null {
  const at = haystack.toLowerCase().indexOf(needle);
  return at === -1 ? null : { start: at, end: at + needle.length };
}

/**
 * Everything in the diff that matches, in the order the files were given.
 *
 * File order is the column's order, which is the order the reviewer reads in,
 * so the jump list runs top to bottom alongside the diff. Within a file the
 * path match comes first, then its changed lines in patch order.
 */
export function searchDiff(
  files: readonly SearchableFile[],
  query: string,
  options: SearchOptions = {},
): DiffMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const limit = options.limit ?? DEFAULT_LIMIT;
  const matches: DiffMatch[] = [];

  for (const file of files) {
    if (matches.length >= limit) return matches;

    const inPath = locate(file.path, needle);
    if (inPath !== null) {
      matches.push({
        path: file.path,
        kind: 'path',
        line: null,
        side: null,
        text: file.path,
        ...inPath,
      });
    }

    for (const changed of changedLines(file.patch)) {
      if (matches.length >= limit) return matches;
      const inLine = locate(changed.text, needle);
      if (inLine === null) continue;
      matches.push({
        path: file.path,
        kind: changed.kind,
        line: changed.line,
        side: changed.side,
        text: changed.text,
        ...inLine,
      });
    }
  }

  return matches;
}

export interface PathMatch {
  path: string;
  /** Where the query begins in `path`. Zero for an empty query. */
  start: number;
  end: number;
}

/** The part after the last slash — what the reviewer thinks of as the file. */
const baseNameStart = (path: string): number => path.lastIndexOf('/') + 1;

/**
 * The file list, narrowed to what the reviewer typed.
 *
 * An empty query is not "no matches" — it is the unfiltered list, because the
 * jump opens before anything has been typed and an empty panel would look
 * broken.
 *
 * A hit in the file name outranks one in a directory: typing "app" almost
 * always means the file called app, not everything under `app/`. Ties break on
 * where the match starts and then on path length, so the shortest, earliest
 * match is first — which is the one the reviewer meant often enough to be worth
 * the rule.
 */
export function filterPaths(
  paths: readonly string[],
  query: string,
  options: SearchOptions = {},
): PathMatch[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const needle = query.trim().toLowerCase();

  if (needle === '') {
    return paths.slice(0, limit).map((path) => ({ path, start: 0, end: 0 }));
  }

  const ranked: { match: PathMatch; inName: boolean; order: number }[] = [];

  for (const [order, path] of paths.entries()) {
    const at = locate(path, needle);
    if (at === null) continue;
    ranked.push({
      match: { path, ...at },
      inName: at.start >= baseNameStart(path),
      order,
    });
  }

  ranked.sort((a, b) => {
    if (a.inName !== b.inName) return a.inName ? -1 : 1;
    if (a.match.start !== b.match.start) return a.match.start - b.match.start;
    if (a.match.path.length !== b.match.path.length) {
      return a.match.path.length - b.match.path.length;
    }
    // Stable on the column's own order, so equal candidates read top to bottom.
    return a.order - b.order;
  });

  return ranked.slice(0, limit).map(({ match }) => match);
}
