/**
 * A `PrPayload` shaped like one PULL_REQUEST_QUERY actually returns.
 *
 * Test support only — nothing in the built extension imports it. It exists so
 * every UI test starts from the same realistic node instead of inventing a
 * plausible-looking one, which is how a component quietly comes to depend on a
 * field GitHub never sends.
 */

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
    ...overrides,
  };
}
