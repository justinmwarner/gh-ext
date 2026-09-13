/**
 * The GraphQL response, flattened into the objects the rules read.
 *
 * The reason this is its own module rather than a few lines in the worker is
 * that almost every way the dashboard can be quietly wrong lives here. A null
 * read as a zero, a check rollup that is absent read as one that passed, an
 * ISO string left as a string and compared against a number — none of those
 * throw, and all of them produce a list that looks right.
 *
 * Pure: no DOM, no `chrome.*`, no network. The query it parses is
 * `DASHBOARD_QUERY` in `lib/github/queries.ts`, executed against the live
 * schema on 2026-09-13.
 */

import type { PrSummary } from './buckets';

/** Which search a node came from. The flag only the first one can set. */
export interface SummaryContext {
  viewerLogin: string;
  /**
   * True only for nodes from the `review-requested:@me` search.
   *
   * It cannot be read off a field. `reviewRequests` empties the moment a
   * review is submitted, so a request that is still outstanding and one that
   * was answered an hour ago look identical on the node — the search is the
   * only thing that still knows the difference.
   */
  reviewRequested: boolean;
}

/** Enough of the node to be worth naming. The query selects exactly this. */
type Node = Record<string, unknown>;

const asRecord = (value: unknown): Node | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Node)
    : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * An ISO instant as epoch milliseconds, or 0 when it was not one.
 *
 * Zero rather than throwing: a pull request with an unreadable timestamp is
 * still a pull request the reviewer should see, and 1970 sorts it to the
 * bottom of a list ordered by recency, which is where an unknown belongs.
 */
function instant(value: unknown): number {
  const text = asString(value);
  if (text === null) return 0;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The login of whoever spoke last in a thread, or null.
 *
 * Null means a deleted account, not an absent one — GitHub keeps the comment
 * and drops the author. {@link countThreads} reads that null as "somebody
 * else", because the alternative is taking a pull request out of
 * blocked-on-you on the strength of a missing field.
 */
function lastSpeaker(thread: Node): string | null {
  const comments = asRecord(thread['comments']);
  const nodes = asArray(comments?.['nodes']);
  const last = asRecord(nodes[nodes.length - 1]);
  return asString(asRecord(last?.['author'])?.['login']);
}

interface ThreadCounts {
  unresolvedCount: number;
  unresolvedNotByViewer: number;
  threadsTruncated: boolean;
}

/**
 * The two conversation counts, and whether the list they came from was capped.
 *
 * Only the authored search selects `reviewThreads` at all — the counts feed
 * `blockedOnYou`, which returns null unless the viewer wrote the pull request,
 * so asking for them on the other three searches was buying nothing. That one
 * change took the query from 155 points to 17, measured.
 */
function countThreads(node: Node, viewerLogin: string): ThreadCounts {
  const threads = asRecord(node['reviewThreads']);
  if (threads === null) {
    return { unresolvedCount: 0, unresolvedNotByViewer: 0, threadsTruncated: false };
  }

  const nodes = asArray(threads['nodes']);
  let unresolvedCount = 0;
  let unresolvedNotByViewer = 0;

  for (const raw of nodes) {
    const thread = asRecord(raw);
    if (thread === null || thread['isResolved'] === true) continue;
    unresolvedCount += 1;
    if (lastSpeaker(thread) !== viewerLogin) unresolvedNotByViewer += 1;
  }

  return {
    unresolvedCount,
    unresolvedNotByViewer,
    threadsTruncated: asNumber(threads['totalCount']) > nodes.length,
  };
}

/** The head commit's check rollup state, or null when there is no rollup. */
function checkState(node: Node): string | null {
  const commits = asRecord(node['commits']);
  const first = asRecord(asArray(commits?.['nodes'])[0]);
  const rollup = asRecord(asRecord(first?.['commit'])?.['statusCheckRollup']);
  return asString(rollup?.['state']);
}

/** One search result node as a {@link PrSummary}. */
export function toSummary(raw: unknown, context: SummaryContext): PrSummary {
  const node = asRecord(raw) ?? {};
  const repository = asRecord(node['repository']);
  const review = asRecord(node['viewerLatestReview']);

  return {
    id: asString(node['id']) ?? '',
    number: asNumber(node['number']),
    title: asString(node['title']) ?? '',
    url: asString(node['url']) ?? '',
    repo: asString(repository?.['nameWithOwner']) ?? '',
    isPrivate: repository?.['isPrivate'] === true,
    author: asString(asRecord(node['author'])?.['login']),
    isDraft: node['isDraft'] === true,
    createdAt: instant(node['createdAt']),
    updatedAt: instant(node['updatedAt']),
    headRefOid: asString(node['headRefOid']) ?? '',
    viewerDidAuthor: node['viewerDidAuthor'] === true,
    reviewRequestedFromViewer: context.reviewRequested,
    reviewDecision: asString(node['reviewDecision']),
    viewerLatestReview:
      review === null
        ? null
        : {
            state: asString(review['state']) ?? '',
            commitOid: asString(asRecord(review['commit'])?.['oid']),
          },
    reviewRequestCount: asNumber(asRecord(node['reviewRequests'])?.['totalCount']),
    checks: checkState(node),
    mergeStateStatus: asString(node['mergeStateStatus']),
    ...countThreads(node, context.viewerLogin),
    additions: asNumber(node['additions']),
    deletions: asNumber(node['deletions']),
    changedFiles: asNumber(node['changedFiles']),
    isReadByViewer: node['isReadByViewer'] === true,
  };
}

/** A search that returned fewer pull requests than it counted. */
export interface Shortfall {
  search: SearchName;
  shown: number;
  total: number;
}

export type SearchName = 'requested' | 'mine' | 'involved' | 'reviewed';

/**
 * The four searches, in the order they are read.
 *
 * `requested` is first because it is the only one that can set
 * `reviewRequestedFromViewer`, and the merge below keeps the first record it
 * saw for any id. `mine` is second because it is the only one carrying thread
 * counts. The other two are slim and interchangeable.
 */
const SEARCHES: readonly SearchName[] = ['requested', 'mine', 'involved', 'reviewed'];

export interface Collected {
  viewerLogin: string;
  prs: PrSummary[];
  /**
   * Which searches stopped short of what they counted.
   *
   * Never empty by accident. Search answers `hasNextPage: false` past its
   * thousandth result, so a client that paginates on that flag concludes it
   * has everything — which is why this is derived from `issueCount` against
   * the number of nodes actually returned, and not from `pageInfo`.
   */
  truncated: Shortfall[];
}

/**
 * Every pull request the four searches found, each listed once.
 *
 * The searches overlap by construction — `involves:@me` and `reviewed-by:@me`
 * both return a pull request the reviewer commented on and reviewed — so the
 * merge keeps the *first* record for an id rather than the last. First, not
 * last, because the earlier searches are the richer ones: `requested` carries
 * a flag no field can reconstruct and `mine` carries thread counts the others
 * do not select. Last-write-wins would quietly replace both with a slimmer
 * copy and the row would lose the reason it was at the top of the list.
 */
export function collectSummaries(data: unknown): Collected {
  const root = asRecord(data) ?? {};
  const viewerLogin = asString(asRecord(root['viewer'])?.['login']) ?? '';

  const byId = new Map<string, PrSummary>();
  const truncated: Shortfall[] = [];

  for (const name of SEARCHES) {
    const search = asRecord(root[name]);
    if (search === null) continue;

    const nodes = asArray(search['nodes']);
    const total = asNumber(search['issueCount']);
    if (total > nodes.length) {
      truncated.push({ search: name, shown: nodes.length, total });
    }

    for (const raw of nodes) {
      const summary = toSummary(raw, {
        viewerLogin,
        reviewRequested: name === 'requested',
      });
      if (summary.id !== '' && !byId.has(summary.id)) byId.set(summary.id, summary);
    }
  }

  return { viewerLogin, prs: [...byId.values()], truncated };
}
