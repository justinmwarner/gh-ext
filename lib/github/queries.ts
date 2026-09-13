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
 *
 * `viewerCanUpdate` / `viewerCanDelete` are per *comment*, not per thread, and
 * that is why they are here rather than beside `viewerCanReply` above: a thread
 * routinely holds one comment the viewer wrote and four they did not. They come
 * from the `Updatable` and `Deletable` interfaces `PullRequestReviewComment`
 * implements — introspected 2026-09-05, along with the mutations they gate. A
 * missing flag has only one safe reading, "do not offer the control", so
 * dropping them here takes the edit and delete affordances off every comment
 * on the page.
 */
export const REVIEW_THREAD_FIELDS = `fragment ReviewThreadFields on PullRequestReviewThread {
  id isResolved isOutdated isCollapsed
  path line startLine originalLine originalStartLine
  diffSide startDiffSide subjectType
  viewerCanReply viewerCanResolve viewerCanUnresolve
  resolvedBy { login }
  comments(first: 50) {
    totalCount
    nodes {
      id author { login avatarUrl } body createdAt url
      viewerCanUpdate viewerCanDelete
    }
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
      # Where the head branch actually lives. The base pair is always in the
      # repository the route names, but a fork's head branch is not — linking
      # it there would point at a branch that does not exist, or worse at a
      # same-named branch that does and is somebody else's code.
      # The head repository is null once the fork is deleted, which is the case
      # the UI leaves as plain text. Executed against the live schema on
      # 2026-09-09.
      isCrossRepository
      headRepository { nameWithOwner }
      permalink
      # What this account may do here, which is not the same question as what
      # the pull request allows. Reviewing needs read access and GitHub says so;
      # *resolving a conversation* needs write access or authorship, and a
      # fine-grained token can never exceed the role it was issued under. So
      # READ is the one value that means the write controls on this page cannot
      # work, and it is read here rather than inferred from a failed mutation.
      repository { viewerPermission }
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
 * One commit in the pull request's own history.
 *
 * `parents(first: 1)` is what makes "show me just this commit" answerable at
 * all. The only diff endpoint available here compares two commits, so a single
 * commit is the compare between its parent and itself — and the parent has to
 * come from the commit rather than from its neighbour in the list, because the
 * first commit of a pull request has no neighbour and a list carrying commits
 * merged in from the base branch can put a commit beside one that is not its
 * parent.
 *
 * `author` is a `GitActor`: `name` is the string on the commit itself and
 * `user` is null whenever GitHub could not match the address to an account,
 * which is ordinary. Both are selected so a commit is still nameable either
 * way.
 *
 * Executed against live GitHub on 2026-09-04 (pierrecomputer/pierre#1).
 */
export const PR_COMMIT_FIELDS = `fragment PrCommitFields on PullRequestCommit {
  commit {
    oid abbreviatedOid messageHeadline committedDate
    author { name user { login } }
    parents(first: 1) { nodes { oid } }
  }
}`;

/**
 * The pull request's commits, oldest first.
 *
 * Its own document rather than four more lines on PULL_REQUEST_QUERY, for the
 * reason the pending-review lookup is: this is not needed to paint the diff,
 * and the batched read is what the 400ms budget is spent on. It is issued
 * alongside and settled, so a pull request whose commits could not be read
 * still renders — with the commit picker unavailable and saying so, rather
 * than with no page at all.
 *
 * `first`, not `last`: the connection is oldest-first, which is why the query
 * beside it reaches the head commit's checks with `commits(last: 1)`.
 *
 * `totalCount` is not decoration. **GitHub stops this connection at 250 nodes
 * and then reports `hasNextPage: false`** — observed on 2026-09-04 against
 * NixOS/nixpkgs#554614, whose `totalCount` is 626 — so following the cursors is
 * not enough to know the list is complete, and `totalCount` is the only field
 * that can say otherwise. See `lib/github/commits.ts`.
 */
export const PULL_REQUEST_COMMITS_QUERY = `query PullRequestCommits($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(first: 100) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...PrCommitFields }
      }
    }
  }
}
${PR_COMMIT_FIELDS}
`;

/** The next page of `commits`, from the cursor the previous page ended on. */
export const COMMITS_PAGE_QUERY = `query PullRequestCommitsPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...PrCommitFields }
      }
    }
  }
}
${PR_COMMIT_FIELDS}
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

/**
 * What the dashboard reads off a pull request it is only listing.
 *
 * Deliberately without `reviewThreads` — see {@link DASHBOARD_THREAD_FIELDS}.
 * Everything here is a scalar or a one-node connection, so a hundred and fifty
 * of these cost almost nothing.
 *
 * `mergeStateStatus` is in here on the strength of a probe rather than of the
 * documentation, which says it needs push access. It does not: executed
 * against `facebook/react` at `viewerPermission: READ` on 2026-09-13, it
 * returned `BLOCKED` normally. Re-verify with a fine-grained token before the
 * Ready to merge bucket is trusted — see the open questions in the spec.
 */
export const DASHBOARD_PR_FIELDS = `fragment DashboardPr on PullRequest {
  id number title url isDraft createdAt updatedAt headRefOid
  repository { nameWithOwner isPrivate }
  author { login }
  viewerDidAuthor
  reviewDecision
  viewerLatestReview { state commit { oid } }
  reviewRequests(first: 1) { totalCount }
  additions deletions changedFiles isReadByViewer
  mergeStateStatus
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

/**
 * The conversation counts, spread into the authored search and nowhere else.
 *
 * This fragment is the whole cost of the dashboard and the reason it is
 * separate. Spread into all four searches at `first: 100` with the nested
 * `comments(last: 1)`, the document measured **155 points and 30,450 nodes**.
 * Restricted to the authored search at `first: 25` it measures **17 points and
 * 3,100 nodes** — the same information, because the counts are read only by
 * the blocked-on-you rule and that rule returns nothing unless the viewer
 * wrote the pull request. Both figures are from live execution on 2026-09-13.
 *
 * `first: 25` rather than 100 is a budget, not a belief about how many threads
 * a pull request has. `totalCount` is selected so the shortfall is visible
 * rather than silent, which is the same bargain `REVIEW_THREAD_FIELDS` strikes
 * with `comments(first: 50)` above.
 *
 * `comments(last: 1)` is what separates a conversation waiting on the author
 * from one they already answered. Without it every pull request with an open
 * thread sits in blocked-on-you forever, including the ones where the author
 * replied last and is waiting on somebody else.
 */
export const DASHBOARD_THREAD_FIELDS = `fragment DashboardThreads on PullRequest {
  reviewThreads(first: 25) {
    totalCount
    nodes {
      isResolved
      comments(last: 1) { nodes { author { login } } }
    }
  }
}`;

/**
 * The four searches the dashboard is built from, in one request.
 *
 * Four rather than one because GitHub's qualifiers do not compose into a
 * single question. `involves:` covers author, assignee, mentions and
 * commenter, and does **not** cover a review request — so a pull request whose
 * only connection to the reviewer is that somebody asked them to look at it is
 * invisible to it. That is the single most important row on this page.
 *
 * Two of them exclude `author:@me`. Overlap is not a correctness problem —
 * `collectSummaries` merges by id — but it is wasted budget, and the exclusion
 * also makes the merge's "first record wins" rule easy to reason about: the
 * only pull request that can now appear twice is one the reviewer both
 * commented on and reviewed, and those two records are identical.
 *
 * Aliased into one document because four separate requests cost four round
 * trips and the same points. Executed live on 2026-09-13.
 */
export const DASHBOARD_QUERY = `query Dashboard($requested: String!, $mine: String!, $involved: String!, $reviewed: String!) {
  viewer { login }
  requested: search(query: $requested, type: ISSUE, first: 50) {
    issueCount
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { ...DashboardPr } }
  }
  mine: search(query: $mine, type: ISSUE, first: 50) {
    issueCount
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { ...DashboardPr ...DashboardThreads } }
  }
  involved: search(query: $involved, type: ISSUE, first: 50) {
    issueCount
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { ...DashboardPr } }
  }
  reviewed: search(query: $reviewed, type: ISSUE, first: 50) {
    issueCount
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { ...DashboardPr } }
  }
}
${DASHBOARD_PR_FIELDS}
${DASHBOARD_THREAD_FIELDS}
`;

/**
 * The search strings, which are data rather than part of the document.
 *
 * `sort:updated-desc` on every one: the first fifty of eighty-eight has to be
 * the fifty that moved most recently, or the cap silently drops exactly the
 * pull requests a reviewer is most likely to want.
 *
 * `@me` rather than the viewer's login, so nothing has to be interpolated into
 * a search string at the call site.
 */
export const DASHBOARD_SEARCHES = {
  requested: 'is:pr is:open review-requested:@me sort:updated-desc',
  mine: 'is:pr is:open author:@me sort:updated-desc',
  involved: 'is:pr is:open involves:@me -author:@me sort:updated-desc',
  reviewed: 'is:pr is:open reviewed-by:@me -author:@me sort:updated-desc',
} as const;

/**
 * Every repository this account has opened a pull request in.
 *
 * The direct answer to "have I forgotten one". `includeUserRepositories: true`
 * is required or the reviewer's own repositories are excluded, which on a
 * personal account is most of them. Private repositories are returned when the
 * token can see them — 19 came back for the developing account on 2026-09-13,
 * cost 1.
 *
 * `first: 100` with no pagination is deliberate. A hundred repositories you
 * have personally opened a pull request in is far outside what this feature is
 * for, and `totalCount` is selected so the shortfall can be stated rather than
 * hidden if it ever happens.
 */
export const CONTRIBUTED_REPOS_QUERY = `query ContributedRepos {
  viewer {
    login
    repositoriesContributedTo(
      first: 100
      contributionTypes: [PULL_REQUEST]
      includeUserRepositories: true
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes { nameWithOwner isPrivate }
    }
  }
}
`;
