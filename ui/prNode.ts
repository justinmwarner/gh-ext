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

/**
 * Which repository the head branch is on.
 *
 * Three answers rather than two, because "we do not know" is a real state and
 * has to be distinguishable from "the same one". A payload cached by a build
 * that predates `isCrossRepository` carries neither field, and treating that
 * silence as "same repository" would link a fork's branch into the base repo —
 * a 404 at best, and at worst a branch of the same name that exists there and
 * belongs to somebody else. `unknown` is what stops the link being drawn.
 */
export type HeadRepo =
  | { kind: 'same' }
  | { kind: 'fork'; owner: string; repo: string }
  | { kind: 'unknown' };

export function prHeadRepo(node: PullRequestNode): HeadRepo {
  const cross = node['isCrossRepository'];
  if (cross === false) return { kind: 'same' };
  if (cross !== true) return { kind: 'unknown' };

  const repository = node['headRepository'];
  // Null once the fork is deleted, which GitHub allows while leaving the pull
  // request readable. There is then nowhere to point at.
  if (!isRecord(repository)) return { kind: 'unknown' };

  const nameWithOwner = readString(repository['nameWithOwner']);
  if (nameWithOwner === null) return { kind: 'unknown' };

  // Exactly two parts. A repository name cannot contain a slash, so anything
  // else is a field this build does not understand rather than a name to guess
  // at.
  const parts = nameWithOwner.split('/');
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || repo === undefined) {
    return { kind: 'unknown' };
  }
  if (owner === '' || repo === '') return { kind: 'unknown' };

  return { kind: 'fork', owner, repo };
}

/**
 * What this account may do in the repository, as GitHub reports it.
 *
 * Null when the field is missing — an older cached payload — and null is
 * deliberately *not* treated as a restriction anywhere. See
 * {@link prViewerCanReview}.
 */
export function prViewerPermission(node: PullRequestNode): string | null {
  const repository = node['repository'];
  return isRecord(repository) ? readString(repository['viewerPermission']) : null;
}

/**
 * The base commit this pull request is diffed against, or null.
 *
 * Half of what expanding unchanged context needs: a blob is read at a commit,
 * and the head side alone would only ever fill in the additions.
 *
 * Null rather than a guess when the field is missing. A payload cached by a
 * build that predates the field has no `baseRefOid`, and falling back to the
 * base *branch* would read whatever has landed on it since — the expanded
 * context would be someone else's code, silently. Without a base commit the
 * loader is simply not offered, and Pierre goes back to showing no expander.
 */
export function prBaseSha(node: PullRequestNode): string | null {
  return readString(node['baseRefOid']);
}

export function prPermalink(node: PullRequestNode): string | null {
  return safeGitHubUrl(node['permalink']);
}

/**
 * Whether the viewer wrote this pull request.
 *
 * GitHub rejects an approval of your own work, so the submit bar disables
 * Approve rather than letting the mutation come back a 422. Read from
 * `viewerDidAuthor` rather than by comparing logins, because the query has the
 * author's login and not the viewer's.
 *
 * Strictly `=== true`: an older cached node predating that field in the query
 * has it undefined, and guessing "yes" there would disable a control the
 * reviewer is entitled to.
 */
export function prViewerIsAuthor(node: PullRequestNode): boolean {
  return node['viewerDidAuthor'] === true;
}

/**
 * Whether to offer to open a review at all.
 *
 * Two ways to answer no, and they are different kinds of no.
 *
 * The first is authorship. GitHub does allow you to open a pending review on
 * your own pull request and submit it as a comment, and the footer still
 * handles that case for a review already in progress — but "Start a review" on
 * your own work is a control offering something nobody wants: the two verdicts
 * that matter are refused, and what is left is a way to batch notes to
 * yourself. Writing on your own diff still works; the comments simply post as
 * they are written.
 *
 * The second is access. Anyone with read access to a repository may review a
 * pull request, so `READ` would be the wrong gate for GitHub in general — but
 * this extension is driven by a fine-grained token, and such a token can never
 * grant more than the role it was issued under. A `READ` viewer here therefore
 * has no way to post the review the button would open, and a pending review
 * that can never be submitted is worse than no button: every comment queued on
 * it is invisible until it is, and it never is.
 *
 * Anything unrecognized, including the field being absent, means yes. Guessing
 * no would remove a control the reviewer is entitled to, which is the same rule
 * {@link prViewerIsAuthor} follows and for the same reason.
 */
export function prViewerCanReview(node: PullRequestNode): boolean {
  if (prViewerIsAuthor(node)) return false;
  return prViewerPermission(node) !== 'READ';
}

/**
 * The commit the viewer's own last review was left on, or null.
 *
 * The base of "changes since my last review". Null for a first-time reviewer —
 * `viewerLatestReview` is null when they have never reviewed — and also for a
 * review GitHub could not attach to a commit, which is the same situation as
 * far as the toggle is concerned: there is no earlier point to compare from.
 */
export function prViewerReviewedAt(node: PullRequestNode): string | null {
  const review = node['viewerLatestReview'];
  if (!isRecord(review)) return null;
  const commit = review['commit'];
  return isRecord(commit) ? readString(commit['oid']) : null;
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
