/**
 * Reading one file's full contents at one commit.
 *
 * This is what makes "expand unchanged context" possible. A diff parsed from a
 * GitHub patch carries only the lines the patch sent, so Pierre marks it
 * `isPartial` and refuses to render any expand affordance at all; supplying it
 * with both sides of the file is the only way to unlock expansion, and both
 * sides mean two blobs at two commits.
 *
 * Pure, like the rest of `lib/`. `fetchImpl` is injected and is expected to
 * already carry authorization — the same contract `files-fallback.ts` has, and
 * for the same reason: the token lives in the worker and nowhere else.
 *
 * The interesting part is that "I could not get it" has four different honest
 * answers and only one of them is an error. A file added in this pull request
 * has no base side, a deleted one has no head side, and a binary or oversized
 * blob cannot be turned into text at all. Each is a fact about the file, not a
 * failure of the request, so each comes back as a value.
 */

import { RateLimitError } from './client';

export type BlobResult =
  | { status: 'ok'; text: string }
  /** No such path at that commit — an added file's base side, or a delete's head. */
  | { status: 'absent' }
  /** Real, but too big to move through the message channel or to diff usefully. */
  | { status: 'too-large' }
  /** Real, but not text. There is nothing to expand. */
  | { status: 'binary' };

export interface BlobRequest {
  owner: string;
  repo: string;
  /** Path at that commit. For a rename, the base side uses the *old* path. */
  path: string;
  /** A commit SHA. Anything the contents endpoint accepts as `ref`. */
  ref: string;
}

/**
 * The most we will move through `runtime.sendMessage` for one side of one file.
 *
 * Chrome serializes every message as JSON and the review page is asking for two
 * of these at once. A megabyte of source is already far past the point where
 * reading a diff of it is the reviewer's plan, and refusing loudly is better
 * than a page that locks up while a 40 MB minified bundle is stringified.
 */
export const MAX_BLOB_BYTES = 1_000_000;

/**
 * Percent-encode a path for a URL without destroying its separators.
 *
 * `encodeURIComponent` would turn every `/` into `%2F`, which the contents
 * endpoint reads as a single filename. Encoding per segment keeps the shape of
 * the path and still escapes the `#`, `?` and space that a real repository
 * genuinely contains.
 */
export const encodePath = (path: string): string =>
  path.split('/').map(encodeURIComponent).join('/');

/**
 * Whether a response is GitHub saying the quota is spent, and when it refills.
 *
 * A wrapper object rather than a bare `Date | null`, because "throttled, and
 * GitHub sent no usable reset header" is a real answer and is not the same as
 * "not throttled" — collapsing the two would turn a throttle into a 403 read as
 * a fact about the file.
 *
 * Shared with the byte-reading sibling in `binary-blobs.ts`: both have to make
 * this distinction before a 403 can mean "too large", or a throttled reviewer
 * goes looking for a problem with their repository.
 */
export function rateLimitFrom(res: Response): { resetAt: Date | null } | null {
  if (res.status !== 403 || res.headers.get('x-ratelimit-remaining') !== '0') return null;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  return { resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null };
}

/** A NUL byte cannot occur in text GitHub would let you diff. */
const looksBinary = (text: string): boolean => text.includes('\u0000');

/** UTF-8 length, not UTF-16 — the size the message channel actually pays for. */
const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * One blob, as text.
 *
 * The raw media type rather than the JSON one on purpose: JSON caps at a
 * megabyte and hands back base64 that would have to be decoded here, while raw
 * returns the bytes and lets `content-length` answer the size question before
 * anything is read.
 */
export async function fetchBlob(
  fetchImpl: typeof fetch,
  { owner, repo, path, ref }: BlobRequest,
): Promise<BlobResult> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}` +
    `?ref=${encodeURIComponent(ref)}`;

  const res = await fetchImpl(url, { headers: { accept: 'application/vnd.github.raw' } });

  // Checked before the 403 below: a quota failure is about the request rather
  // than about the file, and reporting it as "too large" would send the
  // reviewer looking for a problem with their repository.
  const limit = rateLimitFrom(res);
  if (limit !== null) throw new RateLimitError('GitHub rate limit exceeded', limit.resetAt);

  // 404 is the ordinary answer for a side that does not exist at that commit.
  if (res.status === 404) return { status: 'absent' };
  // GitHub refuses outright above 100 MB, and answers 403 when it does.
  if (res.status === 403) return { status: 'too-large' };
  if (!res.ok) throw new Error(`GitHub blob request failed: ${res.status}`);

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BLOB_BYTES) {
    return { status: 'too-large' };
  }

  const text = await res.text();
  // Re-checked after reading: `content-length` is absent on a chunked response,
  // so the header alone is a hint rather than a guarantee.
  if (byteLength(text) > MAX_BLOB_BYTES) return { status: 'too-large' };
  if (looksBinary(text)) return { status: 'binary' };

  return { status: 'ok', text };
}

/** The cache key for one blob. A path at a commit names exactly one. */
export const blobKey = (ref: string, path: string): string =>
  `${ref}\u0000${path}`;

/**
 * Blobs already read, kept until the budget says otherwise.
 *
 * A blob at a commit is immutable — that is the whole reason this is safe to
 * cache without a TTL — so the only question is how much to keep. Both a count
 * and a byte budget, because a hundred small files and one enormous one are
 * different ways to run out of room and only one of them is caught by a count.
 *
 * Insertion-ordered eviction rather than true LRU: expanding context walks
 * forwards through a review, so the oldest entry really is the least likely to
 * be wanted again, and a `Map` gives that ordering for free.
 */
export class BlobCache<T extends CacheableBlob = BlobResult> {
  private readonly entries = new Map<string, T>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 64,
    private readonly maxBytes = 16_000_000,
  ) {}

  get(ref: string, path: string): T | undefined {
    return this.entries.get(blobKey(ref, path));
  }

  set(ref: string, path: string, result: T): void {
    const key = blobKey(ref, path);
    const existing = this.entries.get(key);
    if (existing !== undefined) this.bytes -= sizeOf(existing);

    this.entries.delete(key);
    this.entries.set(key, result);
    this.bytes += sizeOf(result);

    while (
      this.entries.size > this.maxEntries ||
      (this.bytes > this.maxBytes && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      const evicted = this.entries.get(oldest.value);
      if (evicted !== undefined) this.bytes -= sizeOf(evicted);
      this.entries.delete(oldest.value);
    }
  }

  /**
   * Forget everything, for when the token changes.
   *
   * A blob at a commit cannot change, which is why there is no TTL — but who
   * is allowed to read it can, and these were fetched with a token that may no
   * longer be the reviewer's. The byte count is reset with the map: leaving it
   * would have the next writes evicting live entries to reclaim space that is
   * already free.
   */
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  /** Exposed so a test can hold the budget to its word. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * What this cache can hold.
 *
 * Written structurally rather than as a union of the two result types, so the
 * byte-reading sibling in `binary-blobs.ts` can use the same cache without this
 * module having to import it — and so a third shape later needs only to carry
 * one of these two fields rather than to be added here.
 */
export type CacheableBlob = { status: string; text?: string; base64?: string };

/**
 * How much room one entry takes.
 *
 * Only the `ok` results hold anything; `absent` and `too-large` are facts about
 * the file and are cached for free, which is the point of caching them.
 */
const sizeOf = (result: CacheableBlob): number =>
  result.status === 'ok' ? (result.text ?? result.base64 ?? '').length : 0;
