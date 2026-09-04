/**
 * Reading `PullRequest.commits` into something the picker can list.
 *
 * The interesting half is the cap, and it is not the one the pagination module
 * already handles. Observed against the live API on 2026-09-04, on
 * `NixOS/nixpkgs#554614`, whose `commits.totalCount` is 626:
 *
 *     page 1: 100 nodes, hasNextPage true
 *     page 2: 100 nodes, hasNextPage true
 *     page 3:  50 nodes, hasNextPage **false**
 *
 * GitHub stops at 250 and then says the walk finished. So `hasNextPage` cannot
 * detect this, `collectConnection` reports `truncated: false` in perfect good
 * faith, and a picker built on that would show 250 commits and let the reviewer
 * believe they were looking at all 626. `totalCount` is the only field that
 * knows, so the shortfall is measured against it.
 */

import { describe, expect, it } from 'vitest';
import { toCommitList } from './commits';

const node = (over: Record<string, unknown> = {}) => ({
  commit: {
    oid: 'a'.repeat(40),
    abbreviatedOid: 'aaaaaaa',
    messageHeadline: 'Cache the diff on head SHA',
    committedDate: '2026-08-30T09:15:00Z',
    author: { name: 'Rowan', user: { login: 'rowan' } },
    parents: { nodes: [{ oid: 'b'.repeat(40) }] },
    ...over,
  },
});

describe('toCommitList', () => {
  it('reads a commit into the shape the picker and the scope want', () => {
    const { commits } = toCommitList({ nodes: [node()], truncated: false }, 1);

    expect(commits).toEqual([
      {
        oid: 'a'.repeat(40),
        abbreviatedOid: 'aaaaaaa',
        messageHeadline: 'Cache the diff on head SHA',
        committedDate: '2026-08-30T09:15:00Z',
        authorLogin: 'rowan',
        authorName: 'Rowan',
        parentOid: 'b'.repeat(40),
      },
    ]);
  });

  it('keeps a commit whose author GitHub could not match to an account', () => {
    // Ordinary: a commit authored from an email address with no GitHub user.
    // Dropping it would put a gap in the history the reviewer is picking from.
    const { commits } = toCommitList(
      { nodes: [node({ author: { name: 'Rowan', user: null } })], truncated: false },
      1,
    );

    expect(commits[0]).toMatchObject({ authorLogin: null, authorName: 'Rowan' });
  });

  it('keeps a root commit, with no parent to compare against', () => {
    const { commits } = toCommitList(
      { nodes: [node({ parents: { nodes: [] } })], truncated: false },
      1,
    );

    expect(commits[0]).toMatchObject({ parentOid: null });
  });

  it('falls back to the full oid when GitHub sent no abbreviation', () => {
    const { commits } = toCommitList(
      { nodes: [node({ abbreviatedOid: null })], truncated: false },
      1,
    );

    expect(commits[0]?.abbreviatedOid).toBe('a'.repeat(40).slice(0, 7));
  });

  it('drops a node with no oid rather than listing a commit it cannot compare', () => {
    const { commits } = toCommitList(
      { nodes: [node({ oid: null }), node()], truncated: false },
      2,
    );

    expect(commits).toHaveLength(1);
  });

  it('reports truncation when the pagination walk stopped short', () => {
    expect(toCommitList({ nodes: [node()], truncated: true }, 1).truncated).toBe(true);
  });

  it('reports truncation when GitHub finished the walk with commits still missing', () => {
    // The 250 ceiling. `truncated` is false because the connection said the
    // walk was done, and it is still short by 376.
    const nodes = Array.from({ length: 250 }, (_, index) =>
      node({ oid: String(index).padStart(40, '0') }),
    );

    expect(toCommitList({ nodes, truncated: false }, 626).truncated).toBe(true);
  });

  it('does not cry truncation when a node was dropped for being unreadable', () => {
    // A count that disagrees because this module skipped a broken node is not
    // GitHub withholding anything, and a notice about it would be a lie the
    // reviewer cannot act on.
    expect(
      toCommitList({ nodes: [node({ oid: null }), node()], truncated: false }, 2).truncated,
    ).toBe(false);
  });

  it('does not cry truncation when GitHub sent no count at all', () => {
    expect(toCommitList({ nodes: [node()], truncated: false }, null).truncated).toBe(false);
  });
});
