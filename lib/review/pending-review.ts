export type PendingReviewState =
  | { kind: 'browse' }
  | {
      kind: 'pending';
      reviewId: string;
      /** Comments known to be queued on this review. */
      commentCount: number;
      /**
       * Whether `commentCount` is the whole count.
       *
       * True for a review this session opened: it began empty, so every comment
       * on it passed through `comment-added`. False for a resumed one, because
       * PULL_REQUEST_QUERY carries no comment count for an already-open PENDING
       * review — the count is then a floor, not a total.
       *
       * The distinction is not cosmetic. A resumed review reported as
       * "0 comments" invites the reviewer to submit what they believe is an
       * empty review over work they cannot see.
       */
      countIsComplete: boolean;
    };

export type PendingReviewAction =
  | { type: 'review-started'; reviewId: string }
  /**
   * A PENDING review already existed on the server, typically because the user
   * started it in GitHub's own UI. Without this the first comment would post
   * standalone against the pull request and be orphaned by the open review.
   */
  | { type: 'review-resumed'; reviewId: string; commentCount: number }
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
        : {
            kind: 'pending',
            reviewId: action.reviewId,
            commentCount: 0,
            // It was opened empty here, so nothing can be queued on it that
            // did not pass through this machine.
            countIsComplete: true,
          };
    case 'review-resumed':
      // Local state wins: it reflects comments this session already queued.
      return state.kind === 'pending'
        ? state
        : {
            kind: 'pending',
            reviewId: action.reviewId,
            commentCount: action.commentCount,
            // The caller cannot know what the server already holds.
            countIsComplete: false,
          };
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
