import { describe, expect, it } from 'vitest';
import { type SearchableFile, filterPaths, searchDiff } from './search';

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
