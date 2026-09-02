/**
 * Reading reviewers off the pull request node.
 *
 * `reviewRequests.nodes[].requestedReviewer` is a union of five types, and only
 * two of them carry a `login`. A mapper that reaches for `login` and gives up
 * drops every team and bot request — and a pull request whose only pending
 * reviewer is a team then renders nothing at all, which a reviewer reads as
 * "nobody has been asked".
 */

import { describe, expect, it } from 'vitest';
import type { PullRequestNode } from '@/lib/messages';
import { prReviewers } from './prNode';
import { pullRequestNode } from './prPayload.fixture';

const requesting = (...reviewers: unknown[]): PullRequestNode =>
  pullRequestNode({
    latestReviews: { nodes: [] },
    reviewRequests: { nodes: reviewers.map((requestedReviewer) => ({ requestedReviewer })) },
  });

describe('prReviewers', () => {
  it('keeps a requested user', () => {
    const node = requesting({
      __typename: 'User',
      login: 'kim',
      avatarUrl: 'https://avatars.example/kim',
    });

    expect(prReviewers(node)).toEqual([
      {
        login: 'kim',
        avatarUrl: 'https://avatars.example/kim',
        state: null,
        kind: 'user',
      },
    ]);
  });

  it('keeps a requested team, which has a slug and no login', () => {
    const node = requesting({
      __typename: 'Team',
      name: 'Platform Infrastructure',
      slug: 'platform-infra',
    });

    expect(prReviewers(node)).toEqual([
      { login: 'platform-infra', avatarUrl: null, state: null, kind: 'team' },
    ]);
  });

  it('falls back to a team name when the slug is missing', () => {
    const node = requesting({ __typename: 'Team', name: 'Platform', slug: null });

    expect(prReviewers(node)[0]?.login).toBe('Platform');
  });

  it('keeps an enterprise team', () => {
    const node = requesting({
      __typename: 'EnterpriseTeam',
      name: 'Security Review',
      slug: 'security-review',
    });

    expect(prReviewers(node)).toEqual([
      { login: 'security-review', avatarUrl: null, state: null, kind: 'team' },
    ]);
  });

  it('keeps a requested bot', () => {
    const node = requesting({
      __typename: 'Bot',
      login: 'copilot-pull-request-reviewer',
      avatarUrl: 'https://avatars.example/copilot',
    });

    expect(prReviewers(node)).toEqual([
      {
        login: 'copilot-pull-request-reviewer',
        avatarUrl: 'https://avatars.example/copilot',
        state: null,
        kind: 'bot',
      },
    ]);
  });

  it('keeps a mannequin', () => {
    const node = requesting({
      __typename: 'Mannequin',
      login: 'imported-rowan',
      avatarUrl: null,
    });

    expect(prReviewers(node)[0]).toEqual({
      login: 'imported-rowan',
      avatarUrl: null,
      state: null,
      kind: 'user',
    });
  });

  it('degrades an unrecognized reviewer type to a placeholder instead of dropping it', () => {
    // A sixth union member added by GitHub arrives with nothing but a
    // __typename. Showing "someone was asked" is honest; showing nobody is not.
    const node = requesting({ __typename: 'SomethingNew' });

    const reviewers = prReviewers(node);
    expect(reviewers).toHaveLength(1);
    expect(reviewers[0]?.kind).toBe('unknown');
    expect(reviewers[0]?.login).toMatch(/\S/);
  });

  it('does not throw on a null or malformed review request', () => {
    // A null node carries nothing to show, so it is dropped. An object with no
    // recognizable __typename is a reviewer whose type this build does not
    // know, so it becomes a placeholder.
    const node = requesting(null, undefined, 'not-an-object', {});

    expect(() => prReviewers(node)).not.toThrow();
    expect(prReviewers(node)).toEqual([
      { login: expect.stringMatching(/\S/), avatarUrl: null, state: null, kind: 'unknown' },
    ]);
  });

  it('shows a verdict rather than a bare request for someone who did both', () => {
    const node = pullRequestNode({
      latestReviews: {
        nodes: [
          { author: { login: 'dana', avatarUrl: 'https://a/dana' }, state: 'APPROVED' },
        ],
      },
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'User',
              login: 'dana',
              avatarUrl: 'https://a/dana',
            },
          },
        ],
      },
    });

    expect(prReviewers(node)).toEqual([
      { login: 'dana', avatarUrl: 'https://a/dana', state: 'APPROVED', kind: 'user' },
    ]);
  });

  it('does not collide a team slug with a user login of the same text', () => {
    const node = requesting(
      { __typename: 'User', login: 'infra', avatarUrl: null },
      { __typename: 'Team', name: 'Infra', slug: 'infra' },
    );

    expect(prReviewers(node).map((r) => r.kind)).toEqual(['user', 'team']);
  });
});
