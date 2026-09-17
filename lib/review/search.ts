/**
 * Searching the review, over the patch text the page already has.
 *
 * Three surfaces, and they do not all want the same thing — which is the shape
 * of this file rather than an untidiness in it:
 *
 * - **The find panel** sweeps paths, changed lines *and* the context around
 *   them, through a query the reviewer can make case-sensitive, whole-word or a
 *   regular expression. `parseFiles` then `searchParsed`, because it re-searches
 *   on every keystroke and must not re-walk every patch to do it.
 * - **The diff search** (`searchDiff`) is the same sweep with context left out.
 *   A hit on a line nobody touched sends the reviewer somewhere the review is
 *   not, which is precisely what searching a *diff* rather than a file is for.
 * - **The file tree's filter and `Mod+K`** ask only `pathMatches` and
 *   `filterPaths`, which stay a lowercased `indexOf`: they re-run over every
 *   path on every keystroke, and the toggles are not theirs.
 *
 * With all three toggles off the compiled matcher and the `indexOf` agree
 * exactly, so a query that finds a file in one surface finds it in the others.
 * That is the property worth protecting; sharing an implementation is not.
 *
 * Nothing here is fetched, and nothing is asked of GitHub. The whole diff is
 * already in the page, so the answer is local and instant.
 *
 * The rule that shapes the parser: **a line is changed by *position*** — inside
 * a hunk body — not by its first character. `--- a/x` is a header that starts
 * with a dash, and a removed `---` from a YAML file is an ordinary deletion.
 * Only tracking the hunk tells them apart.
 */

export interface SearchableFile {
  path: string;
  /** Raw unified-diff text for this file, header included. May be empty. */
  patch: string;
}

/**
 * `context` is the find panel's alone.
 *
 * The diff search never produces one — `changedLines` is its rule and leaves
 * them out — but a result row has to be able to say that a hit is on a line
 * nobody touched, because that is the difference between somewhere the review
 * is and somewhere it merely passes through.
 */
export type DiffMatchKind = 'path' | 'addition' | 'deletion' | 'context';

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

/** What the find panel's three toggles ask for. Every one of them is off by default. */
export interface MatchOptions {
  /** `Needle` stops matching `needle`. */
  caseSensitive?: boolean;
  /** `cat` stops matching inside `concatenate`. */
  wholeWord?: boolean;
  /** Read the query as a pattern rather than as text. */
  regex?: boolean;
}

/** Where a hit sits in a string, half-open, so the caller can highlight it. */
export interface Span {
  start: number;
  end: number;
}

/**
 * A compiled query, or the reason it would not compile.
 *
 * A discriminated union rather than a throw, because the failure is a thing the
 * panel has to *draw*: a reviewer halfway through typing `(\w+` has an invalid
 * pattern and has done nothing wrong, and a box that empties itself without
 * saying why is the silent failure PRODUCT.md's fourth principle forbids.
 */
export type Matcher =
  | { ok: true; spans(text: string): Span[] }
  | { ok: false; error: string };

/** Everything `RegExp` gives a meaning to, so a plain query can mean itself. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * A matcher that finds nothing, for a query that asks for nothing.
 *
 * Not an error: an empty box is the panel at rest, and what to say about that
 * is the caller's decision rather than this function's.
 */
const NEVER: Matcher = { ok: true, spans: () => [] };

/**
 * One query, compiled once, for every surface that searches.
 *
 * Plain, case-sensitive, whole-word and regular-expression are four spellings
 * of one operation, and this is where they become one: the query is escaped
 * unless it is already a pattern, wrapped in word boundaries if it has to be,
 * and given the `i` flag unless case was asked for. What comes back sweeps a
 * string for *every* occurrence, because a panel the reviewer steps through has
 * to agree with the count printed above it.
 *
 * Compiling is separated from sweeping so a search over thousands of lines
 * builds one `RegExp` rather than one per line.
 */
export function compileMatcher(query: string, options: MatchOptions = {}): Matcher {
  const needle = query.trim();
  if (needle === '') return NEVER;

  const body =
    options.regex === true ? needle : needle.replace(REGEX_SPECIAL, '\\$&');
  // Non-capturing, because `\bfoo|bar\b` binds the boundaries to one branch
  // each — which is not what anyone means by "whole word" with an alternation.
  const source = options.wholeWord === true ? `\\b(?:${body})\\b` : body;

  let pattern: RegExp;
  try {
    pattern = new RegExp(source, options.caseSensitive === true ? 'g' : 'gi');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: true,
    spans(text) {
      const found: Span[] = [];
      pattern.lastIndex = 0;

      for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
        if (hit[0] === '') {
          // A zero-length match leaves `lastIndex` exactly where it was, so
          // `a*` would sweep the same position forever and take the tab with
          // it. It is also not a result: a highlight zero pixels wide points
          // the reviewer at nothing while counting as somewhere to go.
          pattern.lastIndex += 1;
          continue;
        }
        found.push({ start: hit.index, end: hit.index + hit[0].length });
      }

      return found;
    },
  };
}

/** One line of a patch the reviewer can be sent to, as the walk sees it. */
export interface PatchLine {
  kind: 'addition' | 'deletion' | 'context';
  side: MatchSide;
  line: number;
  text: string;
}

/** One changed line. A {@link PatchLine} that is not context. */
interface ChangedLine extends PatchLine {
  kind: 'addition' | 'deletion';
}

/**
 * Every changed line in one file's patch, numbered on its own side.
 *
 * The diff search's rule, and the narrower of the two: a hit on a line nobody
 * touched sends the reviewer somewhere the review is not. The find panel wants
 * the other one — see {@link patchLines}, which this is a filter over.
 */
export function changedLines(patch: string): ChangedLine[] {
  return patchLines(patch).filter(
    (line): line is ChangedLine => line.kind !== 'context',
  );
}

/**
 * Every line of a patch, context included, numbered on a side.
 *
 * The expensive half of a search, and separated from the sweep for that
 * reason: this runs once per file list, where the sweep over what it returns
 * runs once per keystroke. `parseFiles` is how a caller holds onto it.
 *
 * A context line exists on both sides and needs one number. It gets the
 * additions side — the new-file numbering, which is what a reviewer means when
 * they say "line 42", and the side a jump to a line can always scroll to.
 */
export function patchLines(patch: string): PatchLine[] {
  if (patch === '') return [];

  const found: PatchLine[] = [];
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
      // Context: rendered, and a valid comment target, but not a change. It is
      // reported so the find panel can offer it and filtered back out by
      // `changedLines`, which is the diff search's narrower rule.
      found.push({
        kind: 'context',
        side: 'additions',
        line: additionLine,
        text: raw === '' ? '' : raw.slice(1),
      });
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
 * Whether a path matches, without ranking it against any other.
 *
 * The file tree's filter, and deliberately the same substring rule the panel
 * uses rather than a second one: a reviewer who has learned what typing `util`
 * finds in one place should not have to learn it again in the other.
 *
 * Separate from {@link filterPaths} because the two want opposite things from
 * the same match. The jump palette ranks by where the hit fell and truncates,
 * so the likeliest destination is first; a tree keeps its own order and its own
 * nesting and has to show every hit, so a ranked, truncated list is no use to
 * it. What they share is this question.
 *
 * An empty query matches everything, which is what lets the box sit on screen
 * at rest without hiding anything.
 */
export function pathMatches(path: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || locate(path, needle) !== null;
}

/** One file's patch, walked once, ready to be swept as often as asked. */
export interface ParsedFile {
  path: string;
  lines: readonly PatchLine[];
}

/**
 * A file list, parsed once.
 *
 * What the find panel memoizes against its files, so that typing costs a regex
 * pass over lines that are already split rather than a re-walk of every patch.
 * With context lines in scope that corpus is several times what the diff search
 * used to look at, and PRODUCT.md's third principle makes the difference this
 * function's whole reason for existing.
 */
export function parseFiles(files: readonly SearchableFile[]): ParsedFile[] {
  return files.map((file) => ({ path: file.path, lines: patchLines(file.patch) }));
}

/** What a sweep needs to know beyond the query itself. */
export interface SweepOptions extends SearchOptions {
  /**
   * Offer lines nobody changed.
   *
   * Off by default, which is the diff search's rule and the reason it is a
   * *diff* search. The find panel turns it on: a reviewer who has come from an
   * editor expects find-in-files to find what is in the files.
   */
  includeContext?: boolean;
}

/**
 * Everything that matches, in the order the files were given.
 *
 * File order is the column's order, which is the order the reviewer reads in,
 * so results run top to bottom alongside the diff. Within a file the path match
 * comes first, then its lines in patch order, and within a line every
 * occurrence in turn — a panel that is stepped through has to offer each hit
 * separately, and the summary above it has to be able to count them.
 */
export function searchParsed(
  files: readonly ParsedFile[],
  matcher: Matcher,
  options: SweepOptions = {},
): DiffMatch[] {
  if (!matcher.ok) return [];

  const limit = options.limit ?? DEFAULT_LIMIT;
  const wantsContext = options.includeContext === true;
  const matches: DiffMatch[] = [];

  for (const file of files) {
    if (matches.length >= limit) return matches;

    for (const span of matcher.spans(file.path)) {
      matches.push({ path: file.path, kind: 'path', line: null, side: null, text: file.path, ...span });
      // One path result per file. A second hit in the same path is the same
      // destination twice, unlike a second hit on a line.
      break;
    }

    for (const line of file.lines) {
      if (line.kind === 'context' && !wantsContext) continue;
      for (const span of matcher.spans(line.text)) {
        if (matches.length >= limit) return matches;
        matches.push({
          path: file.path,
          kind: line.kind,
          line: line.line,
          side: line.side,
          text: line.text,
          ...span,
        });
      }
    }
  }

  return matches;
}

/**
 * Parse, compile and sweep in one call.
 *
 * The convenience form, for a caller with a query and a file list and no reason
 * to hold either. A pattern that will not compile gives back nothing rather
 * than throwing; the panel asks {@link compileMatcher} directly so it can draw
 * the reason instead.
 */
export function searchDiff(
  files: readonly SearchableFile[],
  query: string,
  options: SweepOptions & MatchOptions = {},
): DiffMatch[] {
  return searchParsed(parseFiles(files), compileMatcher(query, options), options);
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
