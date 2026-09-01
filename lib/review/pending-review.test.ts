import { describe, expect, it } from 'vitest';
import { commentTarget, initialState, reduce } from './pending-review';

describe('pending review state machine', () => {
  it('starts in browse', () => {
    expect(initialState()).toEqual({ kind: 'browse' });
  });

  it('targets the pull request when browsing', () => {
    expect(commentTarget({ kind: 'browse' }, 'PR_1')).toEqual({ pullRequestId: 'PR_1' });
  });

  it('targets the review once one is pending', () => {
    const s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    expect(commentTarget(s, 'PR_1')).toEqual({ pullRequestReviewId: 'R_1' });
  });

  it('counts comments added to a pending review', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    s = reduce(s, { type: 'comment-added' });
    expect(s).toEqual({ kind: 'pending', reviewId: 'R_1', commentCount: 2 });
  });

  it('ignores comment-added while browsing', () => {
    expect(reduce({ kind: 'browse' }, { type: 'comment-added' })).toEqual({ kind: 'browse' });
  });

  it('returns to browse after submitting', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    expect(reduce(s, { type: 'submitted' })).toEqual({ kind: 'browse' });
  });

  it('returns to browse after discarding', () => {
    const s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    expect(reduce(s, { type: 'discarded' })).toEqual({ kind: 'browse' });
  });

  it('ignores a second review-started', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    expect(reduce(s, { type: 'review-started', reviewId: 'R_2' })).toEqual(s);
  });
});

describe('resuming a review started elsewhere', () => {
  it('hydrates browse into pending with the server comment count', () => {
    // GitHub keeps a PENDING review across sessions. If the user started one
    // in GitHub's own UI, we must attach to it — posting standalone comments
    // alongside an open pending review orphans them.
    expect(
      reduce(initialState(), { type: 'review-resumed', reviewId: 'R_9', commentCount: 3 })
    ).toEqual({ kind: 'pending', reviewId: 'R_9', commentCount: 3 });
  });

  it('targets the resumed review for new comments', () => {
    const s = reduce(initialState(), {
      type: 'review-resumed', reviewId: 'R_9', commentCount: 3,
    });
    expect(commentTarget(s, 'PR_1')).toEqual({ pullRequestReviewId: 'R_9' });
  });

  it('does not clobber a local pending review', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    expect(reduce(s, { type: 'review-resumed', reviewId: 'R_9', commentCount: 3 })).toEqual(s);
  });
});
