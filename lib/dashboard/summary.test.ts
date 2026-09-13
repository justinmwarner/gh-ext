import { describe, expect, it } from 'vitest';
import { collectSummaries, toSummary } from './summary';

/** One node as the live query returns it. Shape confirmed 2026-09-13. */
const node = (overrides: Record<string, unknown> = {}) => ({
  id: 'PR_1',
  number: 7,
  title: 'Do the thing',
  url: 'https://github.com/acme/widgets/pull/7',
  isDraft: false,
  createdAt: '2026-09-10T09:00:00Z',
  updatedAt: '2026-09-12T09:00:00Z',
  headRefOid: 'aaa',
  repository: { nameWithOwner: 'acme/widgets', isPrivate: false },
  author: { login: 'someone' },
  viewerDidAuthor: false,
  reviewDecision: null,
  viewerLatestReview: null,
  reviewRequests: { totalCount: 0 },
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  isReadByViewer: true,
  mergeStateStatus: 'CLEAN',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...overrides,
});

const ctx = { viewerLogin: 'me', reviewRequested: false };

describe('toSummary', () => {
  it('turns the timestamps into epoch milliseconds', () => {
    // Everything here crosses runtime.sendMessage, which serializes as JSON.
    // An ISO string would survive; a Date would not, and the rule in
    // lib/messages.ts is that instants are numbers.
    const result = toSummary(node(), ctx);

    expect(result.createdAt).toBe(Date.parse('2026-09-10T09:00:00Z'));
    expect(result.updatedAt).toBe(Date.parse('2026-09-12T09:00:00Z'));
  });

  it('flattens the repository to owner/name', () => {
    expect(toSummary(node(), ctx).repo).toBe('acme/widgets');
  });

  it('survives a deleted author', () => {
    // GitHub still returns pull requests whose author account is gone.
    expect(toSummary(node({ author: null }), ctx).author).toBeNull();
  });

  it('reads the check rollup off the last commit', () => {
    expect(toSummary(node(), ctx).checks).toBe('SUCCESS');
  });

  it('calls a head commit with no checks null rather than passing', () => {
    // "No checks configured" and "checks passed" are different facts and the
    // second one is a claim this page has no business inventing.
    const result = toSummary(
      node({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
      ctx,
    );

    expect(result.checks).toBeNull();
  });

  it('survives a pull request with no commits in the selection', () => {
    expect(toSummary(node({ commits: { nodes: [] } }), ctx).checks).toBeNull();
  });

  it('flattens the reviewer commit oid', () => {
    const result = toSummary(
      node({ viewerLatestReview: { state: 'APPROVED', commit: { oid: 'bbb' } } }),
      ctx,
    );

    expect(result.viewerLatestReview).toEqual({ state: 'APPROVED', commitOid: 'bbb' });
  });

  it('keeps a null review commit null rather than inventing one', () => {
    const result = toSummary(
      node({ viewerLatestReview: { state: 'COMMENTED', commit: null } }),
      ctx,
    );

    expect(result.viewerLatestReview).toEqual({ state: 'COMMENTED', commitOid: null });
  });

  it('marks a pull request that came from the review-requested search', () => {
    const result = toSummary(node(), { viewerLogin: 'me', reviewRequested: true });

    expect(result.reviewRequestedFromViewer).toBe(true);
  });
});

describe('toSummary, review threads', () => {
  const withThreads = (nodes: unknown[], totalCount = nodes.length) =>
    node({ reviewThreads: { totalCount, nodes } });

  const thread = (isResolved: boolean, lastAuthor: string | null) => ({
    isResolved,
    comments: { nodes: lastAuthor === null ? [] : [{ author: { login: lastAuthor } }] },
  });

  it('counts unresolved conversations', () => {
    const result = toSummary(
      withThreads([thread(false, 'them'), thread(true, 'them'), thread(false, 'them')]),
      ctx,
    );

    expect(result.unresolvedCount).toBe(2);
  });

  it('counts only the unresolved ones somebody else spoke in last', () => {
    const result = toSummary(
      withThreads([thread(false, 'them'), thread(false, 'me'), thread(false, 'them')]),
      ctx,
    );

    expect(result.unresolvedNotByViewer).toBe(2);
  });

  it('treats a thread whose last comment has no author as somebody else', () => {
    // A deleted account leaves the comment and drops the login. Reading that
    // as "mine" would take the pull request out of blocked-on-you on the
    // strength of a missing field.
    const result = toSummary(withThreads([thread(false, null)]), ctx);

    expect(result.unresolvedNotByViewer).toBe(1);
  });

  it('says when the thread list was capped', () => {
    const result = toSummary(withThreads([thread(false, 'them')], 40), ctx);

    expect(result.threadsTruncated).toBe(true);
  });

  it('does not claim truncation when the whole list arrived', () => {
    expect(toSummary(withThreads([thread(false, 'them')]), ctx).threadsTruncated).toBe(false);
  });

  it('reports no conversations for a node the query did not ask threads of', () => {
    // Only the authored search selects them, because only the author's own
    // pull requests can land in blocked-on-you.
    const result = toSummary(node(), ctx);

    expect(result.unresolvedCount).toBe(0);
    expect(result.threadsTruncated).toBe(false);
  });
});

describe('collectSummaries', () => {
  const search = (nodes: unknown[], hasNextPage = false, issueCount = nodes.length) => ({
    issueCount,
    pageInfo: { hasNextPage },
    nodes,
  });

  it('merges the four searches into one list', () => {
    const data = {
      viewer: { login: 'me' },
      requested: search([node({ id: 'A' })]),
      mine: search([node({ id: 'B', viewerDidAuthor: true })]),
      involved: search([node({ id: 'C' })]),
      reviewed: search([node({ id: 'D' })]),
    };

    const result = collectSummaries(data);

    expect(result.prs.map((pr) => pr.id).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('lists a pull request found by two searches once', () => {
    const data = {
      viewer: { login: 'me' },
      requested: search([]),
      mine: search([]),
      involved: search([node({ id: 'A' })]),
      reviewed: search([node({ id: 'A' })]),
    };

    expect(collectSummaries(data).prs).toHaveLength(1);
  });

  it('keeps the review-requested flag when a later search also returned it', () => {
    // The requested search is the only one that can set the flag, and it is
    // read first. A plain last-write-wins merge would drop it.
    const data = {
      viewer: { login: 'me' },
      requested: search([node({ id: 'A' })]),
      mine: search([]),
      involved: search([node({ id: 'A' })]),
      reviewed: search([]),
    };

    expect(collectSummaries(data).prs[0]?.reviewRequestedFromViewer).toBe(true);
  });

  it('keeps the thread counts when a slimmer search also returned it', () => {
    const threaded = node({
      id: 'A',
      viewerDidAuthor: true,
      reviewThreads: {
        totalCount: 1,
        nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: 'them' } }] } }],
      },
    });
    const data = {
      viewer: { login: 'me' },
      requested: search([]),
      mine: search([threaded]),
      involved: search([node({ id: 'A', viewerDidAuthor: true })]),
      reviewed: search([]),
    };

    expect(collectSummaries(data).prs[0]?.unresolvedNotByViewer).toBe(1);
  });

  it('reports which searches stopped short', () => {
    // Search answers hasNextPage: false past its thousandth result, so a list
    // that stopped has to say so rather than read as complete.
    const data = {
      viewer: { login: 'me' },
      requested: search([], false),
      mine: search([node({ id: 'B' })], true, 86),
      involved: search([], false),
      reviewed: search([], false),
    };

    const result = collectSummaries(data);

    expect(result.truncated).toEqual([{ search: 'mine', shown: 1, total: 86 }]);
  });

  it('reports nothing truncated when every search finished', () => {
    const data = {
      viewer: { login: 'me' },
      requested: search([]),
      mine: search([node({ id: 'B' })]),
      involved: search([]),
      reviewed: search([]),
    };

    expect(collectSummaries(data).truncated).toEqual([]);
  });

  it('carries the viewer login through', () => {
    const data = {
      viewer: { login: 'me' },
      requested: search([]),
      mine: search([]),
      involved: search([]),
      reviewed: search([]),
    };

    expect(collectSummaries(data).viewerLogin).toBe('me');
  });
});
