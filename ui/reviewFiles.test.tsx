/**
 * Merging the two file lists GitHub sends into the one the review UI renders.
 *
 * The diff says what changed; the GraphQL file list says how much and whether
 * this reviewer has looked at it. Neither is sufficient alone, and the fallback
 * path supplies a third, poorer shape. These tests pin the join.
 */

import { describe, expect, it } from 'vitest';
import { fileFixture, prPayloadWithFiles } from './prPayload.fixture';
import { changeTotals, countPatchLines, reviewFiles } from './reviewFiles';

const patchOf = (path: string, added: number, removed: number): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,2 +1,2 @@',
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
  ].join('\n');

describe('reviewFiles', () => {
  it('lays the files out the way the tree draws them, not the way the diff arrived', () => {
    // The bug this replaced: the column drew GitHub's order and the tree
    // re-sorted into folders-first, so a root-level file came first on one
    // surface and last on the other. One walk decides it now, and it is the
    // tree's — see `fileOrder`.
    const payload = prPayloadWithFiles([
      fileFixture({ path: 'README.md' }),
      fileFixture({ path: 'src/app.ts' }),
      fileFixture({ path: 'docs/guide.md' }),
    ]);

    expect(reviewFiles(payload).map((f) => f.path)).toEqual([
      'docs/guide.md',
      'src/app.ts',
      'README.md',
    ]);
  });

  it('joins the GraphQL metadata by path', () => {
    const payload = prPayloadWithFiles([
      fileFixture({
        path: 'src/b.ts',
        additions: 12,
        deletions: 3,
        changeType: 'MODIFIED',
        viewedState: 'VIEWED',
      }),
      fileFixture({
        path: 'src/a.ts',
        additions: 1,
        deletions: 0,
        changeType: 'ADDED',
        viewedState: 'UNVIEWED',
      }),
    ]);

    // Looked up by path rather than by position: what this pins is the join,
    // and `fileOrder` is free to lay the two out however the tree would.
    const byPath = new Map(reviewFiles(payload).map((file) => [file.path, file]));

    expect(byPath.get('src/b.ts')).toMatchObject({
      additions: 12,
      deletions: 3,
      changeType: 'MODIFIED',
      viewedState: 'VIEWED',
    });
    expect(byPath.get('src/a.ts')?.changeType).toBe('ADDED');
  });

  it('counts the patch itself when GraphQL sent no row for the file', () => {
    // GraphQL nulls a field it could not resolve while still returning 200, and
    // the files connection is capped. A file present in the diff but missing
    // from the metadata must still show honest counts rather than +0 -0.
    const payload = prPayloadWithFiles([
      fileFixture({ path: 'src/a.ts', patch: patchOf('src/a.ts', 4, 2) }),
    ]);
    payload.pullRequest['files'] = { nodes: [] };

    const files = reviewFiles(payload);

    expect(files[0]).toMatchObject({ additions: 4, deletions: 2 });
  });

  it('does not count the +++ and --- header lines as changes', () => {
    const payload = prPayloadWithFiles([
      fileFixture({ path: 'src/a.ts', patch: patchOf('src/a.ts', 0, 0) }),
    ]);
    payload.pullRequest['files'] = { nodes: [] };

    expect(reviewFiles(payload)[0]).toMatchObject({ additions: 0, deletions: 0 });
  });

  it('defaults an unlisted file to unviewed rather than guessing', () => {
    const payload = prPayloadWithFiles([fileFixture({ path: 'src/a.ts' })]);
    payload.pullRequest['files'] = { nodes: [] };

    expect(reviewFiles(payload)[0]?.viewedState).toBe('UNVIEWED');
  });

  it('marks lockfiles and generated paths as noise without dropping them', () => {
    const payload = prPayloadWithFiles([
      fileFixture({ path: 'package-lock.json' }),
      fileFixture({ path: 'src/generated/api.ts' }),
      fileFixture({ path: 'src/app.ts' }),
    ]);

    const files = reviewFiles(payload);

    // Kept, all three of them — the flag dims a row, it does not drop a file.
    expect(new Set(files.map((f) => f.path))).toEqual(
      new Set(['package-lock.json', 'src/generated/api.ts', 'src/app.ts']),
    );
    expect(
      Object.fromEntries(files.map((file) => [file.path, file.noise])),
    ).toEqual({
      'package-lock.json': true,
      'src/generated/api.ts': true,
      'src/app.ts': false,
    });
  });

  it('carries the fallback path’s patchOmitted flag through', () => {
    const payload = prPayloadWithFiles(
      [fileFixture({ path: 'huge.bin', patch: '', patchOmitted: true })],
      { source: 'files-api' },
    );

    expect(reviewFiles(payload)[0]).toMatchObject({
      path: 'huge.bin',
      patchOmitted: true,
    });
  });

  it('reports patchOmitted as false on the unified path, which has no such flag', () => {
    const payload = prPayloadWithFiles([fileFixture({ path: 'src/a.ts' })]);

    expect(reviewFiles(payload)[0]?.patchOmitted).toBe(false);
  });

  it('keeps both sides of a rename', () => {
    const payload = prPayloadWithFiles([
      fileFixture({
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        isRename: true,
        changeType: 'RENAMED',
      }),
    ]);

    expect(reviewFiles(payload)[0]).toMatchObject({
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
      isRename: true,
    });
  });

  it('falls back to a change type derived from the diff when GraphQL omits one', () => {
    const payload = prPayloadWithFiles([
      fileFixture({ path: 'src/new.ts', oldPath: 'src/old.ts', isRename: true }),
    ]);
    payload.pullRequest['files'] = { nodes: [] };

    expect(reviewFiles(payload)[0]?.changeType).toBe('RENAMED');
  });

  it('survives a pull request node whose files connection is missing entirely', () => {
    const payload = prPayloadWithFiles([fileFixture({ path: 'src/a.ts' })]);
    delete payload.pullRequest['files'];

    expect(reviewFiles(payload).map((f) => f.path)).toEqual(['src/a.ts']);
  });
});

describe('countPatchLines', () => {
  /**
   * The fallback counter, used when the GraphQL `files` connection was capped
   * or denied — which is exactly when nothing else can correct it.
   */
  const patch = (...body: string[]): string =>
    ['diff --git a/x.sql b/x.sql', '--- a/x.sql', '+++ b/x.sql', '@@ -1,3 +1,3 @@', ...body].join(
      '\n',
    );

  it('counts ordinary additions and deletions', () => {
    expect(countPatchLines(patch(' ctx', '-gone', '+new'))).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it('does not count the file headers', () => {
    // The whole reason the filter exists: without it every file reports a
    // spurious +1 -1.
    expect(countPatchLines(patch(' ctx'))).toEqual({ additions: 0, deletions: 0 });
  });

  it('counts a deleted line that itself starts with two dashes', () => {
    // A SQL comment, or a YAML document separator. Prefixed with `-` for the
    // deletion it becomes `---`, which the header filter swallowed — so a file
    // that removed ten of them reported a confident, wrong, zero.
    expect(countPatchLines(patch('-- a sql comment', '--- yaml separator'))).toEqual({
      additions: 0,
      deletions: 2,
    });
  });

  it('counts an added line that itself starts with two pluses', () => {
    expect(countPatchLines(patch('++i;', '+++ still code'))).toEqual({
      additions: 2,
      deletions: 0,
    });
  });

  it('ignores hunk headers', () => {
    expect(countPatchLines(patch('+one', '@@ -20,3 +20,3 @@', '+two'))).toEqual({
      additions: 2,
      deletions: 0,
    });
  });

  it('survives a patch with no hunk at all', () => {
    expect(countPatchLines('')).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('changeTotals', () => {
  it('adds up what is on screen, which is not always the whole pull request', () => {
    // Counted from the list being drawn, so a diff narrowed to one commit
    // describes that. Totalling the pull request here would contradict the
    // column directly beneath the sentence.
    const files = reviewFiles(
      prPayloadWithFiles([
        fileFixture({ path: 'src/a.ts', additions: 4, deletions: 2 }),
        fileFixture({ path: 'src/b.ts', additions: 1, deletions: 9 }),
      ]),
    );

    expect(changeTotals(files)).toEqual({ files: 2, additions: 5, deletions: 11 });
  });

  it('has an answer for an empty list rather than none', () => {
    expect(changeTotals([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});
