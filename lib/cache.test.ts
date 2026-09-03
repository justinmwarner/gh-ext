import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from './review/drafts';
import {
  DEFAULT_TTL_MS,
  PrCache,
  forgetCachedReads,
  prCacheKey,
  writeGenerations,
} from './cache';

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

describe('forgetCachedReads', () => {
  /**
   * Cache keys name a pull request and a head SHA — never an account. That is
   * fine while one token is in play and wrong the moment it changes: clearing
   * the token leaves a full pull request readable from `storage.session`, and
   * replacing it with another account's token serves the first account's
   * viewed states, pending review and author flag to the second.
   *
   * Keying the cache on the token would mean putting a credential's shadow in
   * a storage key. Forgetting is the cheaper answer and has no such problem.
   */
  it('empties the store', async () => {
    const store = memoryStore();
    await store.set('pr:acme/widgets/42@abc', '{"value":1}');
    await store.set('diff:acme/widgets/42@abc', '{"value":2}');
    await store.set('head:acme/widgets/42', 'abc');

    await forgetCachedReads(store);

    expect(await store.keys()).toEqual([]);
  });

  it('leaves a store that was already empty alone', async () => {
    const store = memoryStore();

    await expect(forgetCachedReads(store)).resolves.toBeUndefined();
  });

  it('does not stop at the first key it cannot remove', async () => {
    // A half-swept cache is the dangerous outcome: whatever survived is still
    // servable, and `payloadFromCache` is all-or-nothing across six slots, so
    // one surviving entry can still be part of a full stale payload.
    const removed: string[] = [];
    const store: KeyValueStore = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      keys: () => Promise.resolve(['a', 'b', 'c']),
      remove: (key) => {
        removed.push(key);
        return key === 'a' ? Promise.reject(new Error('nope')) : Promise.resolve();
      },
    };

    await forgetCachedReads(store);

    expect(removed).toEqual(['a', 'b', 'c']);
  });
});

describe('writeGenerations', () => {
  /**
   * A read takes several round trips and a mutation can land mid-flight. The
   * mutation invalidates the affected slots; the read then finishes and writes
   * back what it fetched *before* the mutation, with a fresh TTL. Reload
   * inside that window and the thread the reviewer watched resolve is
   * unresolved again, with nothing anywhere to explain it.
   */
  it('stays fresh while nothing has been mutated', () => {
    const generations = writeGenerations();
    const fresh = generations.fresh('acme/widgets/42');

    expect(fresh()).toBe(true);
  });

  it('goes stale once a mutation lands', () => {
    const generations = writeGenerations();
    const fresh = generations.fresh('acme/widgets/42');

    generations.bump('acme/widgets/42');

    expect(fresh()).toBe(false);
  });

  it('stays stale for good, however many mutations follow', () => {
    const generations = writeGenerations();
    const fresh = generations.fresh('acme/widgets/42');

    generations.bump('acme/widgets/42');
    generations.bump('acme/widgets/42');

    expect(fresh()).toBe(false);
  });

  it('does not let one pull request invalidate another', () => {
    // Reviewing two pull requests in two tabs is ordinary. A resolve in one
    // must not throw away the other's cache write.
    const generations = writeGenerations();
    const fresh = generations.fresh('acme/widgets/42');

    generations.bump('acme/widgets/99');

    expect(fresh()).toBe(true);
  });

  it('lets a read that starts after the mutation write normally', () => {
    // The counter is a comparison, not a latch: the next read carries
    // post-mutation data and is entitled to cache it.
    const generations = writeGenerations();
    generations.bump('acme/widgets/42');

    expect(generations.fresh('acme/widgets/42')()).toBe(true);
  });
});

describe('forgetting superseded commits', () => {
  /**
   * Cache keys embed the head SHA, so a force-push makes every entry for the
   * old one unreachable — and eviction only happens on read, which those keys
   * never get again. `storage.session` caps at a few megabytes; once it is
   * full every write is refused, the worker swallows the failure as a warning,
   * and from then on the extension re-fetches everything on every load with
   * nothing on screen to say why.
   */
  const key = (slot: string, sha: string) => `${slot}:acme/widgets/42@${sha}`;

  it('drops the entries for a head commit that has moved on', async () => {
    const store = memoryStore();
    const cache = new PrCache(store);
    await cache.set('diff', { owner: 'acme', repo: 'widgets', number: 42, headSha: 'old' }, 1);
    await cache.set('pr', { owner: 'acme', repo: 'widgets', number: 42, headSha: 'old' }, 2);

    await cache.forgetOtherCommits({ owner: 'acme', repo: 'widgets', number: 42 }, 'new');

    expect(await store.get(key('diff', 'old'))).toBeNull();
    expect(await store.get(key('pr', 'old'))).toBeNull();
  });

  it('keeps the commit that is current', async () => {
    const store = memoryStore();
    const cache = new PrCache(store);
    await cache.set('diff', { owner: 'acme', repo: 'widgets', number: 42, headSha: 'new' }, 1);

    await cache.forgetOtherCommits({ owner: 'acme', repo: 'widgets', number: 42 }, 'new');

    expect(await store.get(key('diff', 'new'))).not.toBeNull();
  });

  it('leaves other pull requests alone', async () => {
    // Reviewing several at once is ordinary, and one force-push says nothing
    // about the others.
    const store = memoryStore();
    const cache = new PrCache(store);
    await cache.set('diff', { owner: 'acme', repo: 'widgets', number: 99, headSha: 'old' }, 1);

    await cache.forgetOtherCommits({ owner: 'acme', repo: 'widgets', number: 42 }, 'new');

    expect(await store.get('diff:acme/widgets/99@old')).not.toBeNull();
  });

  it('leaves the head pointer alone', async () => {
    // It is not slot-qualified and is the thing that finds everything else.
    const store = memoryStore();
    await store.set('head:acme/widgets/42', 'new');
    const cache = new PrCache(store);

    await cache.forgetOtherCommits({ owner: 'acme', repo: 'widgets', number: 42 }, 'new');

    expect(await store.get('head:acme/widgets/42')).toBe('new');
  });
});
