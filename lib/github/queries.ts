/**
 * The read documents the service worker issues.
 *
 * One batched query on prefetch, plus a follow-up per paginated connection.
 * `files` and `reviewThreads` cap at 100 nodes a page and real pull requests
 * exceed that, so the tail has to be fetched rather than dropped.
 *
 * The node selections live in named fragments and are spliced into every
 * document that needs them. A page fetched by cursor has to carry exactly the
 * fields the first page carried — otherwise the merged list is uneven and the
 * UI reads a missing field off half its rows — and one shared fragment is the
 * only way to guarantee that without a build step.
 *
 * Derived from docs/reference/github-review-api.md section 3 and re-verified
 * against the live schema on 2026-09-01, including the five members of the
 * `RequestedReviewer` union. Do not edit fields here without executing the
 * result against the schema again.
 */

export const FILE_FIELDS = `fragment FileFields on PullRequestChangedFile {
  path additions deletions changeType viewerViewedState
}`;

/**
 * `comments(first: 50)` is deliberately not paginated — a thread with more than
 * fifty replies is vanishingly rare next to a pull request with more than a
 * hundred files. `totalCount` is selected so that when it does happen the
 * shortfall is visible (`totalCount > nodes.length`) rather than silent.
 */
export const REVIEW_THREAD_FIELDS = `fragment ReviewThreadFields on PullRequestReviewThread {
  id isResolved isOutdated isCollapsed
  path line startLine originalLine originalStartLine
  diffSide startDiffSide subjectType
  viewerCanReply viewerCanResolve viewerCanUnresolve
  resolvedBy { login }
  comments(first: 50) {
    totalCount
    nodes { id author { login avatarUrl } body createdAt url }
  }
}`;

/**
 * `RequestedReviewer` is a union of five types, not one.
 *
 * Spreading only `User` drops team, bot and mannequin requests entirely, so a
 * pull request whose only pending reviewer is a team renders no reviewers at
 * all — which reads as "nobody has been asked". Teams carry `name`/`slug` and
 * no `login`; bots and mannequins carry `login`/`avatarUrl`. `__typename` is
 * selected so a sixth member added later degrades to a placeholder instead of
 * vanishing.
 */
export const REQUESTED_REVIEWER_FIELDS = `fragment RequestedReviewerFields on RequestedReviewer {
  __typename
  ... on User { login avatarUrl }
  ... on Bot { login avatarUrl }
  ... on Mannequin { login avatarUrl }
  ... on Team { name slug }
  ... on EnterpriseTeam { name slug }
}`;

/** The single batched read query issued on prefetch. */
export const PULL_REQUEST_QUERY = `query PullRequestReview($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title bodyHTML state isDraft merged
      # baseRefOid as well as headRefOid: expanding unchanged context needs the
      # whole file on *both* sides, and a blob is read at a commit. Added
      # 2026-09-01 for Task 26; it is the base-side counterpart of the field
      # beside it and is a non-null GitObjectID on PullRequest.
      baseRefName headRefName baseRefOid headRefOid
      permalink
      author { login avatarUrl }
      # GitHub rejects an approval of your own pull request. Comparing
      # author.login against the viewer would need the viewer's login, which
      # this query does not otherwise want; the schema answers the question
      # directly. Executed against the live schema on 2026-09-01.
      viewerDidAuthor
      reviewDecision
      viewerLatestReview { id state commit { oid } }
      latestReviews(first: 20) {
        nodes { author { login avatarUrl } state commit { oid } }
      }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ...RequestedReviewerFields } }
      }
      commits(last: 1) {
        nodes { commit {
          oid
          statusCheckRollup {
            state
            contexts(first: 100) {
              totalCount
              nodes {
                __typename
                ... on CheckRun {
                  name conclusion status detailsUrl
                  checkSuite { app { name } }
                }
                ... on StatusContext {
                  context state targetUrl description
                }
              }
            }
          }
        } }
      }
      files(first: 100) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...FileFields }
      }
      reviewThreads(first: 100) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...ReviewThreadFields }
      }
    }
  }
}
${FILE_FIELDS}
${REVIEW_THREAD_FIELDS}
${REQUESTED_REVIEWER_FIELDS}
`;

/** The next page of `files`, from the cursor the previous page ended on. */
export const FILES_PAGE_QUERY = `query PullRequestFilesPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ...FileFields }
      }
    }
  }
}
${FILE_FIELDS}
`;

/** The next page of `reviewThreads`, from the cursor the previous page ended on. */
export const REVIEW_THREADS_PAGE_QUERY = `query PullRequestReviewThreadsPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ...ReviewThreadFields }
      }
    }
  }
}
${REVIEW_THREAD_FIELDS}
`;

/**
 * The viewer's own PENDING review on this pull request, if they have one.
 *
 * GitHub allows exactly one, and refuses `addPullRequestReview` with "User can
 * only have one pending review per pull request" when a second is asked for.
 * That refusal is what this exists to prevent: a reviewer with a review already
 * open — started here, in another tab, or in GitHub's own UI — could neither
 * start a review nor post a single comment, because both begin by opening one.
 *
 * Two routes to the same fact, deliberately:
 *
 * - `viewerLatestReview` is "the latest review *given* from the viewer", and a
 *   PENDING review has not been given to anyone. It is not certain that it
 *   reports one, and the extension behaved as though it does.
 * - `reviews(states: [PENDING])` asks the question directly. A pending review
 *   is visible only to its author, so this connection can only ever return the
 *   viewer's own.
 *
 * Whichever answers, the id is the same. `PullRequestReviewState.PENDING` is
 * introspected (reference section 2); the `states` argument is not, which is
 * exactly why this is its own document rather than four more lines on
 * PULL_REQUEST_QUERY. A mistake here costs the ability to find an existing
 * review — a mistake there would fail validation and take the whole page down
 * with it. Fold it in once it has been executed against the live schema.
 */
export const VIEWER_PENDING_REVIEW = `query ViewerPendingReview($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      viewerLatestReview { id state }
      reviews(last: 20, states: [PENDING]) {
        nodes { id state }
      }
    }
  }
}
`;
