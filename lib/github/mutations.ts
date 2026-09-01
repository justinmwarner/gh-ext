/**
 * Mutation documents.
 *
 * Every input field name below comes from docs/reference/github-review-api.md
 * section 4, introspected from the live schema on 2026-09-01. Do not rename or
 * add input fields without re-checking that document.
 */

/**
 * The same thread selection the main read query uses, so a thread returned by a
 * mutation can be merged straight into local state without a refetch.
 */
const THREAD_FIELDS = `
    id isResolved isOutdated isCollapsed
    path line startLine originalLine originalStartLine
    diffSide startDiffSide subjectType
    viewerCanReply viewerCanResolve viewerCanUnresolve
    resolvedBy { login }
    comments(first: 50) {
      nodes { id author { login avatarUrl } body createdAt url }
    }
  `;

/**
 * Create a review thread.
 *
 * `pullRequestId` and `pullRequestReviewId` are both nullable in the schema and
 * are mutually exclusive in practice: Browse mode passes `pullRequestId`,
 * Pending review mode passes `pullRequestReviewId`. Leave the unused one out of
 * the `variables` object entirely — an unsupplied variable is dropped from the
 * coerced input object, whereas an explicit `null` is sent as a null value.
 *
 * For a multi-line comment pass `startLine` + `startSide` alongside `line` +
 * `side`; for a single-line comment leave both `start*` variables unsupplied.
 */
export const ADD_THREAD = `mutation AddThread(
  $pullRequestId: ID
  $pullRequestReviewId: ID
  $path: String!
  $body: String!
  $line: Int
  $side: DiffSide
  $startLine: Int
  $startSide: DiffSide
) {
  addPullRequestReviewThread(input: {
    pullRequestId: $pullRequestId
    pullRequestReviewId: $pullRequestReviewId
    path: $path
    body: $body
    line: $line
    side: $side
    startLine: $startLine
    startSide: $startSide
  }) {
    thread {${THREAD_FIELDS}}
  }
}`;

/** Reply to an existing thread. */
export const ADD_REPLY = `mutation AddReply($pullRequestReviewThreadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: $pullRequestReviewThreadId
    body: $body
  }) {
    comment { id author { login avatarUrl } body createdAt url }
  }
}`;

export const RESOLVE_THREAD = `mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved viewerCanResolve viewerCanUnresolve }
  }
}`;

export const UNRESOLVE_THREAD = `mutation UnresolveThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved viewerCanResolve viewerCanUnresolve }
  }
}`;

/**
 * Open a PENDING review.
 *
 * `event` is deliberately absent: omitting it is what leaves the review in
 * PENDING. Passing an event here would submit the review immediately.
 */
export const START_REVIEW = `mutation StartReview($pullRequestId: ID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId }) {
    pullRequestReview { id state }
  }
}`;

/** Submit a pending review. `event` is COMMENT | APPROVE | REQUEST_CHANGES | DISMISS. */
export const SUBMIT_REVIEW = `mutation SubmitReview(
  $pullRequestReviewId: ID!
  $event: PullRequestReviewEvent!
  $body: String
) {
  submitPullRequestReview(input: {
    pullRequestReviewId: $pullRequestReviewId
    event: $event
    body: $body
  }) {
    pullRequestReview { id state }
  }
}`;

export const MARK_VIEWED = `mutation MarkViewed($pullRequestId: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
    pullRequest { id }
  }
}`;

export const UNMARK_VIEWED = `mutation UnmarkViewed($pullRequestId: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
    pullRequest { id }
  }
}`;
