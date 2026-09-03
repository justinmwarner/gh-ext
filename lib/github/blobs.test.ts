import { describe, expect, it } from 'vitest';
import { BlobCache, MAX_BLOB_BYTES, fetchBlob } from './blobs';
import { RateLimitError } from './client';

interface Reply {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/** A `fetch` that answers once, and records what it was asked. */
function stubFetch(reply: Reply) {
  const calls: string[] = [];
  const impl: typeof fetch = (input, init) => {
    calls.push(String(input));
    const headers = new Headers(reply.headers ?? {});
    const accept = new Headers(init?.headers).get('accept');
    if (accept !== null) calls.push(`accept:${accept}`);
    return Promise.resolve(
      new Response(reply.body ?? '', { status: reply.status ?? 200, headers }),
    );
  };
  return { impl, calls };
}

const REQUEST = { owner: 'acme', repo: 'widgets', path: 'src/app.ts', ref: 'abc123' };

describe('fetchBlob', () => {
  it('reads the raw contents at a commit', async () => {
    const { impl, calls } = stubFetch({ body: 'one\ntwo\n' });

    expect(await fetchBlob(impl, REQUEST)).toEqual({ status: 'ok', text: 'one\ntwo\n' });
    expect(calls[0]).toBe(
      'https://api.github.com/repos/acme/widgets/contents/src/app.ts?ref=abc123',
    );
    // The raw media type, not JSON: JSON caps at a megabyte and base64-encodes.
    expect(calls).toContain('accept:application/vnd.github.raw');
  });

  it('keeps path separators while escaping everything else', async () => {
    const { impl, calls } = stubFetch({ body: '' });

    await fetchBlob(impl, { ...REQUEST, path: 'src/a b/c#d.ts' });

    // Encoded per segment: a whole-path encode would turn every slash into
    // %2F and the endpoint would read it as one very strange filename.
    expect(calls[0]).toContain('/contents/src/a%20b/c%23d.ts?ref=');
  });

  it('escapes a ref that is not a bare SHA', async () => {
    const { impl, calls } = stubFetch({ body: '' });

    await fetchBlob(impl, { ...REQUEST, ref: 'release/1.0' });

    expect(calls[0]).toContain('?ref=release%2F1.0');
  });

  it('calls a missing path absent rather than failing', async () => {
    // A file added in this pull request has no base side, and a deleted one
    // has no head side. Neither is an error.
    const { impl } = stubFetch({ status: 404, body: '{}' });

    expect(await fetchBlob(impl, REQUEST)).toEqual({ status: 'absent' });
  });

  it('calls a blob GitHub refuses to serve too large', async () => {
    const { impl } = stubFetch({
      status: 403,
      body: '{}',
      headers: { 'x-ratelimit-remaining': '4998' },
    });

    expect(await fetchBlob(impl, REQUEST)).toEqual({ status: 'too-large' });
  });

  it('reports a quota 403 as a rate limit, not as an oversized file', async () => {
    const { impl } = stubFetch({
      status: 403,
      body: '{}',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
    });

    await expect(fetchBlob(impl, REQUEST)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('refuses a blob whose declared size is past the budget', async () => {
    const { impl } = stubFetch({
      body: 'small',
      headers: { 'content-length': String(MAX_BLOB_BYTES + 1) },
    });

    expect(await fetchBlob(impl, REQUEST)).toEqual({ status: 'too-large' });
  });

  it('refuses one that only turns out to be oversized after reading', async () => {
    // `content-length` is absent on a chunked response, so the header is a
    // hint and the body is the fact.
    const { impl } = stubFetch({ body: 'x'.repeat(MAX_BLOB_BYTES + 1) });

    expect(await fetchBlob(impl, REQUEST)).toEqual({ status: 'too-large' });
  });

  it('calls a blob with a NUL byte in it binary', async () => {
    const { impl } = stubFetch({ body: 'PK' + '\u0000' + 'cafe' });

    expect(await fetchBlob(impl, REQUEST)).toEqual({ status: 'binary' });
  });

  it('throws for a status it has no honest answer for', async () => {
    const { impl } = stubFetch({ status: 500, body: 'boom' });

    await expect(fetchBlob(impl, REQUEST)).rejects.toThrow(/500/);
  });
});

describe('BlobCache', () => {
  const ok = (text: string) => ({ status: 'ok', text }) as const;

  it('returns a blob it has already read', () => {
    const cache = new BlobCache();
    cache.set('sha1', 'a.ts', ok('one'));

    expect(cache.get('sha1', 'a.ts')).toEqual(ok('one'));
  });

  it('keys on the commit as well as the path', () => {
    // The same file at two commits is two different blobs, which is the whole
    // reason both sides can be cached at once.
    const cache = new BlobCache();
    cache.set('sha1', 'a.ts', ok('before'));
    cache.set('sha2', 'a.ts', ok('after'));

    expect(cache.get('sha1', 'a.ts')).toEqual(ok('before'));
    expect(cache.get('sha2', 'a.ts')).toEqual(ok('after'));
  });

  it('remembers that a side does not exist, so it is not asked for twice', () => {
    const cache = new BlobCache();
    cache.set('sha1', 'added.ts', { status: 'absent' });

    expect(cache.get('sha1', 'added.ts')).toEqual({ status: 'absent' });
  });

  it('evicts the oldest entry once the count budget is spent', () => {
    const cache = new BlobCache(2);
    cache.set('sha', 'a.ts', ok('a'));
    cache.set('sha', 'b.ts', ok('b'));
    cache.set('sha', 'c.ts', ok('c'));

    expect(cache.size).toBe(2);
    expect(cache.get('sha', 'a.ts')).toBeUndefined();
    expect(cache.get('sha', 'c.ts')).toEqual(ok('c'));
  });

  it('evicts on bytes too, which a count alone would never notice', () => {
    const cache = new BlobCache(100, 10);
    cache.set('sha', 'a.ts', ok('x'.repeat(8)));
    cache.set('sha', 'b.ts', ok('y'.repeat(8)));

    expect(cache.get('sha', 'a.ts')).toBeUndefined();
    expect(cache.get('sha', 'b.ts')).not.toBeUndefined();
  });

  it('keeps one entry even when it alone is over the byte budget', () => {
    // Otherwise the entry just written is immediately evicted and the cache
    // silently never holds anything at all.
    const cache = new BlobCache(100, 10);
    cache.set('sha', 'big.ts', ok('x'.repeat(50)));

    expect(cache.get('sha', 'big.ts')).not.toBeUndefined();
  });

  it('does not double-count a blob written twice', () => {
    const cache = new BlobCache(100, 10);
    cache.set('sha', 'a.ts', ok('x'.repeat(6)));
    cache.set('sha', 'a.ts', ok('x'.repeat(6)));
    cache.set('sha', 'b.ts', ok('y'));

    expect(cache.get('sha', 'a.ts')).not.toBeUndefined();
    expect(cache.get('sha', 'b.ts')).not.toBeUndefined();
  });
});

describe('BlobCache.clear', () => {
  it('drops every blob and the byte count with them', () => {
    // For a token change. File contents are the largest thing this extension
    // holds, and they were read with a token that may no longer be the
    // reviewer's — so they must not survive it. Resetting the byte count
    // matters as much as emptying the map: a stale count would evict live
    // entries for space that is already free.
    const cache = new BlobCache();
    cache.set('sha', 'a.ts', { status: 'ok', text: 'x'.repeat(1000) });
    cache.set('sha', 'b.ts', { status: 'ok', text: 'y'.repeat(1000) });
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('sha', 'a.ts')).toBeUndefined();

    // The budget starts fresh: two more fit without evicting each other.
    cache.set('sha', 'c.ts', { status: 'ok', text: 'z' });
    cache.set('sha', 'd.ts', { status: 'ok', text: 'z' });
    expect(cache.size).toBe(2);
  });
});
