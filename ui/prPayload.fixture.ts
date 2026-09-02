/**
 * A `PrPayload` shaped like one PULL_REQUEST_QUERY actually returns.
 *
 * Test support only — nothing in the built extension imports it. It exists so
 * every UI test starts from the same realistic node instead of inventing a
 * plausible-looking one, which is how a component quietly comes to depend on a
 * field GitHub never sends.
 */

import type { FallbackDiffFile } from '@/lib/github/files-fallback';
import type { FileViewedState, PatchStatus } from '@/lib/github/types';
import type { PrPayload, PullRequestNode } from '@/lib/messages';

export function pullRequestNode(
  overrides: Partial<PullRequestNode> = {},
): PullRequestNode {
  return {
    id: 'PR_kwDOABCD',
    number: 42,
    title: 'Cache the diff on head SHA',
    headRefOid: 'f'.repeat(40),
    state: 'OPEN',
    isDraft: false,
    merged: false,
    baseRefName: 'main',
    headRefName: 'cache-the-diff',
    permalink: 'https://github.com/acme/widgets/pull/42',
    author: { login: 'rowan', avatarUrl: 'https://avatars.example/rowan' },
    latestReviews: {
      nodes: [
        {
          author: { login: 'dana', avatarUrl: 'https://avatars.example/dana' },
          state: 'APPROVED',
        },
      ],
    },
    reviewRequests: {
      nodes: [
        {
          requestedReviewer: {
            __typename: 'User',
            login: 'kim',
            avatarUrl: 'https://avatars.example/kim',
          },
        },
      ],
    },
    ...overrides,
  };
}

export function prPayload(overrides: Partial<PrPayload> = {}): PrPayload {
  return {
    ref: { owner: 'acme', repo: 'widgets', number: 42 },
    headSha: 'f'.repeat(40),
    pullRequest: pullRequestNode(),
    threads: [],
    checks: { state: 'SUCCESS' },
    diff: { source: 'unified', files: [], truncated: false },
    truncated: { files: false, threads: false },
    ...overrides,
  };
}

/**
 * One changed file, in both shapes GitHub sends it in.
 *
 * The review UI joins the unified diff against the GraphQL files connection, so
 * a fixture that only builds one of them cannot exercise the join. This builds
 * both halves from one description and keeps them consistent.
 */
export interface FileFixture extends FallbackDiffFile {
  additions: number;
  deletions: number;
  viewedState: FileViewedState;
}

export function fileFixture(
  overrides: Partial<FileFixture> & { path: string },
): FileFixture {
  const path = overrides.path;
  return {
    oldPath: path,
    isBinary: false,
    isRename: false,
    patchOmitted: false,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,1 +1,1 @@',
      '-before',
      '+after',
    ].join('\n'),
    changeType: 'MODIFIED' as PatchStatus,
    additions: 1,
    deletions: 1,
    viewedState: 'UNVIEWED' as FileViewedState,
    ...overrides,
  };
}

/**
 * A payload carrying real files on both sides.
 *
 * `source` picks which arm of `DiffPayload` the diff arrives on: the unified
 * path drops `changeType` and `patchOmitted`, exactly as `parseUnifiedDiff`
 * does, so a component that reads them off the wrong arm fails here.
 */
export function prPayloadWithFiles(
  files: readonly FileFixture[],
  options: { source?: 'unified' | 'files-api'; truncated?: boolean } = {},
): PrPayload {
  const { source = 'unified', truncated = false } = options;

  const diff: PrPayload['diff'] =
    source === 'unified'
      ? {
          source: 'unified',
          truncated: false,
          files: files.map(({ path, oldPath, isBinary, isRename, patch }) => ({
            path,
            oldPath,
            isBinary,
            isRename,
            patch,
          })),
        }
      : {
          source: 'files-api',
          truncated,
          files: files.map(
            ({ path, oldPath, isBinary, isRename, patch, patchOmitted, changeType }) => ({
              path,
              oldPath,
              isBinary,
              isRename,
              patch,
              patchOmitted,
              changeType,
            }),
          ),
        };

  return prPayload({
    diff,
    pullRequest: pullRequestNode({
      files: {
        nodes: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          changeType: f.changeType,
          viewerViewedState: f.viewedState,
        })),
      },
    }),
  });
}
