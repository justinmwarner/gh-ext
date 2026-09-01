/**
 * Reading the fields the shell needs off `PullRequestNode`.
 *
 * The worker types that node with an index signature on purpose: the query
 * selects far more than the plumbing understands, and pretending otherwise
 * would be a lie the compiler enforces. So the narrowing happens here, once,
 * defensively — GraphQL nulls out a field it could not resolve while still
 * returning HTTP 200, and `latestReviews.nodes[0].author` is null for a review
 * left by a deleted account.
 */

import type { PullRequestNode } from '@/lib/messages';
import { safeGitHubUrl } from './githubUrl';

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT';

export interface Reviewer {
  login: string;
  avatarUrl: string | null;
  /** Their latest review state, or null when they have only been asked. */
  state: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const nodesOf = (value: unknown): unknown[] => {
  if (!isRecord(value)) return [];
  const nodes = value['nodes'];
  return Array.isArray(nodes) ? nodes : [];
};

/**
 * Which badge to draw.
 *
 * `merged` and `state` are checked together because a merged pull request has
 * `state: MERGED`, but a draft has `state: OPEN` with `isDraft: true` — the
 * distinction the reviewer cares about is not in one field.
 */
export function prState(node: PullRequestNode): PrState {
  const state = readString(node['state']);
  if (state === 'MERGED' || node['merged'] === true) return 'MERGED';
  if (state === 'CLOSED') return 'CLOSED';
  if (node['isDraft'] === true) return 'DRAFT';
  return 'OPEN';
}

export function prBranches(node: PullRequestNode): {
  base: string | null;
  head: string | null;
} {
  return {
    base: readString(node['baseRefName']),
    head: readString(node['headRefName']),
  };
}

export function prPermalink(node: PullRequestNode): string | null {
  return safeGitHubUrl(node['permalink']);
}

function readPerson(value: unknown): { login: string; avatarUrl: string | null } | null {
  if (!isRecord(value)) return null;
  const login = readString(value['login']);
  if (login === null) return null;
  return { login, avatarUrl: readString(value['avatarUrl']) };
}

/**
 * Everyone whose opinion is outstanding or already in, deduplicated by login.
 *
 * Reviews come first so that someone who has reviewed and then been asked again
 * shows their verdict rather than a bare request.
 */
export function prReviewers(node: PullRequestNode): Reviewer[] {
  const byLogin = new Map<string, Reviewer>();

  for (const review of nodesOf(node['latestReviews'])) {
    if (!isRecord(review)) continue;
    const person = readPerson(review['author']);
    if (person === null || byLogin.has(person.login)) continue;
    byLogin.set(person.login, { ...person, state: readString(review['state']) });
  }

  for (const requested of nodesOf(node['reviewRequests'])) {
    if (!isRecord(requested)) continue;
    // Teams and bots come through the same field without a login; skipped.
    const person = readPerson(requested['requestedReviewer']);
    if (person === null || byLogin.has(person.login)) continue;
    byLogin.set(person.login, { ...person, state: null });
  }

  return [...byLogin.values()];
}
