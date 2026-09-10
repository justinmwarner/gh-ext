/**
 * The github.com URL for a pull request.
 *
 * Every dead end in this UI offers a way back to GitHub, including the ones
 * reached before any payload arrived — so the link has to be derivable from the
 * route alone, not read out of a response that never came.
 */

import type { PrRef } from '@/lib/messages';

const GITHUB_ORIGIN = 'https://github.com';

export function pullRequestUrl(pr: PrRef): string {
  const owner = encodeURIComponent(pr.owner);
  const repo = encodeURIComponent(pr.repo);
  return `${GITHUB_ORIGIN}/${owner}/${repo}/pull/${pr.number}`;
}

/**
 * The github.com URL for one commit.
 *
 * `/commit/<oid>` rather than `/pull/42/commits/<oid>`. The second exists and
 * is the wrong destination: it is the commit as one step of a review, framed
 * by the pull request, and what a reviewer following a link off a commit row
 * wants is the commit.
 */
export function commitUrl(pr: PrRef, oid: string): string {
  const owner = encodeURIComponent(pr.owner);
  const repo = encodeURIComponent(pr.repo);
  return `${GITHUB_ORIGIN}/${owner}/${repo}/commit/${encodeURIComponent(oid)}`;
}

/**
 * The github.com URL for one branch, or null if it cannot be built safely.
 *
 * Segment by segment rather than one `encodeURIComponent`, because branch
 * names contain slashes — `release/2.4` is ordinary — and escaping those to
 * `%2F` gives a path GitHub does not resolve to the branch. Which means the
 * slashes are load-bearing, and a path built out of load-bearing slashes has
 * to say what it does about `..`.
 *
 * It refuses. `encodeURIComponent('..')` is `..`, so a name containing one
 * would climb out of `/owner/repo/tree/` and land somewhere else on
 * github.com. Git will not create such a branch and GitHub will not report
 * one, so this is unreachable in practice — but it is server data on its way
 * into an `href`, and null costs the caller a link it can already do without.
 *
 * The repository is a parameter rather than taken from the route: a pull
 * request from a fork has its head branch somewhere else entirely, and
 * pointing at the base repository would either 404 or, worse, land on a
 * same-named branch that exists there and is somebody else's code.
 */
export function branchUrl(
  repo: { owner: string; repo: string },
  branch: string,
): string | null {
  const segments = branch.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;

  const path = segments.map(encodeURIComponent).join('/');
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.repo);
  return `${GITHUB_ORIGIN}/${owner}/${name}/tree/${path}`;
}

/**
 * Accept a `permalink` from the API only if it points at github.com.
 *
 * The field is trusted in practice, but it is server-supplied data reaching an
 * `href`, and rejecting anything else costs one comparison.
 */
export function safeGitHubUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.startsWith(`${GITHUB_ORIGIN}/`) ? value : null;
}
