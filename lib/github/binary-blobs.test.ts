/**
 * Reading a file at a commit as bytes rather than as text.
 *
 * The review page never calls `fetch` — the worker holds the token and does
 * every request there is — so the only way an image reaches an `<img>` on that
 * page is as bytes down the message channel. `runtime.sendMessage` serializes
 * as JSON, which no byte array survives, so this is where the encoding lives
 * and where it is held to being reversible.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BINARY_BYTES,
  decodeBase64,
  encodeBase64,
  fetchBinaryBlob,
} from './binary-blobs';
import { RateLimitError } from './client';

const REQUEST = { owner: 'acme', repo: 'widgets', path: 'assets/logo.png', ref: 'abc123' };

function stubFetch(reply: {
  status?: number;
  body?: BodyInit;
  headers?: Record<string, string>;
}) {
  const calls: string[] = [];
  const impl: typeof fetch = (input, init) => {
    calls.push(String(input));
    const accept = new Headers(init?.headers).get('accept');
    if (accept !== null) calls.push(`accept:${accept}`);
    return Promise.resolve(
      new Response(reply.body ?? new Uint8Array(), {
        status: reply.status ?? 200,
        headers: new Headers(reply.headers ?? {}),
      }),
    );
  };
  return { impl, calls };
}

describe('encodeBase64 and decodeBase64', () => {
  it('round-trips arbitrary bytes, including the ones text cannot hold', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255, 0, 0, 65]);

    expect([...decodeBase64(encodeBase64(bytes))]).toEqual([...bytes]);
  });

  it('round-trips a payload large enough to break the naive encoding', () => {
    // `String.fromCharCode(...bytes)` overflows the argument stack somewhere
    // around a hundred thousand bytes, which is a small PNG. The failure is a
    // RangeError from inside a render, so it is worth an explicit test rather
    // than trust.
    const bytes = new Uint8Array(500_000);
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = at % 256;

    const round = decodeBase64(encodeBase64(bytes));

    expect(round.length).toBe(bytes.length);
    expect(round[0]).toBe(0);
    expect(round[499_999]).toBe(bytes[499_999]);
  });

  it('encodes an empty array as an empty string', () => {
    expect(encodeBase64(new Uint8Array())).toBe('');
    expect(decodeBase64('').length).toBe(0);
  });
});

describe('fetchBinaryBlob', () => {
  it('asks for the raw media type at the commit', async () => {
    const { impl, calls } = stubFetch({ body: new Uint8Array([1, 2, 3]) });

    await fetchBinaryBlob(impl, REQUEST);

    expect(calls[0]).toBe(
      'https://api.github.com/repos/acme/widgets/contents/assets/logo.png?ref=abc123',
    );
    expect(calls).toContain('accept:application/vnd.github.raw');
  });

  it('encodes the bytes it read and reports how many there were', async () => {
    const { impl } = stubFetch({ body: new Uint8Array([255, 0, 128]) });

    const result = await fetchBinaryBlob(impl, REQUEST);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect([...decodeBase64(result.base64)]).toEqual([255, 0, 128]);
    expect(result.byteLength).toBe(3);
  });

  it('reads a missing side as absent rather than as a failure', async () => {
    // An added file has no base side. That is a fact about the change, not an
    // error, and the card has its own sentence for it.
    const { impl } = stubFetch({ status: 404 });

    expect((await fetchBinaryBlob(impl, REQUEST)).status).toBe('absent');
  });

  it('refuses a file larger than the message channel should carry', async () => {
    const { impl } = stubFetch({
      headers: { 'content-length': String(MAX_BINARY_BYTES + 1) },
    });

    const result = await fetchBinaryBlob(impl, REQUEST);

    expect(result.status).toBe('too-large');
  });

  it('refuses it after reading too, because content-length can be absent', async () => {
    // A chunked response carries no length, so the header is a hint that lets
    // us decline early rather than a guarantee that lets us skip the check.
    const { impl } = stubFetch({ body: new Uint8Array(MAX_BINARY_BYTES + 10) });

    const result = await fetchBinaryBlob(impl, REQUEST);

    expect(result.status).toBe('too-large');
    if (result.status !== 'too-large') return;
    expect(result.byteLength).toBe(MAX_BINARY_BYTES + 10);
  });

  it('reports a spent quota as a rate limit rather than as a huge file', async () => {
    const { impl } = stubFetch({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' },
    });

    await expect(fetchBinaryBlob(impl, REQUEST)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('reads a bare 403 as GitHub refusing an oversized blob', async () => {
    const { impl } = stubFetch({ status: 403 });

    expect((await fetchBinaryBlob(impl, REQUEST)).status).toBe('too-large');
  });

  it('throws on anything else, which is a real failure', async () => {
    const { impl } = stubFetch({ status: 500 });

    await expect(fetchBinaryBlob(impl, REQUEST)).rejects.toThrow(/500/);
  });

  it('escapes each path segment without destroying the separators', async () => {
    const { impl, calls } = stubFetch({ body: new Uint8Array() });

    await fetchBinaryBlob(impl, { ...REQUEST, path: 'my assets/a b.png' });

    expect(calls[0]).toContain('/contents/my%20assets/a%20b.png?');
  });
});
