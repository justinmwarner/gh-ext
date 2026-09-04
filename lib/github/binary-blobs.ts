/**
 * Reading a file at a commit as bytes, and getting them across the wire.
 *
 * This is the whole of how an image reaches an `<img>` on the review page. The
 * page never calls `fetch` — the worker holds the token and makes every request
 * there is — and a remote URL on the page would be a network call from a
 * context that is not allowed to make one, quite apart from telling github.com
 * that this extension exists. So the worker reads the blob, and the bytes come
 * back down the message channel to be turned into an object URL on the page.
 *
 * `runtime.sendMessage` serializes as JSON, which no byte array survives — a
 * `Uint8Array` arrives as `{"0":137,"1":80,…}`, four times the size and not a
 * buffer. Base64 is the encoding that survives it, at a third more bytes than
 * the file itself. That inflation is the reason the cap here is lower than a
 * reviewer might expect.
 *
 * A sibling of `blobs.ts` rather than a second implementation of it: the URL
 * building, the path escaping and the four ways a read can fail are all shared
 * from there, and only the body handling differs.
 */

import { RateLimitError } from './client';
import { encodePath, rateLimitFrom } from './blobs';

export type BinaryBlobResult =
  | { status: 'ok'; base64: string; byteLength: number }
  /** No such path at that commit — an added file's base side, or a delete's head. */
  | { status: 'absent' }
  /** Real, but past what the message channel should carry. */
  | { status: 'too-large'; byteLength: number };

export interface BinaryBlobRequest {
  owner: string;
  repo: string;
  /** Path at that commit. For a rename, the base side uses the *old* path. */
  path: string;
  ref: string;
}

/**
 * The most we will move through `runtime.sendMessage` for one image.
 *
 * Four megabytes of file is five and a half of base64, and two sides are asked
 * for at once — so a card at the ceiling costs eleven megabytes of JSON string
 * built in the worker, parsed on the page and then thrown away. That is already
 * a stall a reviewer can feel, and a screenshot larger than four megabytes is
 * not one whose pixels anybody is comparing.
 *
 * Higher than the text cap in `blobs.ts` on purpose. A megabyte of source is
 * far past the point of reading a diff; a megabyte of PNG is an ordinary
 * screenshot.
 */
export const MAX_BINARY_BYTES = 4_000_000;

/**
 * Bytes as base64.
 *
 * Chunked, and that is not a micro-optimization. `String.fromCharCode(...bytes)`
 * spreads every byte into an argument list and overflows the call stack
 * somewhere around a hundred thousand of them — which is a small PNG. The
 * failure is a `RangeError` thrown from inside the worker on exactly the files
 * this feature exists for.
 */
export function encodeBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

/** Base64 back to bytes, on the page. */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/**
 * One blob, as bytes.
 *
 * The same four answers `fetchBlob` gives, minus `binary` — which is the point
 * of this path rather than a failure of it.
 */
export async function fetchBinaryBlob(
  fetchImpl: typeof fetch,
  { owner, repo, path, ref }: BinaryBlobRequest,
): Promise<BinaryBlobResult> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}` +
    `?ref=${encodeURIComponent(ref)}`;

  const res = await fetchImpl(url, { headers: { accept: 'application/vnd.github.raw' } });

  // Before the 403 below: a spent quota is about the request rather than about
  // the file, and reporting it as "too large" sends the reviewer looking for a
  // problem with their repository.
  const limit = rateLimitFrom(res);
  if (limit !== null) throw new RateLimitError('GitHub rate limit exceeded', limit.resetAt);

  if (res.status === 404) return { status: 'absent' };
  // GitHub refuses outright above 100 MB, and answers 403 when it does.
  if (res.status === 403) return { status: 'too-large', byteLength: 0 };
  if (!res.ok) throw new Error(`GitHub blob request failed: ${res.status}`);

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BINARY_BYTES) {
    return { status: 'too-large', byteLength: declared };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  // Re-checked after reading: `content-length` is absent on a chunked response,
  // so the header lets us decline early rather than letting us skip the check.
  if (bytes.length > MAX_BINARY_BYTES) {
    return { status: 'too-large', byteLength: bytes.length };
  }

  return { status: 'ok', base64: encodeBase64(bytes), byteLength: bytes.length };
}
