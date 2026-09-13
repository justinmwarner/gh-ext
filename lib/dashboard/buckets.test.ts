import { describe, expect, it } from 'vitest';
import { BUCKET_ORDER, type PrSummary, classify } from './buckets';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-13T12:00:00Z');

/** A pull request somebody else wrote, that nothing is currently waiting on. */
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
    state: 'OPEN',
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    headRefOid: 'aaa',
    viewerDidAuthor: false,
    reviewRequestedFromViewer: false,
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

describe('classify', () => {
  it('puts a review requested of me, that I have not reviewed, in waiting-on-you', () => {
    const result = classify(summary({ reviewRequestedFromViewer: true }), opts);

    expect(result.bucket).toBe('waiting-on-you');
    expect(result.reason).toEqual({ kind: 'review-requested' });
  });

  it('puts a pull request pushed since my review back in waiting-on-you', () => {
    const result = classify(
      summary({
        headRefOid: 'bbb',
        viewerLatestReview: { state: 'COMMENTED', commitOid: 'aaa' },
      }),
      opts,
    );

    expect(result.bucket).toBe('waiting-on-you');
    expect(result.reason).toEqual({ kind: 'pushed-since-review' });
  });

  it('leaves a pull request I reviewed at its current head alone', () => {
    const result = classify(
      summary({
        headRefOid: 'aaa',
        viewerLatestReview: { state: 'APPROVED', commitOid: 'aaa' },
      }),
      opts,
    );

    expect(result.bucket).not.toBe('waiting-on-you');
  });

  it('does not claim a push happened when my review recorded no commit', () => {
    // `viewerLatestReview.commit` is null on a review GitHub could not anchor.
    // Comparing null against the head would read as "they pushed" on every
    // such review, which is the loudest possible way to be wrong.
    const result = classify(
      summary({ headRefOid: 'bbb', viewerLatestReview: { state: 'COMMENTED', commitOid: null } }),
      opts,
    );

    expect(result.bucket).not.toBe('waiting-on-you');
  });
});

describe('classify, on my own pull requests', () => {
  const mine = (overrides: Partial<PrSummary> = {}) =>
    summary({ viewerDidAuthor: true, author: 'me', ...overrides });

  it('calls changes requested blocked-on-you', () => {
    const result = classify(mine({ reviewDecision: 'CHANGES_REQUESTED' }), opts);

    expect(result.bucket).toBe('blocked-on-you');
    expect(result.reason).toEqual({ kind: 'changes-requested' });
  });

  it('calls unresolved conversations somebody else left blocked-on-you', () => {
    const result = classify(mine({ unresolvedCount: 3, unresolvedNotByViewer: 3 }), opts);

    expect(result.bucket).toBe('blocked-on-you');
    expect(result.reason).toEqual({ kind: 'unresolved', count: 3 });
  });

  it('does not count unresolved conversations whose last word was mine', () => {
    const result = classify(mine({ unresolvedCount: 3, unresolvedNotByViewer: 0 }), opts);

    expect(result.bucket).not.toBe('blocked-on-you');
  });

  it('calls a conflicted branch blocked-on-you', () => {
    const result = classify(mine({ mergeStateStatus: 'DIRTY' }), opts);

    expect(result.bucket).toBe('blocked-on-you');
    expect(result.reason).toEqual({ kind: 'conflicts' });
  });

  it('calls failing checks blocked-on-you', () => {
    const result = classify(mine({ checks: 'FAILURE' }), opts);

    expect(result.bucket).toBe('blocked-on-you');
    expect(result.reason).toEqual({ kind: 'checks-failing' });
  });

  it('calls approved and clean ready-to-merge', () => {
    const result = classify(
      mine({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
      opts,
    );

    expect(result.bucket).toBe('ready-to-merge');
    expect(result.reason).toEqual({ kind: 'approved-and-clean' });
  });

  it('calls requested reviewers waiting-on-others', () => {
    const result = classify(
      mine({ reviewDecision: 'REVIEW_REQUIRED', reviewRequestCount: 2 }),
      opts,
    );

    expect(result.bucket).toBe('waiting-on-others');
    expect(result.reason).toEqual({ kind: 'awaiting-reviewers', count: 2 });
  });

  it('calls approved but not mergeable waiting-on-others', () => {
    const result = classify(
      mine({ reviewDecision: 'APPROVED', mergeStateStatus: 'BLOCKED' }),
      opts,
    );

    expect(result.bucket).toBe('waiting-on-others');
    expect(result.reason).toEqual({ kind: 'approved-not-clean', status: 'BLOCKED' });
  });

  it('falls through to quiet when nothing is waiting on anybody', () => {
    const result = classify(mine(), opts);

    expect(result.bucket).toBe('quiet');
  });
});

describe('classify, drafts', () => {
  it('puts a draft in drafts however else it would have scored', () => {
    // Failing checks would otherwise be blocked-on-you. A draft is not asking
    // anything of anybody yet, so it must not be able to reach the top of the
    // list through some other rule.
    const result = classify(
      summary({ isDraft: true, viewerDidAuthor: true, checks: 'FAILURE' }),
      opts,
    );

    expect(result.bucket).toBe('drafts');
    expect(result.reason).toEqual({ kind: 'draft' });
  });
});

describe('classify, staleness', () => {
  const old = { updatedAt: NOW - 30 * DAY };

  it('moves a stale waiting-on-others to quiet', () => {
    const result = classify(
      summary({
        viewerDidAuthor: true,
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequestCount: 1,
        ...old,
      }),
      opts,
    );

    expect(result.bucket).toBe('quiet');
    expect(result.reason).toEqual({ kind: 'quiet', days: 30 });
  });

  it('moves a stale ready-to-merge to quiet', () => {
    const result = classify(
      summary({
        viewerDidAuthor: true,
        reviewDecision: 'APPROVED',
        mergeStateStatus: 'CLEAN',
        ...old,
      }),
      opts,
    );

    expect(result.bucket).toBe('quiet');
  });

  it('never moves waiting-on-you to quiet, however old', () => {
    // The one exemption. An unanswered review request is another person
    // blocked on this reviewer, and that does not expire.
    const result = classify(summary({ reviewRequestedFromViewer: true, ...old }), opts);

    expect(result.bucket).toBe('waiting-on-you');
  });

  it('never moves a push since my review to quiet, however old', () => {
    const result = classify(
      summary({
        headRefOid: 'bbb',
        viewerLatestReview: { state: 'COMMENTED', commitOid: 'aaa' },
        ...old,
      }),
      opts,
    );

    expect(result.bucket).toBe('waiting-on-you');
  });

  it('moves a stale blocked-on-you to quiet', () => {
    // Run against a real account this rule used to put 47 of 52 pull requests
    // in one bucket: every abandoned branch with red CI is technically blocked
    // on its author. "Old and not needed" is a bucket the reviewer asked for,
    // and a wall of rows is not a list.
    const result = classify(
      summary({ viewerDidAuthor: true, reviewDecision: 'CHANGES_REQUESTED', ...old }),
      opts,
    );

    expect(result.bucket).toBe('quiet');
  });

  it('leaves a recent blocked-on-you where it is', () => {
    const result = classify(
      summary({
        viewerDidAuthor: true,
        reviewDecision: 'CHANGES_REQUESTED',
        updatedAt: NOW - 2 * DAY,
      }),
      opts,
    );

    expect(result.bucket).toBe('blocked-on-you');
  });

  it('leaves a draft in drafts however old', () => {
    const result = classify(summary({ isDraft: true, ...old }), opts);

    expect(result.bucket).toBe('drafts');
  });
});

describe('BUCKET_ORDER', () => {
  it('shows what is waiting on the reviewer first and drafts last', () => {
    expect(BUCKET_ORDER.map((bucket) => bucket.id)).toEqual([
      'waiting-on-you',
      'blocked-on-you',
      'ready-to-merge',
      'waiting-on-others',
      'quiet',
      'drafts',
    ]);
  });

  it('labels every bucket as whose turn it is rather than as a status', () => {
    // "Waiting on you" tells a reviewer what to do about it. "Needs review"
    // describes a field. PRODUCT.md's voice section is the reason this is a
    // test rather than a convention.
    for (const bucket of BUCKET_ORDER) {
      expect(bucket.label).not.toMatch(/^(Needs|Open|Pending|Status)/);
      expect(bucket.label).not.toMatch(/!/);
    }
  });
});
