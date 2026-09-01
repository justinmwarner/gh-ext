/**
 * The pull request cache.
 *
 * Pure logic over an injected `KeyValueStore` — the same seam
 * `lib/review/drafts.ts` uses — so the expiry rules are unit-testable without a
 * browser. The background worker supplies a store backed by extension storage.
 *
 * Extension storage is the only durable place an MV3 service worker has:
 * module-scope state dies with the worker after ~30s idle.
 */

import type { PrRef } from './messages';
import type { KeyValueStore } from './review/drafts';

/** A pull request at a specific head commit. */
export type PrCacheRef = PrRef & { headSha: string };

/**
 * What is being cached for a pull request.
 *
 * - `pr` — the pull request node itself: title, state, file list. Mutable.
 * - `diff` — the parsed unified diff, or the files-endpoint fallback.
 * - `threads` — review threads and their comments. Mutable.
 * - `checks` — the head commit's status check rollup. Mutable.
 */
export type CacheSlot = 'pr' | 'diff' | 'threads' | 'checks';

/**
 * Which slots cannot change for a given head SHA.
 *
 * A diff is a function of two commits, so once read it is correct forever and
 * gets no expiry. Everything else is live server state.
 *
 * Written as a total `Record` so that adding a slot without deciding its
 * mutability fails to compile.
 */
const IMMUTABLE: Record<CacheSlot, boolean> = {
  pr: false,
  diff: true,
  threads: false,
  checks: false,
};

/**
 * How long mutable slots stay usable.
 *
 * Short on purpose: a stale thread list is worse than a slightly slower page,
 * and the head SHA in the key already protects against showing a diff from the
 * wrong commit.
 */
export const DEFAULT_TTL_MS = 60_000;

/**
 * The result of a lookup.
 *
 * A hit carrying `null` and a miss are different facts — "GitHub says this head
 * commit has no checks" must not be re-fetched on every render as if nothing
 * had been cached — so the value never doubles as the presence flag.
 */
export type CacheLookup<T> = { hit: true; value: T } | { hit: false };

const MISS: CacheLookup<never> = { hit: false };

interface Entry {
  /** The cached value. Present even when null. */
  v: unknown;
  /** Epoch milliseconds, or null for an entry that never expires. */
  expiresAt: number | null;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Entry>;
  // `'v' in candidate` rather than a value check: `v` is legitimately null.
  if (!('v' in candidate)) return false;
  return candidate.expiresAt === null || typeof candidate.expiresAt === 'number';
}

/** The cache key for a pull request at a head commit. */
export const prCacheKey = (ref: PrCacheRef): string =>
  `${ref.owner}/${ref.repo}/${ref.number}@${ref.headSha}`;

/** Slot-qualified store key. The slot namespaces the shared store. */
const storeKey = (slot: CacheSlot, ref: PrCacheRef): string =>
  `${slot}:${prCacheKey(ref)}`;

export interface PrCacheOptions {
  /** Lifetime for mutable slots. Defaults to {@link DEFAULT_TTL_MS}. */
  ttlMs?: number;
  /** Injected for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class PrCache {
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: KeyValueStore,
    options: PrCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Read a slot.
   *
   * `T` is asserted, not verified: what comes back is whatever JSON was written
   * by a previous version of this extension. Callers get a miss for anything
   * unreadable, but a value written in a shape that still parses is returned
   * as-is.
   */
  async get<T>(slot: CacheSlot, ref: PrCacheRef): Promise<CacheLookup<T>> {
    const key = storeKey(slot, ref);
    const raw = await this.store.get(key);
    if (raw === null) return MISS;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Truncated or written by an incompatible version. Drop it rather than
      // let one bad key wedge this pull request forever.
      await this.store.remove(key);
      return MISS;
    }

    if (!isEntry(parsed)) {
      await this.store.remove(key);
      return MISS;
    }

    if (parsed.expiresAt !== null && this.now() >= parsed.expiresAt) {
      // Evict on read. Nothing else sweeps this store, and every superseded
      // head SHA leaves entries behind.
      await this.store.remove(key);
      return MISS;
    }

    return { hit: true, value: parsed.v as T };
  }

  async set<T>(slot: CacheSlot, ref: PrCacheRef, value: T): Promise<void> {
    const entry: Entry = {
      v: value,
      expiresAt: IMMUTABLE[slot] ? null : this.now() + this.ttlMs,
    };
    await this.store.set(storeKey(slot, ref), JSON.stringify(entry));
  }

  /** Drop one slot — used after a mutation makes the cached copy wrong. */
  invalidate(slot: CacheSlot, ref: PrCacheRef): Promise<void> {
    return this.store.remove(storeKey(slot, ref));
  }
}
