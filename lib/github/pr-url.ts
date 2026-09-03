/**
 * Pull request URL parsing, on both sides of the extension boundary: the
 * github.com URL the content script sees, and the hash route the review page
 * is opened at.
 *
 * Pure string work, deliberately kept out of the entrypoints so it can be
 * tested without a browser.
 */

import type { PrRef } from '../messages';

/** The only host this extension knows how to talk to. */
const GITHUB_HOST = 'github.com';

/**
 * A pull request path, and whatever sub-page follows it.
 *
 * `/pull/{n}` is the conversation tab, `/pull/{n}/files` the diff,
 * `/pull/{n}/commits` the commit list, and there are deeper ones such as
 * `/pull/{n}/files/{base}..{head}`. All of them are the same pull request.
 */
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?\/?$/;

/**
 * Extract pull request coordinates from a github.com URL, or null if the URL is
 * not a pull request page.
 *
 * Parsed through `URL` rather than matched against the whole string, so the
 * query and the fragment cannot leak into the path match and a lookalike host
 * such as `github.com.example` cannot pass.
 *
 * The protocol is not checked: the manifest's match pattern is what restricts
 * the content script to https, and this function's job is only to read
 * coordinates out of a path.
 */
export function parsePrUrl(url: string): PrRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL. Nothing to read.
    return null;
  }

  if (parsed.hostname !== GITHUB_HOST) return null;

  const match = PR_PATH.exec(parsed.pathname);
  if (!match) return null;

  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return null;

  const ownerName = decoded(owner);
  const repoName = decoded(repo);
  if (ownerName === null || repoName === null) return null;

  return { owner: ownerName, repo: repoName, number: Number(number) };
}


/**
 * The pull request route on the review page.
 *
 * Exported and paired with {@link parseReviewHash} so the worker that builds
 * the URL and the page that reads it cannot drift apart.
 *
 * Segments are percent-encoded. GitHub owner and repo names are restricted
 * enough that it rarely matters, but an unescaped `/` would silently produce a
 * route that parses back into different coordinates.
 */
export function reviewHash(ref: PrRef): string {
  const owner = encodeURIComponent(ref.owner);
  const repo = encodeURIComponent(ref.repo);
  return `#/pr/${owner}/${repo}/${ref.number}`;
}

const REVIEW_ROUTE = /^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/;

/**
 * Read a review route back. Accepts `location.hash` directly, with or without
 * its leading `#`. Returns null for anything else, including the empty hash of
 * a review page opened without a pull request.
 */
export function parseReviewHash(hash: string): PrRef | null {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = REVIEW_ROUTE.exec(path);
  if (!match) return null;

  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return null;

  const ownerName = decoded(owner);
  const repoName = decoded(repo);
  if (ownerName === null || repoName === null) return null;

  return { owner: ownerName, repo: repoName, number: Number(number) };
}

/**
 * `decodeURIComponent`, without the throw.
 *
 * A malformed percent sequence — `%zz`, or a `%` at the end — raises
 * `URIError`. `parseReviewHash` runs inside a `useMemo` during render, and the
 * review page mounts with no error boundary, so one hand-edited URL or stale
 * bookmark takes the whole page to blank white with a console stack. Null
 * instead, which every caller already treats as "no route" and renders an
 * explanation for.
 */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
