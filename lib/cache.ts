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
 * - `commits` — the pull request's own commits, which the reviewer scopes the
 *   diff by. Mutable: a push adds to the list, and a force-push can take
 *   commits out of it.
 * - `truncated` — which paginated lists hit the page cap. Derived from `pr`,
 *   `threads` and `commits`, and cached with them so a payload served entirely
 *   from storage still admits what it is missing.
 * - `denied` — the fields GitHub refused to resolve. Cached for the same
 *   reason `truncated` is: a payload served from storage that had forgotten
 *   the refusal would render "No checks" over checks the token simply cannot
 *   see, which is the lie this slot exists to prevent.
 */
export type CacheSlot =
  | 'pr'
  | 'diff'
  | 'threads'
  | 'commits'
  | 'checks'
  | 'truncated'
  | 'denied';

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
  // Keyed on the head SHA, so a push already gets a fresh key — but a pull
  // request's commit list is `base..head`, and it also changes when the *base*
  // branch moves under a head this cache still considers current.
  commits: false,
  checks: false,
  truncated: false,
  // A permission can be granted while the page is open, and the reviewer will
  // expect the notice to go away when it is.
  denied: false,
};

/**
 * Every slot, for sweeping.
 *
 * Read off the record above rather than listed again. A second list would be
 * one more thing to remember when a slot is added, and forgetting it here
 * fails silently — the new slot simply never gets swept.
 */
const SLOTS = Object.keys(IMMUTABLE) as CacheSlot[];

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

  /**
   * Drop everything cached for this pull request at any other head commit.
   *
   * Keys embed the head SHA, so a force-push — or any new push — makes every
   * entry for the previous one unreachable. Eviction happens on read, and
   * those keys are never read again, so they accumulate for the life of the
   * browser session. `diff` entries are the worst of it: they hold a whole
   * parsed patch and carry no expiry at all, because a diff between two
   * commits genuinely cannot change.
   *
   * The failure at the end of that is silent. `storage.session` has a quota;
   * once it is full every write is refused, the worker logs a warning nobody
   * reads, and the extension quietly degrades to re-fetching the entire pull
   * request on every load with nothing on screen to explain the slowdown.
   *
   * The head pointer is left alone: it is not slot-qualified, and it is the
   * thing that finds everything else.
   */
  async forgetOtherCommits(pr: PrRef, headSha: string): Promise<void> {
    const prefixes = SLOTS.map((slot) => `${slot}:${pr.owner}/${pr.repo}/${pr.number}@`);
    const keys = await this.store.keys();
    const stale = keys.filter((key) => {
      const prefix = prefixes.find((candidate) => key.startsWith(candidate));
      return prefix !== undefined && key.slice(prefix.length) !== headSha;
    });
    // All of them attempted: a half-swept cache is still growing.
    await Promise.allSettled(stale.map((key) => this.store.remove(key)));
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

/**
 * Drop everything in a cache store.
 *
 * For when the token changes. Cache keys name a pull request and a head SHA,
 * never an account — which is right, because a token's identity has no place
 * in a storage key, and wrong the moment the token moves: clearing the token
 * would otherwise leave a whole pull request readable, and swapping in another
 * account's token would serve the first account's viewed states, pending
 * review id and author flag to the second.
 *
 * Every removal is attempted even if one fails. A half-swept cache is the
 * dangerous outcome — `payloadFromCache` is all-or-nothing across its slots,
 * so survivors can still add up to a complete stale payload.
 */
export async function forgetCachedReads(store: KeyValueStore): Promise<void> {
  const keys = await store.keys();
  await Promise.allSettled(keys.map((key) => store.remove(key)));
}

/**
 * Whether a cache write still reflects the current state of a pull request.
 *
 * Assembling a payload takes several round trips, and a mutation can land in
 * the middle of one. The mutation invalidates the slots it affected; the
 * assembly then finishes and writes what it read *beforehand* straight back,
 * with a fresh lifetime. A reviewer who reloads inside that window sees the
 * thread they watched resolve unresolved again, and nothing anywhere says why.
 *
 * So a reader takes `fresh()` before it starts and consults it before writing.
 * A comparison rather than a latch: the *next* read carries post-mutation data
 * and is entitled to cache it. Per pull request, because reviewing two at once
 * is ordinary and a resolve in one says nothing about the other.
 *
 * The payload itself is still returned when this reports stale — it is only
 * slightly behind, and the page has already applied the change optimistically.
 * What it must not become is the cached answer for everyone after.
 */
export function writeGenerations() {
  const counts = new Map<string, number>();
  const current = (key: string): number => counts.get(key) ?? 0;

  return {
    /** Called when a mutation for `key` has landed. */
    bump(key: string): void {
      counts.set(key, current(key) + 1);
    },
    /** True until a mutation for `key` lands after this call. */
    fresh(key: string): () => boolean {
      const startedAt = current(key);
      return () => current(key) === startedAt;
    },
  };
}
