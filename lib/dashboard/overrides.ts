/**
 * The one place a reviewer overrules the derivation, and the rule that stops
 * the override outliving the fact it overruled.
 *
 * The hazard this module exists to remove is a specific one. A pull request
 * filed under Quiet on Tuesday, which somebody requests your review on come
 * Thursday, is a lie the reviewer has no way to notice — the row is exactly
 * where they put it and says nothing. PRODUCT.md's fourth principle calls that
 * out as the worst failure available here, because what is being hidden is
 * somebody's request for your attention.
 *
 * So an override is stamped with the state it was made against and retires
 * itself when that state moves. The mechanism is not new: `lib/cache.ts`
 * already keys every mutable slot on the head SHA so a push invalidates it
 * without anybody having to remember to. This is the same trick applied to a
 * decision instead of to a payload.
 *
 * There are no free-form tags here and that is a design decision rather than
 * an unfinished one — see the spec's section 2. In short: they cannot sync,
 * they have nothing to lapse against, and the buckets already are the
 * vocabulary.
 *
 * Pure: no DOM, no `chrome.*`, no network. The adapter that persists these is
 * the settings store.
 */

import { type BucketId, type Classification, type PrSummary, classify } from './buckets';

/**
 * A bucket the reviewer chose, and the pull request it was chosen against.
 *
 * `seenAt` is the pull request's own `updatedAt` at the moment of the decision,
 * not the moment itself — `setAt` is that. The two are different instants and
 * conflating them makes the lapse test compare a clock against a server
 * timestamp, which drifts.
 */
export interface Override {
  bucket: BucketId;
  headRefOid: string;
  /** The pull request's `updatedAt` when the reviewer decided. Epoch ms. */
  seenAt: number;
  /** When they decided. Epoch ms. Shown on the row, never compared. */
  setAt: number;
}

/** Keyed by `PrSummary.id` — GitHub's node id, stable across renames. */
export type Overrides = Record<string, Override>;

/**
 * Why an override stopped applying.
 *
 * `pushed` wins when both are true, because a push moves `updatedAt` as well
 * and "they pushed" is the specific fact while "something changed" is what is
 * left when nothing more precise is known.
 */
export type LapseReason = 'pushed' | 'changed';

export type OverrideState =
  | { state: 'applied'; bucket: BucketId; setAt: number }
  | { state: 'lapsed'; why: LapseReason };

export interface Resolved extends Classification {
  /** Null when no override for this pull request exists at all. */
  override: OverrideState | null;
}

/**
 * Where a pull request goes, once the reviewer has had their say.
 *
 * The derived reason is carried through an applied override rather than
 * replaced by it. A reviewer who moved a row to Quiet still needs the row to
 * say that a review was requested on it — otherwise an override becomes a way
 * of hiding the facts rather than of reordering them.
 */
export function resolve(
  pr: PrSummary,
  overrides: Overrides,
  options: { now: number; stalenessDays: number },
): Resolved {
  const derived = classify(pr, options);
  const override = overrides[pr.id];
  if (override === undefined) return { ...derived, override: null };

  const why = lapseReason(pr, override);
  if (why !== null) return { ...derived, override: { state: 'lapsed', why } };

  return {
    bucket: override.bucket,
    reason: derived.reason,
    override: { state: 'applied', bucket: override.bucket, setAt: override.setAt },
  };
}

/**
 * Why this override no longer applies, or null while it still does.
 *
 * `updatedAt` is the blunt half of the pair and is chosen knowingly: it moves
 * on any change at all, a bot's comment included. The narrower test would be
 * to recompute the derived bucket and retire only on disagreement, which lets
 * an override survive noise — and also keeps a dismissal alive through three
 * days of real discussion, because discussion alone does not move a bucket.
 * Lapsing too eagerly costs one press to re-dismiss. Lapsing too reluctantly
 * costs the reviewer the thing they asked to be told about. The eager rule is
 * the safe one; the swap is this function and nothing else.
 */
function lapseReason(pr: PrSummary, override: Override): LapseReason | null {
  if (pr.headRefOid !== override.headRefOid) return 'pushed';
  if (pr.updatedAt > override.seenAt) return 'changed';
  return null;
}

/** Record a reviewer's decision, stamped with what it was decided against. */
export function setOverride(
  overrides: Overrides,
  pr: PrSummary,
  bucket: BucketId,
  now: number,
): Overrides {
  return {
    ...overrides,
    [pr.id]: { bucket, headRefOid: pr.headRefOid, seenAt: pr.updatedAt, setAt: now },
  };
}

/** Take one off, returning to the derived bucket. */
export function clearOverride(overrides: Overrides, id: string): Overrides {
  if (!Object.hasOwn(overrides, id)) return overrides;
  const { [id]: _dropped, ...rest } = overrides;
  return rest;
}

/**
 * Drop overrides for pull requests that are no longer on the dashboard.
 *
 * A merged or closed pull request never comes back, so its override is storage
 * nobody will remember to clean. The same sweep `lib/cache.ts` does, for the
 * same reason.
 *
 * Returns the *same object* when nothing was dropped. The caller writes to
 * storage when this changes, and a fresh object on every load would be a write
 * on every load.
 */
export function sweepOverrides(overrides: Overrides, liveIds: readonly string[]): Overrides {
  const live = new Set(liveIds);
  const keys = Object.keys(overrides);
  const kept = keys.filter((id) => live.has(id));
  if (kept.length === keys.length) return overrides;

  const swept: Overrides = {};
  for (const id of kept) {
    const override = overrides[id];
    if (override !== undefined) swept[id] = override;
  }
  return swept;
}
