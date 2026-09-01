/**
 * Pull request URL parsing, on both sides of the extension boundary: the
 * github.com URL the content script sees, and the hash route the review page
 * is opened at.
 *
 * Pure string work, deliberately kept out of the entrypoints so it can be
 * tested without a browser.
 */

import type { PrRef } from '../messages';

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

  return {
    owner: decodeURIComponent(owner),
    repo: decodeURIComponent(repo),
    number: Number(number),
  };
}
