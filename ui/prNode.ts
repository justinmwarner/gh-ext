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

/**
 * What sort of reviewer this is.
 *
 * `requestedReviewer` is a union of five types and only three of them are
 * people, so the difference has to survive into the UI: "platform-infra" with
 * no further qualification reads like a username.
 *
 * `unknown` is not a defect — it is the honest answer for a member of the union
 * this build predates. GitHub has grown that union before.
 */
export type ReviewerKind = 'user' | 'team' | 'bot' | 'unknown';

export interface Reviewer {
  /** A login for people and bots, a slug for teams, a placeholder otherwise. */
  login: string;
  avatarUrl: string | null;
  /** Their latest review state, or null when they have only been asked. */
  state: string | null;
  kind: ReviewerKind;
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

/** Shown when the union member is one this build does not recognize. */
const UNRECOGNIZED = 'Unrecognized reviewer';

const placeholder = (): Reviewer => ({
  login: UNRECOGNIZED,
  avatarUrl: null,
  state: null,
  kind: 'unknown',
});

/**
 * One `requestedReviewer`, whichever of the five union members it is.
 *
 * Selecting only `... on User` is what made teams and bots disappear: they
 * arrive with no `login`, a `login`-shaped reader returns null, and the entry
 * is dropped. A pull request whose only pending reviewer is a team then shows
 * no reviewers at all — indistinguishable from one nobody has been asked to
 * review. So every member maps to something nameable, and anything else
 * degrades to a placeholder rather than vanishing.
 *
 * Returns null only for a node GraphQL nulled out entirely, which carries
 * nothing to show.
 */
function readRequestedReviewer(value: unknown): Reviewer | null {
  if (!isRecord(value)) return null;

  const login = readString(value['login']);
  const avatarUrl = readString(value['avatarUrl']);

  switch (readString(value['__typename'])) {
    case 'User':
    // A mannequin stands in for a user imported from elsewhere. It has a
    // login and reads as a person, so it is presented as one.
    case 'Mannequin':
      return login === null
        ? placeholder()
        : { login, avatarUrl, state: null, kind: 'user' };

    case 'Bot':
      return login === null
        ? placeholder()
        : { login, avatarUrl, state: null, kind: 'bot' };

    case 'Team':
    case 'EnterpriseTeam': {
      // Teams have no login. The slug is what GitHub shows and what a reviewer
      // will recognize; the display name is the fallback.
      const name = readString(value['slug']) ?? readString(value['name']);
      return name === null
        ? placeholder()
        : { login: name, avatarUrl, state: null, kind: 'team' };
    }

    default:
      return placeholder();
  }
}

/**
 * Everyone whose opinion is outstanding or already in, deduplicated.
 *
 * Reviews come first so that someone who has reviewed and then been asked again
 * shows their verdict rather than a bare request. The key includes the kind
 * because a team slug and a user login are separate namespaces and may collide.
 */
export function prReviewers(node: PullRequestNode): Reviewer[] {
  const seen = new Map<string, Reviewer>();
  const add = (reviewer: Reviewer): void => {
    const key = `${reviewer.kind}:${reviewer.login}`;
    if (!seen.has(key)) seen.set(key, reviewer);
  };

  for (const review of nodesOf(node['latestReviews'])) {
    if (!isRecord(review)) continue;
    const person = readPerson(review['author']);
    if (person === null) continue;
    add({ ...person, state: readString(review['state']), kind: 'user' });
  }

  for (const requested of nodesOf(node['reviewRequests'])) {
    if (!isRecord(requested)) continue;
    const reviewer = readRequestedReviewer(requested['requestedReviewer']);
    if (reviewer === null) continue;
    add(reviewer);
  }

  return [...seen.values()];
}
