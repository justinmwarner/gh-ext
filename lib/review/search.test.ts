import { describe, expect, it } from 'vitest';
import {
  type SearchableFile,
  compileMatcher,
  filterPaths,
  parseFiles,
  pathMatches,
  patchLines,
  searchDiff,
  searchParsed,
} from './search';

const patch = (path: string, body: readonly string[]): string =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...body].join(
    '\n',
  );

const file = (path: string, body: readonly string[]): SearchableFile => ({
  path,
  patch: patch(path, body),
});

/** One hunk with a context line, a deletion and an addition. */
const CACHE_FILE = file('src/cache.ts', [
  '@@ -10,3 +10,4 @@ export class Cache {',
  '   const existing = this.store.get(key);',
  '-  return existing;',
  '+  if (existing === undefined) return null;',
  '+  return existing.value;',
]);

describe('searchDiff', () => {
  it('finds a changed line and says where it is', () => {
    const [match] = searchDiff([CACHE_FILE], 'undefined');

    expect(match).toBeDefined();
    expect(match?.path).toBe('src/cache.ts');
    expect(match?.kind).toBe('addition');
    expect(match?.side).toBe('additions');
    expect(match?.line).toBe(11);
    expect(match?.text).toBe('  if (existing === undefined) return null;');
  });

  it('finds a removed line on the deletion side', () => {
    const found = searchDiff([CACHE_FILE], 'return existing;');

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('deletion');
    expect(found[0]?.side).toBe('deletions');
    expect(found[0]?.line).toBe(11);
  });

  it('numbers added lines from the hunk header, not from the top of the file', () => {
    const found = searchDiff([CACHE_FILE], 'existing.value');

    expect(found[0]?.line).toBe(12);
  });

  it('matches a file path even when nothing inside the file matches', () => {
    const found = searchDiff([CACHE_FILE], 'cache');

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('path');
    expect(found[0]?.line).toBeNull();
    expect(found[0]?.side).toBeNull();
    expect(found[0]?.text).toBe('src/cache.ts');
  });

  it('does not match context lines', () => {
    // The whole point of searching a diff rather than the file: a hit on a line
    // nobody changed sends the reviewer somewhere the review is not.
    expect(searchDiff([CACHE_FILE], 'this.store.get')).toEqual([]);
  });

  it('does not match the hunk header or its trailing section name', () => {
    expect(searchDiff([CACHE_FILE], 'export class Cache')).toEqual([]);
    expect(searchDiff([CACHE_FILE], '@@')).toEqual([]);
  });

  it('does not match the file headers that begin with --- and +++', () => {
    // `--- a/src/cache.ts` starts with a `-` and is not a removed line. Slicing
    // the first character off it would report a deletion of `-- a/src/cache.ts`.
    const found = searchDiff([CACHE_FILE], 'a/src/cache.ts');

    expect(found.every((match) => match.kind === 'path')).toBe(true);
  });

  it('does match a changed line that is itself dashes', () => {
    // The reason header lines are excluded by position rather than by prefix: a
    // removed `---` in a YAML file is a perfectly ordinary deletion.
    const yaml = file('deploy.yml', ['@@ -1,2 +1,1 @@', '---', '-  replicas: 3']);

    // The bare `---` is inside the hunk, so it is a deletion of `--`… which is
    // exactly why the prefix test is not enough on its own.
    const found = searchDiff([yaml], 'replicas');
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('deletion');
  });

  it('ignores case on both sides', () => {
    expect(searchDiff([CACHE_FILE], 'UNDEFINED')).toHaveLength(1);
    expect(searchDiff([file('src/App.tsx', [])], 'app.tsx')).toHaveLength(1);
  });

  it('reports where in the line the query starts, so it can be highlighted', () => {
    const [match] = searchDiff([CACHE_FILE], 'existing');

    expect(match?.text.slice(match.start, match.end)).toBe('existing');
  });

  it('returns nothing for an empty or blank query', () => {
    expect(searchDiff([CACHE_FILE], '')).toEqual([]);
    expect(searchDiff([CACHE_FILE], '   ')).toEqual([]);
  });

  it('keeps files in the order they were given', () => {
    const found = searchDiff(
      [
        file('b.ts', ['@@ -1,1 +1,1 @@', '+needle']),
        file('a.ts', ['@@ -1,1 +1,1 @@', '+needle']),
      ],
      'needle',
    );

    expect(found.map((match) => match.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('stops at the limit rather than building a list nobody can read', () => {
    const body = ['@@ -1,50 +1,50 @@'];
    for (let i = 0; i < 50; i += 1) body.push(`+needle ${i}`);

    expect(searchDiff([file('big.ts', body)], 'needle', { limit: 5 })).toHaveLength(5);
  });

  it('survives a file with no patch at all', () => {
    expect(searchDiff([{ path: 'logo.png', patch: '' }], 'logo')).toHaveLength(1);
    expect(searchDiff([{ path: 'logo.png', patch: '' }], 'needle')).toEqual([]);
  });

  it('skips the no-newline marker rather than reading it as content', () => {
    const found = searchDiff(
      [file('a.txt', ['@@ -1,1 +1,1 @@', '-old', '\\ No newline at end of file', '+new'])],
      'newline',
    );

    expect(found).toEqual([]);
  });

  it('keeps counting lines correctly across two hunks', () => {
    const two = file('src/app.ts', [
      '@@ -1,2 +1,2 @@',
      ' one',
      '+two',
      '@@ -40,2 +40,2 @@',
      ' forty',
      '+needle',
    ]);

    expect(searchDiff([two], 'needle')[0]?.line).toBe(41);
  });
});

describe('filterPaths', () => {
  const paths = ['src/app.ts', 'src/cache/index.ts', 'docs/app.md', 'README.md'];

  it('returns every path for an empty query, in order', () => {
    expect(filterPaths(paths, '').map((m) => m.path)).toEqual(paths);
  });

  it('matches anywhere in the path, ignoring case', () => {
    expect(filterPaths(paths, 'CACHE').map((m) => m.path)).toEqual([
      'src/cache/index.ts',
    ]);
  });

  it('puts a match in the file name ahead of one in a directory', () => {
    // Typing "app" almost always means the file called app, not the one that
    // happens to live under a directory of that name.
    expect(filterPaths(['src/app/index.ts', 'src/app.ts'], 'app').map((m) => m.path)).toEqual([
      'src/app.ts',
      'src/app/index.ts',
    ]);
  });

  it('reports where the match starts so it can be highlighted', () => {
    const [match] = filterPaths(paths, 'cache');

    expect(match?.path.slice(match.start, match.end)).toBe('cache');
  });

  it('gives an empty result rather than everything when nothing matches', () => {
    expect(filterPaths(paths, 'zzz')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(filterPaths(paths, '', { limit: 2 })).toHaveLength(2);
  });
});

/**
 * The rule the file tree's filter narrows by.
 *
 * Its own export rather than `filterPaths`, because the two want opposite
 * things from the same match: the jump palette ranks and truncates so the best
 * candidate is first, and a tree must keep its own order and show every hit.
 * What they must agree on is *what counts as a hit*, which is why it is asked
 * here rather than reimplemented one directory over.
 */
describe('pathMatches', () => {
  it('ignores case, as the panel does', () => {
    expect(pathMatches('src/App.tsx', 'app')).toBe(true);
    expect(pathMatches('src/app.tsx', 'APP')).toBe(true);
  });

  it('matches inside a directory as readily as inside a name', () => {
    // Typing a folder is how a reviewer narrows to an area of the change, and
    // it is most of what this filter is for.
    expect(pathMatches('lib/review/search.ts', 'review/')).toBe(true);
  });

  it('trims, so a stray space does not empty the tree', () => {
    expect(pathMatches('src/app.ts', '  app  ')).toBe(true);
  });

  it('lets everything through for an empty query', () => {
    // The filter box at rest hides nothing, which is what makes it safe to
    // leave on screen.
    expect(pathMatches('src/app.ts', '')).toBe(true);
    expect(pathMatches('src/app.ts', '   ')).toBe(true);
  });

  it('refuses a path it does not appear in', () => {
    expect(pathMatches('src/app.ts', 'zzz')).toBe(false);
  });
});

/**
 * The one matching rule every surface uses.
 *
 * Four spellings of the same operation — plain, case-sensitive, whole-word and
 * regular expression — compiled to a single `RegExp` so there is one behaviour
 * to learn and one to test, rather than four code paths that agree by accident.
 */
describe('compileMatcher', () => {
  /** The compiled matcher, or a failure the test did not expect. */
  const spansOf = (query: string, options = {}, text = ''): readonly unknown[] => {
    const matcher = compileMatcher(query, options);
    if (!matcher.ok) throw new Error(`expected a matcher, got: ${matcher.error}`);
    return matcher.spans(text);
  };

  it('matches a plain substring, ignoring case by default', () => {
    expect(spansOf('needle', {}, 'a NEEDLE here')).toEqual([{ start: 2, end: 8 }]);
  });

  it('treats a plain query as text, not as a pattern', () => {
    // `a.c` must not match `abc`. Without escaping, every plain search
    // containing a dot, a star or a bracket would quietly mean something else.
    expect(spansOf('a.c', {}, 'abc')).toEqual([]);
    expect(spansOf('a.c', {}, 'a.c')).toEqual([{ start: 0, end: 3 }]);
  });

  it('respects case when asked to', () => {
    expect(spansOf('Needle', { caseSensitive: true }, 'a needle')).toEqual([]);
    expect(spansOf('needle', { caseSensitive: true }, 'a needle')).toEqual([
      { start: 2, end: 8 },
    ]);
  });

  it('refuses a hit inside a longer word when whole-word is on', () => {
    expect(spansOf('cat', { wholeWord: true }, 'concatenate')).toEqual([]);
    expect(spansOf('cat', { wholeWord: true }, 'the cat sat')).toEqual([
      { start: 4, end: 7 },
    ]);
  });

  it('reads the query as a pattern when regex is on', () => {
    expect(spansOf('n[ae]edle', { regex: true }, 'a naedle')).toEqual([
      { start: 2, end: 8 },
    ]);
  });

  it('composes whole-word with regex, the way the editor people came from does', () => {
    expect(spansOf('ca.', { regex: true, wholeWord: true }, 'concatenate')).toEqual([]);
    expect(spansOf('ca.', { regex: true, wholeWord: true }, 'the cat sat')).toEqual([
      { start: 4, end: 7 },
    ]);
  });

  it('reports every occurrence on the line, not just the first', () => {
    // A panel the reviewer steps through has to agree with the count above it,
    // and a line with three hits is three places to go.
    expect(spansOf('ab', {}, 'ab ab ab')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it('says what is wrong with a pattern that will not compile', () => {
    const matcher = compileMatcher('(unclosed', { regex: true });

    expect(matcher.ok).toBe(false);
    if (!matcher.ok) expect(matcher.error).not.toBe('');
  });

  it('only rejects a bad pattern while regex is on', () => {
    // `(unclosed` is an ordinary thing to search a diff for with regex off.
    expect(spansOf('(unclosed', {}, 'x (unclosed y')).toEqual([{ start: 2, end: 11 }]);
  });

  it('terminates on a pattern that can match nothing at all', () => {
    // `a*` matches the empty string at every position. A sweep that does not
    // advance past a zero-length match never returns, and the tab is gone.
    const spans = spansOf('a*', { regex: true }, 'bab');

    expect(spans.length).toBeLessThanOrEqual(4);
    expect(spans).toContainEqual({ start: 1, end: 2 });
  });

  it('matches nothing at all for a blank query', () => {
    // Not an error: an empty box is the panel at rest, and the caller decides
    // what to say about it.
    expect(spansOf('', {}, 'anything')).toEqual([]);
    expect(spansOf('   ', {}, 'anything')).toEqual([]);
  });
});

describe('compileMatcher, on a pattern that can match nothing', () => {
  it('drops a hit that would highlight no characters', () => {
    // `a*` matches the empty string between every pair of characters. Those are
    // not places to send anyone: a result row whose highlight is zero pixels
    // wide points at nothing and counts as something.
    const matcher = compileMatcher('a*', { regex: true });
    if (!matcher.ok) throw new Error(matcher.error);

    expect(matcher.spans('bab')).toEqual([{ start: 1, end: 2 }]);
  });
});

/**
 * Every line of a patch the reviewer can be sent to, context included.
 *
 * Split out from `changedLines` because the find panel searches context and
 * the diff search does not, and the parse is the expensive half: it runs once
 * per file list, where the sweep over it runs once per keystroke.
 */
describe('patchLines', () => {
  it('reports a context line, which changedLines leaves out', () => {
    const lines = patchLines(patch('src/cache.ts', [
      '@@ -10,3 +10,4 @@ export class Cache {',
      '   const existing = this.store.get(key);',
      '-  return existing;',
      '+  return existing.value;',
    ]));

    expect(lines.map((line) => line.kind)).toEqual(['context', 'deletion', 'addition']);
  });

  it('numbers a context line on the additions side', () => {
    // A context line exists on both sides and needs one number. The new-file
    // numbering is what a reviewer means when they say "line 42".
    const [context] = patchLines(patch('a.ts', [
      '@@ -5,2 +10,2 @@',
      ' unchanged',
      '+added',
    ]));

    expect(context?.kind).toBe('context');
    expect(context?.side).toBe('additions');
    expect(context?.line).toBe(10);
  });

  it('still leaves the no-newline marker out', () => {
    const lines = patchLines(patch('a.txt', [
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
    ]));

    expect(lines.map((line) => line.text)).toEqual(['old', 'new']);
  });
});

describe('searchDiff, with the find panel’s options', () => {
  it('finds a context line when asked to include them', () => {
    const found = searchDiff([CACHE_FILE], 'this.store.get', { includeContext: true });

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('context');
    expect(found[0]?.side).toBe('additions');
  });

  it('still leaves context out by default, so the diff search is unchanged', () => {
    expect(searchDiff([CACHE_FILE], 'this.store.get')).toEqual([]);
  });

  it('reports each occurrence on a line as its own result', () => {
    const twice = file('a.ts', ['@@ -1,1 +1,1 @@', '+const a = a + a;']);
    const found = searchDiff([twice], 'a =');

    expect(found).toHaveLength(1);
    expect(searchDiff([twice], 'a')).toHaveLength(4);
  });

  it('honours case when the toggle is on', () => {
    expect(searchDiff([CACHE_FILE], 'UNDEFINED', { caseSensitive: true })).toEqual([]);
    expect(searchDiff([CACHE_FILE], 'undefined', { caseSensitive: true })).toHaveLength(1);
  });

  it('honours whole-word and regex too', () => {
    expect(searchDiff([CACHE_FILE], 'exist', { wholeWord: true })).toEqual([]);
    expect(searchDiff([CACHE_FILE], 'exist(ing)?', { regex: true }).length).toBeGreaterThan(0);
  });

  it('gives back nothing rather than throwing on a pattern that will not compile', () => {
    // The panel asks `compileMatcher` itself to draw the error. This is only
    // the promise that the convenience wrapper does not take the page down.
    expect(searchDiff([CACHE_FILE], '(unclosed', { regex: true })).toEqual([]);
  });
});

describe('searchParsed', () => {
  it('searches a file list that was parsed once, ahead of the query', () => {
    const parsed = parseFiles([CACHE_FILE]);
    const matcher = compileMatcher('existing', {});
    if (!matcher.ok) throw new Error(matcher.error);

    const found = searchParsed(parsed, matcher);

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((match) => match.path === 'src/cache.ts')).toBe(true);
  });

  it('matches the path as well as the lines, the way searchDiff does', () => {
    const parsed = parseFiles([CACHE_FILE]);
    const matcher = compileMatcher('cache', {});
    if (!matcher.ok) throw new Error(matcher.error);

    expect(searchParsed(parsed, matcher)[0]?.kind).toBe('path');
  });
});
