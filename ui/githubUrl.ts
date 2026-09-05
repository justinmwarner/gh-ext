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
 * Accept a `permalink` from the API only if it points at github.com.
 *
 * The field is trusted in practice, but it is server-supplied data reaching an
 * `href`, and rejecting anything else costs one comparison.
 */
export function safeGitHubUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.startsWith(`${GITHUB_ORIGIN}/`) ? value : null;
}
