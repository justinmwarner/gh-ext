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
      baseRefName headRefName headRefOid
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
