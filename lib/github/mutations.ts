/**
 * Mutation documents.
 *
 * Every input field name below comes from docs/reference/github-review-api.md
 * section 4, introspected from the live schema on 2026-09-01 and extended for
 * the comment edit and delete on 2026-09-05. Do not rename or add input fields
 * without re-checking that document.
 */

/**
 * The same comment selection the main read query uses.
 *
 * Its own constant because four documents return a comment and they have to
 * agree: a reply merged into a thread beside a comment from PULL_REQUEST_QUERY
 * sits in the same list and is read by the same component, so a field selected
 * by only one of them arrives undefined on half the rows.
 *
 * `viewerCanUpdate` / `viewerCanDelete` matter most on the freshly written
 * comment. A missing permission flag reads as "not permitted", so without them
 * the comment a reviewer has just posted is the one comment on the page they
 * cannot fix a typo in — until they reload, which is the moment the offer is
 * wanted most.
 */
const COMMENT_FIELDS = `id author { login avatarUrl } body createdAt url
      viewerCanUpdate viewerCanDelete`;

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
      nodes { ${COMMENT_FIELDS} }
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
  $subjectType: PullRequestReviewThreadSubjectType
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
    subjectType: $subjectType
  }) {
    thread {${THREAD_FIELDS}}
  }
}`;

/** Reply to an existing thread. */
/**
 * `pullRequestReviewId` is optional and must be passed whenever a review is
 * pending. Without it the reply publishes immediately while line comments on
 * the same review sit queued, so a reviewer submits their review only to find
 * their replies went out some time earlier.
 */
export const ADD_REPLY = `mutation AddReply(
  $pullRequestReviewThreadId: ID!
  $body: String!
  $pullRequestReviewId: ID
) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: $pullRequestReviewThreadId
    body: $body
    pullRequestReviewId: $pullRequestReviewId
  }) {
    comment { ${COMMENT_FIELDS} }
  }
}`;

/**
 * Rewrite one comment's body.
 *
 * `body` is `String!`, and that is the whole semantics: the mutation replaces
 * the body rather than patching it, so the caller has to send the finished
 * text and not a delta. GitHub keeps the previous versions itself
 * (`userContentEdits`), which is why this is the one write here that needs no
 * confirmation — nothing is lost that GitHub cannot show.
 *
 * Works on a **pending** comment as well as a published one, which is the case
 * that hurts: a draft comment queued on a PENDING review is an ordinary
 * `PullRequestReviewComment` and takes this mutation unchanged. No review id is
 * passed and none is wanted — the comment already knows which review it belongs
 * to, and naming one would only be a way to name the wrong one.
 *
 * The input field is `pullRequestReviewCommentId`; the delete below takes a
 * bare `id`. That asymmetry is the schema's, not a slip — both introspected
 * 2026-09-05, and this document executed against the live schema the same day
 * with the dead id from reference section 7, answering `NOT_FOUND` only.
 */
export const UPDATE_COMMENT = `mutation UpdateComment(
  $pullRequestReviewCommentId: ID!
  $body: String!
) {
  updatePullRequestReviewComment(input: {
    pullRequestReviewCommentId: $pullRequestReviewCommentId
    body: $body
  }) {
    pullRequestReviewComment { ${COMMENT_FIELDS} }
  }
}`;

/**
 * Destroy one comment, on GitHub, for everyone, permanently.
 *
 * The second destructive mutation in the extension after `DELETE_REVIEW`, and
 * it earns the same rule: the UI asks before it fires. Unlike the edit above,
 * nothing keeps a copy — `userContentEdits` goes with the comment — so this is
 * the one place where a mis-click costs writing that cannot be recovered from
 * anywhere, including github.com.
 *
 * Two things about the shape, both introspected 2026-09-05:
 *
 * - The input field is `id`, **not** `pullRequestReviewCommentId` as on the
 *   update above. GitHub answers a wrong input field name with HTTP 200 and a
 *   validation error, so this would fail as a comment that quietly refused to
 *   go away rather than as a broken request.
 * - The payload offers `pullRequestReviewComment` as well as
 *   `pullRequestReview`, and only the review is selected. Reading back the
 *   comment that was just deleted is an invitation to merge it into state, and
 *   a deleted comment reappearing is the worse half of the failure.
 *
 * Deleting a thread's **last** comment deletes the thread with it; the caller
 * has to drop the thread rather than leave an empty one on screen.
 *
 * Executed against the live schema on 2026-09-05 with the dead id from
 * reference section 7 and answered `NOT_FOUND` only — schema-valid, and no node
 * resolved, so nothing was written. Nothing has ever run it against a comment
 * that exists; that is the one step this check cannot take.
 */
export const DELETE_COMMENT = `mutation DeleteComment($id: ID!) {
  deletePullRequestReviewComment(input: { id: $id }) {
    pullRequestReview { id state }
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
 * What may be done to these threads now, asked again.
 *
 * A query rather than a mutation, and the only one in this file, because it
 * belongs to the same conversation: it exists to correct flags that a mutation
 * returned and that have since stopped being true.
 *
 * A thread written into a PENDING review comes back from
 * `addPullRequestReviewThread` describing a thread nobody else can see yet, and
 * some of what a viewer may do to it is answered against that. Submitting the
 * review makes it a real thread on the pull request without touching anything
 * this page holds, so the flags stay as they were written — and the reviewer
 * meets a Resolve button that is disabled on a conversation that is plainly
 * there. Reloading fixed it, which is the tell: the server has always been
 * right and only the copy here was stale.
 *
 * Asked rather than assumed. "It submitted, so it must be resolvable" is a
 * guess, and a wrong one for anybody who may review a repository but not write
 * to it — GitHub lets them submit the review and still refuses the resolve.
 * See `ReadOnlyNotice`, which is the page-level half of that same rule.
 *
 * `nodes` takes up to 100 ids and returns null in place of any it could not
 * resolve, so the reader has to tolerate holes rather than index by position.
 */
export const THREAD_PERMISSIONS = `query ThreadPermissions($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequestReviewThread {
      id isResolved viewerCanReply viewerCanResolve viewerCanUnresolve
    }
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

/**
 * Throw a pending review away, on the server as well as here.
 *
 * The state machine's `discarded` transition has to mean something. Clearing
 * only the local state would leave the PENDING review — and every comment
 * queued on it — sitting on GitHub, so the next visit would silently resume a
 * review the reviewer believes they abandoned.
 *
 * Not covered by section 4 of the API reference. The document was executed
 * against the live schema with a fabricated review id on 2026-09-01 and came
 * back with `NOT_FOUND` only, which is a schema-valid document that resolved
 * no node.
 */
export const DELETE_REVIEW = `mutation DeleteReview($pullRequestReviewId: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId }) {
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
