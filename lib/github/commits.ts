/**
 * `PullRequest.commits`, read into the list the commit picker offers.
 *
 * Pure: it is handed nodes and a count and knows nothing about transports.
 *
 * **GitHub stops this connection at 250 and then says the walk is finished.**
 * Observed on 2026-09-04 against `NixOS/nixpkgs#554614`, whose `totalCount` is
 * 626: three pages of 100, 100, 50, and `hasNextPage: false` on the third. So
 * the cap `lib/github/pagination.ts` guards against is not the only one here,
 * and it is not the one that bites — `collectConnection` reports the walk
 * complete in perfect good faith while 376 commits are missing.
 *
 * `totalCount` is the only field that knows, so the shortfall is measured
 * against it and reported the way every other cap in this extension is: said on
 * screen rather than silently absorbed. Selecting a commit the reviewer cannot
 * see is not a thing they can be asked to notice.
 */

import type { PrCommit } from './types';
import type { Paged } from './pagination';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export interface CommitList {
  /** Oldest first, the order GitHub returns and the order a branch reads in. */
  commits: PrCommit[];
  /** Commits GitHub has and did not send. See the note above. */
  truncated: boolean;
}

/**
 * One `PullRequestCommit` node.
 *
 * Every level is optional because GraphQL nulls out what it could not resolve
 * while still answering HTTP 200. A node with no `oid` is dropped rather than
 * defaulted: the oid is the only thing that makes a commit selectable, and a
 * row that cannot be compared against anything is worse than a shorter list.
 */
function readCommit(node: unknown): PrCommit | null {
  if (!isRecord(node)) return null;
  const commit = node['commit'];
  if (!isRecord(commit)) return null;

  const oid = readString(commit['oid']);
  if (oid === null) return null;

  const author = isRecord(commit['author']) ? commit['author'] : null;
  const user = author !== null && isRecord(author['user']) ? author['user'] : null;

  const parents = isRecord(commit['parents']) ? commit['parents']['nodes'] : null;
  const firstParent = Array.isArray(parents) ? parents[0] : null;

  return {
    oid,
    // GitHub's own abbreviation is longer in a large repository, so it is
    // selected rather than computed. The slice is only for when it is missing.
    abbreviatedOid: readString(commit['abbreviatedOid']) ?? oid.slice(0, 7),
    messageHeadline: readString(commit['messageHeadline']) ?? '(no message)',
    committedDate: readString(commit['committedDate']) ?? '',
    authorLogin: user === null ? null : readString(user['login']),
    authorName: author === null ? null : readString(author['name']),
    parentOid: isRecord(firstParent) ? readString(firstParent['oid']) : null,
  };
}

/**
 * `truncated` is true when the walk stopped short **or** when GitHub finished
 * it having sent fewer nodes than it says exist.
 *
 * Measured on the nodes the walk delivered rather than on the commits this
 * module could read, so a row dropped above for being unreadable does not read
 * as GitHub withholding something. That distinction matters: one is a notice
 * the reviewer can act on by going to GitHub, the other is a bug here.
 */
export function toCommitList(paged: Paged<unknown>, totalCount: unknown): CommitList {
  const commits: PrCommit[] = [];
  for (const node of paged.nodes) {
    const commit = readCommit(node);
    if (commit !== null) commits.push(commit);
  }

  const total = typeof totalCount === 'number' && Number.isFinite(totalCount)
    ? totalCount
    : null;

  return {
    commits,
    truncated: paged.truncated || (total !== null && paged.nodes.length < total),
  };
}
