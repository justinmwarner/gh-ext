/**
 * Merging the two file lists GitHub sends into the one the review UI renders.
 *
 * The diff says what changed; the GraphQL file list says how much and whether
 * this reviewer has looked at it. Neither is sufficient alone, and the fallback
 * path supplies a third, poorer shape. These tests pin the join.
 */

import { describe, expect, it } from 'vitest';
import { fileFixture, prPayloadWithFiles } from './prPayload.fixture';
import { reviewFiles } from './reviewFiles';

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
  it('keeps the diff order and joins the GraphQL metadata by path', () => {
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

    const files = reviewFiles(payload);

    expect(files.map((f) => f.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(files[0]).toMatchObject({
      additions: 12,
      deletions: 3,
      changeType: 'MODIFIED',
      viewedState: 'VIEWED',
    });
    expect(files[1]?.changeType).toBe('ADDED');
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

    expect(files.map((f) => f.path)).toEqual([
      'package-lock.json',
      'src/generated/api.ts',
      'src/app.ts',
    ]);
    expect(files.map((f) => f.noise)).toEqual([true, true, false]);
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
