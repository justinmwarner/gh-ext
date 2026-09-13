import { describe, expect, it } from 'vitest';
import type { PrSummary } from './buckets';
import {
  type Overrides,
  clearOverride,
  resolve,
  setOverride,
  sweepOverrides,
} from './overrides';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const DAY = 86_400_000;

function summary(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    id: 'PR_1',
    number: 7,
    title: 'Do the thing',
    url: 'https://github.com/acme/widgets/pull/7',
    repo: 'acme/widgets',
    isPrivate: false,
    author: 'someone',
    isDraft: false,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    headRefOid: 'aaa',
    viewerDidAuthor: false,
    reviewRequestedFromViewer: true,
    reviewDecision: null,
    viewerLatestReview: null,
    reviewRequestCount: 0,
    checks: null,
    mergeStateStatus: null,
    unresolvedCount: 0,
    unresolvedNotByViewer: 0,
    threadsTruncated: false,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    isReadByViewer: true,
    ...overrides,
  };
}

const opts = { now: NOW, stalenessDays: 14 };

describe('resolve', () => {
  it('returns the derived bucket when there is no override', () => {
    const result = resolve(summary(), {}, opts);

    expect(result.bucket).toBe('waiting-on-you');
    expect(result.override).toBeNull();
  });

  it('honours an override made against the pull request as it stands', () => {
    const pr = summary();
    const overrides = setOverride({}, pr, 'quiet', NOW);

    const result = resolve(pr, overrides, opts);

    expect(result.bucket).toBe('quiet');
    expect(result.override).toEqual({ state: 'applied', bucket: 'quiet', setAt: NOW });
  });

  it('retires an override once the head has moved', () => {
    const pr = summary();
    const overrides = setOverride({}, pr, 'quiet', NOW);

    const result = resolve(summary({ headRefOid: 'bbb' }), overrides, opts);

    expect(result.bucket).toBe('waiting-on-you');
    expect(result.override).toEqual({ state: 'lapsed', why: 'pushed' });
  });

  it('retires an override once anything else has happened', () => {
    const pr = summary();
    const overrides = setOverride({}, pr, 'quiet', NOW);

    const result = resolve(summary({ updatedAt: NOW + 1000 }), overrides, opts);

    expect(result.bucket).toBe('waiting-on-you');
    expect(result.override).toEqual({ state: 'lapsed', why: 'changed' });
  });

  it('reports a push rather than a change when both are true', () => {
    // A push moves `updatedAt` as well, so both conditions fire together and
    // the reviewer is owed the specific one.
    const pr = summary();
    const overrides = setOverride({}, pr, 'quiet', NOW);

    const result = resolve(
      summary({ headRefOid: 'bbb', updatedAt: NOW + 1000 }),
      overrides,
      opts,
    );

    expect(result.override).toEqual({ state: 'lapsed', why: 'pushed' });
  });

  it('leaves an override for a different pull request alone', () => {
    const overrides = setOverride({}, summary({ id: 'PR_OTHER' }), 'quiet', NOW);

    const result = resolve(summary(), overrides, opts);

    expect(result.bucket).toBe('waiting-on-you');
    expect(result.override).toBeNull();
  });

  it('carries the derived reason through an applied override', () => {
    // The row still has to say what the pull request actually is, or an
    // override becomes a way to hide the facts rather than to reorder them.
    const pr = summary();
    const overrides = setOverride({}, pr, 'quiet', NOW);

    const result = resolve(pr, overrides, opts);

    expect(result.reason).toEqual({ kind: 'review-requested' });
  });
});

describe('setOverride', () => {
  it('stamps the override with the state it was made against', () => {
    const pr = summary({ headRefOid: 'ccc', updatedAt: NOW - 500 });

    const overrides = setOverride({}, pr, 'ready-to-merge', NOW);

    expect(overrides['PR_1']).toEqual({
      bucket: 'ready-to-merge',
      headRefOid: 'ccc',
      seenAt: NOW - 500,
      setAt: NOW,
    });
  });

  it('does not mutate the overrides it was given', () => {
    const before: Overrides = {};

    setOverride(before, summary(), 'quiet', NOW);

    expect(before).toEqual({});
  });

  it('replaces an earlier override for the same pull request', () => {
    const pr = summary();
    const once = setOverride({}, pr, 'quiet', NOW - 1000);

    const twice = setOverride(once, pr, 'ready-to-merge', NOW);

    expect(Object.keys(twice)).toEqual(['PR_1']);
    expect(twice['PR_1']?.bucket).toBe('ready-to-merge');
  });
});

describe('clearOverride', () => {
  it('takes an override off', () => {
    const overrides = setOverride({}, summary(), 'quiet', NOW);

    expect(clearOverride(overrides, 'PR_1')).toEqual({});
  });

  it('does not mutate the overrides it was given', () => {
    const before = setOverride({}, summary(), 'quiet', NOW);

    clearOverride(before, 'PR_1');

    expect(Object.keys(before)).toEqual(['PR_1']);
  });
});

describe('sweepOverrides', () => {
  it('drops an override for a pull request that is no longer listed', () => {
    // A merged or closed pull request leaves the dashboard, and an override
    // nothing can ever apply to again is storage nobody will remember to clean.
    let overrides = setOverride({}, summary(), 'quiet', NOW);
    overrides = setOverride(overrides, summary({ id: 'PR_2' }), 'quiet', NOW);

    expect(Object.keys(sweepOverrides(overrides, ['PR_2']))).toEqual(['PR_2']);
  });

  it('returns the same object when there is nothing to drop', () => {
    // Identity matters: the caller writes to storage when this changes, and a
    // fresh object every load would be a write on every load.
    const overrides = setOverride({}, summary(), 'quiet', NOW);

    expect(sweepOverrides(overrides, ['PR_1'])).toBe(overrides);
  });
});
