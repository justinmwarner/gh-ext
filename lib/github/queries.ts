/**
 * The single batched read query issued on prefetch.
 *
 * Copied verbatim from docs/reference/github-review-api.md section 3, which was
 * executed against the live schema on 2026-09-01. Do not edit fields here
 * without re-verifying against the schema.
 */
export const PULL_REQUEST_QUERY = `query PullRequestReview($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title bodyHTML state isDraft merged
      baseRefName headRefName headRefOid
      permalink
      author { login avatarUrl }
      reviewDecision
      viewerLatestReview { id state commit { oid } }
      latestReviews(first: 20) {
        nodes { author { login avatarUrl } state commit { oid } }
      }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { __typename ... on User { login avatarUrl } } }
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
        nodes { path additions deletions changeType viewerViewedState }
      }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated isCollapsed
          path line startLine originalLine originalStartLine
          diffSide startDiffSide subjectType
          viewerCanReply viewerCanResolve viewerCanUnresolve
          resolvedBy { login }
          comments(first: 50) {
            nodes { id author { login avatarUrl } body createdAt url }
          }
        }
      }
    }
  }
}
`;
