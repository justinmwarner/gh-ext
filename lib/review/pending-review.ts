export type PendingReviewState =
  | { kind: 'browse' }
  | { kind: 'pending'; reviewId: string; commentCount: number };

export type PendingReviewAction =
  | { type: 'review-started'; reviewId: string }
  | { type: 'comment-added' }
  | { type: 'submitted' }
  | { type: 'discarded' };

export const initialState = (): PendingReviewState => ({ kind: 'browse' });

export function reduce(
  state: PendingReviewState,
  action: PendingReviewAction
): PendingReviewState {
  switch (action.type) {
    case 'review-started':
      // A pending review already exists; starting another would orphan it.
      return state.kind === 'pending'
        ? state
        : { kind: 'pending', reviewId: action.reviewId, commentCount: 0 };
    case 'comment-added':
      return state.kind === 'pending'
        ? { ...state, commentCount: state.commentCount + 1 }
        : state;
    case 'submitted':
    case 'discarded':
      return { kind: 'browse' };
  }
}

/**
 * addPullRequestReviewThread takes either a pullRequestId (standalone comment)
 * or a pullRequestReviewId (attached to a pending review), never both.
 */
export function commentTarget(
  state: PendingReviewState,
  pullRequestId: string
): { pullRequestId: string } | { pullRequestReviewId: string } {
  return state.kind === 'pending'
    ? { pullRequestReviewId: state.reviewId }
    : { pullRequestId };
}
