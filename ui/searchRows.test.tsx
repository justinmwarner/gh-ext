/**
 * The result tree, assembled from matches.
 *
 * The rule this file is really testing is that **order comes from `treeRows`**.
 * CLAUDE.md is explicit about why: the rail and the diff column disagreed about
 * where a root-level `README.md` sat, once, and the fix was to give one walk
 * authority over both. A second tree that sorted its own files would put that
 * bug back in a new place.
 */

import { describe, expect, it } from 'vitest';
import type { DiffMatch } from '@/lib/review/search';
import { type SearchRow, searchRows } from './searchRows';
import { treeRows } from './treeRows';

const NOTHING: ReadonlySet<string> = new Set();

const match = (path: string, line: number | null, text: string): DiffMatch => ({
  path,
  kind: line === null ? 'path' : 'addition',
  line,
  side: line === null ? null : 'additions',
  text,
  start: 0,
  end: 1,
});

const kindsAndPaths = (rows: readonly SearchRow[]): string[] =>
  rows.map((row) => `${row.kind}:${row.path}`);

/** A directory or file row by path. Match rows carry no count of their own. */
const holderAt = (
  rows: readonly SearchRow[],
  path: string,
): Extract<SearchRow, { kind: 'directory' | 'file' }> | undefined =>
  rows.find(
    (row): row is Extract<SearchRow, { kind: 'directory' | 'file' }> =>
      row.kind !== 'match' && row.path === path,
  );

describe('searchRows', () => {
  it('nests a matched file under the directories holding it', () => {
    const rows = searchRows([match('src/app.ts', 4, 'x')], NOTHING);

    expect(kindsAndPaths(rows)).toEqual([
      'directory:src/',
      'file:src/app.ts',
      'match:src/app.ts',
    ]);
  });

  it('leaves out a file that matched nothing', () => {
    const rows = searchRows([match('src/app.ts', 4, 'x')], NOTHING);

    expect(rows.some((row) => row.path === 'src/other.ts')).toBe(false);
  });

  it('lays files out in the order treeRows lays them out', () => {
    // Directories first, then files, counting the way a person does. The
    // assertion is against `treeRows` itself rather than a hand-written list,
    // so this test goes on being true if that order ever changes on purpose.
    const paths = ['README.md', 'src/app.ts', 'docs/a.md'];
    const rows = searchRows(paths.map((path) => match(path, 1, 'x')), NOTHING);

    expect(rows.filter((row) => row.kind === 'file').map((row) => row.path)).toEqual(
      treeRows(paths, NOTHING)
        .filter((row) => row.kind === 'file')
        .map((row) => row.path),
    );
  });

  it('counts a file9 before a file10, because treeRows does', () => {
    const paths = ['a/file10.ts', 'a/file9.ts'];
    const rows = searchRows(paths.map((path) => match(path, 1, 'x')), NOTHING);

    expect(rows.filter((row) => row.kind === 'file').map((row) => row.path)).toEqual([
      'a/file9.ts',
      'a/file10.ts',
    ]);
  });

  it('puts every match for a file under that file, in the order given', () => {
    const rows = searchRows(
      [match('a.ts', 2, 'first'), match('a.ts', 9, 'second')],
      NOTHING,
    );

    expect(rows.filter((row) => row.kind === 'match')).toHaveLength(2);
    expect(
      rows
        .filter((row): row is Extract<SearchRow, { kind: 'match' }> => row.kind === 'match')
        .map((row) => row.match.line),
    ).toEqual([2, 9]);
  });

  it('says how many matches a file and its directories hold', () => {
    const rows = searchRows(
      [match('src/a.ts', 1, 'x'), match('src/a.ts', 2, 'x'), match('src/b.ts', 3, 'x')],
      NOTHING,
    );

    const count = (path: string): number => holderAt(rows, path)?.matches ?? -1;

    expect(count('src/a.ts')).toBe(2);
    expect(count('src/b.ts')).toBe(1);
    expect(count('src/')).toBe(3);
  });

  it('hides the matches under a collapsed file but keeps its count', () => {
    const rows = searchRows(
      [match('a.ts', 1, 'x'), match('a.ts', 2, 'x')],
      new Set(['a.ts']),
    );

    expect(rows.filter((row) => row.kind === 'match')).toEqual([]);
    expect(holderAt(rows, 'a.ts')?.matches).toBe(2);
    expect(holderAt(rows, 'a.ts')?.expanded).toBe(false);
  });

  it('hides a whole directory, its files and their matches when collapsed', () => {
    const rows = searchRows(
      [match('src/a.ts', 1, 'x'), match('README.md', 2, 'x')],
      new Set(['src/']),
    );

    expect(kindsAndPaths(rows)).toEqual([
      'directory:src/',
      'file:README.md',
      'match:README.md',
    ]);
  });

  it('gives a path match no match row of its own', () => {
    // The file row *is* the destination for a hit on the name. A child row
    // repeating the path underneath it would be the same place twice.
    const rows = searchRows([match('src/app.ts', null, 'src/app.ts')], NOTHING);

    expect(rows.filter((row) => row.kind === 'match')).toEqual([]);
    expect(rows.find((row) => row.kind === 'file')?.matches).toBe(1);
  });

  it('marks the file row with where its name matched, so it can be highlighted', () => {
    const named: DiffMatch = { ...match('src/app.ts', null, 'src/app.ts'), start: 4, end: 7 };
    const rows = searchRows([named], NOTHING);
    const file = rows.find((row) => row.kind === 'file');

    expect(file?.kind === 'file' ? file.nameMatch : null).toEqual({ start: 4, end: 7 });
  });

  it('gives every row a depth, so it can be indented', () => {
    const rows = searchRows([match('a/b/c.ts', 5, 'x')], NOTHING);

    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3]);
  });

  it('gives each row a key that is stable and unique', () => {
    const rows = searchRows(
      [match('a.ts', 1, 'x'), match('a.ts', 1, 'y'), match('a.ts', 2, 'x')],
      NOTHING,
    );
    const keys = rows.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is empty when nothing matched', () => {
    expect(searchRows([], NOTHING)).toEqual([]);
  });
});
