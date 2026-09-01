import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from './review/drafts';
import { DEFAULT_TTL_MS, PrCache, prCacheKey } from './cache';

function memoryStore(): KeyValueStore & { raw: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    raw: map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
    remove: async (k) => {
      map.delete(k);
    },
    keys: async () => [...map.keys()],
  };
}

/** A clock the test drives by hand, so no test waits on real time. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const ref = { owner: 'octocat', repo: 'hello-world', number: 42, headSha: 'abc123' };

describe('prCacheKey', () => {
  it('is owner/repo/number@headSha', () => {
    expect(prCacheKey(ref)).toBe('octocat/hello-world/42@abc123');
  });

  it('separates two head SHAs of the same pull request', () => {
    expect(prCacheKey(ref)).not.toBe(prCacheKey({ ...ref, headSha: 'def456' }));
  });
});

describe('PrCache', () => {
  it('reports a miss for something never stored', async () => {
    const cache = new PrCache(memoryStore());
    expect(await cache.get('diff', ref)).toEqual({ hit: false });
  });

  it('round-trips a value', async () => {
    const cache = new PrCache(memoryStore());
    await cache.set('diff', ref, { source: 'unified' });
    expect(await cache.get('diff', ref)).toEqual({
      hit: true,
      value: { source: 'unified' },
    });
  });

  it('distinguishes a cached null from a miss', async () => {
    const cache = new PrCache(memoryStore());
    await cache.set('checks', ref, null);
    expect(await cache.get('checks', ref)).toEqual({ hit: true, value: null });
    expect(await cache.get('checks', { ...ref, headSha: 'other' })).toEqual({ hit: false });
  });

  it('keys on the head SHA, so a new push misses', async () => {
    const cache = new PrCache(memoryStore());
    await cache.set('diff', ref, 'old');
    expect(await cache.get('diff', { ...ref, headSha: 'def456' })).toEqual({ hit: false });
  });

  it('keeps slots apart at the same key', async () => {
    const cache = new PrCache(memoryStore());
    await cache.set('threads', ref, ['thread']);
    expect(await cache.get('checks', ref)).toEqual({ hit: false });
  });

  it('never expires the diff, because it cannot change for a head SHA', async () => {
    const time = clock();
    const cache = new PrCache(memoryStore(), { now: time.now, ttlMs: 1000 });
    await cache.set('diff', ref, 'patch');
    time.advance(365 * 24 * 60 * 60 * 1000);
    expect(await cache.get('diff', ref)).toEqual({ hit: true, value: 'patch' });
  });

  it('serves threads inside the TTL', async () => {
    const time = clock();
    const cache = new PrCache(memoryStore(), { now: time.now, ttlMs: 1000 });
    await cache.set('threads', ref, ['thread']);
    time.advance(999);
    expect(await cache.get('threads', ref)).toEqual({ hit: true, value: ['thread'] });
  });

  it('reports expired threads as a miss', async () => {
    const time = clock();
    const cache = new PrCache(memoryStore(), { now: time.now, ttlMs: 1000 });
    await cache.set('threads', ref, ['thread']);
    time.advance(1000);
    expect(await cache.get('threads', ref)).toEqual({ hit: false });
  });

  it('reports expired checks as a miss', async () => {
    const time = clock();
    const cache = new PrCache(memoryStore(), { now: time.now, ttlMs: 1000 });
    await cache.set('checks', ref, { state: 'PENDING' });
    time.advance(5000);
    expect(await cache.get('checks', ref)).toEqual({ hit: false });
  });

  it('drops an expired entry instead of leaving it to accumulate', async () => {
    const time = clock();
    const store = memoryStore();
    const cache = new PrCache(store, { now: time.now, ttlMs: 1000 });
    await cache.set('threads', ref, ['thread']);
    time.advance(2000);
    await cache.get('threads', ref);
    expect(store.raw.size).toBe(0);
  });

  it('treats an unreadable entry as a miss and clears it', async () => {
    const store = memoryStore();
    const cache = new PrCache(store);
    await cache.set('threads', ref, ['thread']);
    const key = [...store.raw.keys()][0]!;
    store.raw.set(key, 'not json');
    expect(await cache.get('threads', ref)).toEqual({ hit: false });
    expect(store.raw.size).toBe(0);
  });

  it('treats an entry written by an older format as a miss', async () => {
    const store = memoryStore();
    const cache = new PrCache(store);
    await cache.set('threads', ref, ['thread']);
    const key = [...store.raw.keys()][0]!;
    store.raw.set(key, JSON.stringify({ value: ['thread'] }));
    expect(await cache.get('threads', ref)).toEqual({ hit: false });
  });

  it('invalidates a single slot without touching the others', async () => {
    const cache = new PrCache(memoryStore());
    await cache.set('diff', ref, 'patch');
    await cache.set('threads', ref, ['thread']);
    await cache.invalidate('threads', ref);
    expect(await cache.get('threads', ref)).toEqual({ hit: false });
    expect(await cache.get('diff', ref)).toEqual({ hit: true, value: 'patch' });
  });

  it('defaults to a short TTL for mutable slots', async () => {
    const time = clock();
    const cache = new PrCache(memoryStore(), { now: time.now });
    await cache.set('threads', ref, ['thread']);
    time.advance(DEFAULT_TTL_MS - 1);
    expect(await cache.get('threads', ref)).toEqual({ hit: true, value: ['thread'] });
    time.advance(1);
    expect(await cache.get('threads', ref)).toEqual({ hit: false });
  });
});
