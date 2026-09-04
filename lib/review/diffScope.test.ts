/**
 * Resolving "what am I looking at" into two commits.
 *
 * Every narrowing this page offers ends up here, because every one of them is
 * a compare between two commits — a single commit, a range, and "since my last
 * review" alike. Two of them are worth stating outright:
 *
 * - A commit the reviewer picked can stop existing. Force-pushes are ordinary,
 *   and a page that quietly shows the diff of a commit that is no longer in
 *   this pull request is worse than one that says it cannot.
 * - Line numbers only mean the same thing on both diffs when the commits do.
 *   A narrowed diff whose head is not the pull request's head numbers its
 *   additions against a different file, so a thread anchored at line 42 of the
 *   pull request's diff is *not* line 42 here.
 */

import { describe, expect, it } from 'vitest';
import type { PrCommit } from '../github/types';
import {
  type DiffScope,
  WHOLE_DIFF,
  commitLabel,
  resolveScope,
  scopeKey,
} from './diffScope';

const sha = (letter: string): string => letter.repeat(40);

const commit = (over: Partial<PrCommit> & { oid: string }): PrCommit => ({
  abbreviatedOid: over.oid.slice(0, 7),
  messageHeadline: 'A change',
  committedDate: '2026-08-30T09:15:00Z',
  authorLogin: 'rowan',
  authorName: 'Rowan',
  parentOid: null,
  ...over,
});

/** base — c1 — c2 — c3(head), which is what an ordinary pull request looks like. */
const COMMITS: PrCommit[] = [
  commit({ oid: sha('1'), parentOid: sha('a'), messageHeadline: 'First' }),
  commit({ oid: sha('2'), parentOid: sha('1'), messageHeadline: 'Second' }),
  commit({ oid: sha('3'), parentOid: sha('2'), messageHeadline: 'Third' }),
];

const CONTEXT = {
  commits: COMMITS,
  prBase: sha('a'),
  prHead: sha('3'),
  reviewedAt: null as string | null,
};

describe('resolveScope', () => {
  it('leaves the whole diff alone', () => {
    expect(resolveScope(WHOLE_DIFF, CONTEXT)).toEqual({ kind: 'whole' });
  });

  it('compares one commit against its own parent', () => {
    // Not against the previous entry in the list: the first commit of a pull
    // request has no previous entry, and a list ordered by date can put a
    // commit next to one that is not its parent at all.
    const resolved = resolveScope({ kind: 'commits', from: sha('2'), to: sha('2') }, CONTEXT);

    expect(resolved).toMatchObject({
      kind: 'narrowed',
      range: { base: sha('1'), head: sha('2') },
    });
  });

  it('treats a range as everything the selected commits changed', () => {
    // Base is the *parent* of the first selection, so selecting one commit and
    // selecting a range of one commit are the same request. Anything else and
    // the two controls disagree about what "selected" means.
    const resolved = resolveScope({ kind: 'commits', from: sha('1'), to: sha('3') }, CONTEXT);

    expect(resolved).toMatchObject({
      kind: 'narrowed',
      range: { base: sha('a'), head: sha('3') },
    });
  });

  it('orders the two ends by their place in the history, not by which was picked first', () => {
    // The reviewer may click the newer commit first. Handing GitHub the pair
    // the wrong way round answers HTTP 200 with an empty diff, which reads as
    // "these commits changed nothing".
    const resolved = resolveScope({ kind: 'commits', from: sha('3'), to: sha('1') }, CONTEXT);

    expect(resolved).toMatchObject({
      kind: 'narrowed',
      range: { base: sha('a'), head: sha('3') },
    });
  });

  it('reports a commit that is no longer in this pull request rather than comparing it', () => {
    // The force-push case. GitHub keeps the orphaned commit reachable for a
    // while, so the compare would succeed and show a diff against history this
    // pull request no longer has.
    const resolved = resolveScope({ kind: 'commits', from: sha('9'), to: sha('9') }, CONTEXT);

    expect(resolved.kind).toBe('lost');
    if (resolved.kind !== 'lost') throw new Error('unreachable');
    expect(resolved.message).toMatch(/no longer/i);
  });

  it('reports a commit whose parent GitHub did not resolve', () => {
    const rootOnly = {
      ...CONTEXT,
      commits: [commit({ oid: sha('1'), parentOid: null })],
      prHead: sha('1'),
    };

    const resolved = resolveScope({ kind: 'commits', from: sha('1'), to: sha('1') }, rootOnly);

    expect(resolved.kind).toBe('lost');
  });

  it('compares the reviewed commit against the head for the review preset', () => {
    // Not the parent of anything: "since my last review" means everything
    // after that point, and the reviewer has already read that commit.
    const resolved = resolveScope(
      { kind: 'since-review' },
      { ...CONTEXT, reviewedAt: sha('1') },
    );

    expect(resolved).toMatchObject({
      kind: 'narrowed',
      range: { base: sha('1'), head: sha('3') },
    });
  });

  it('says nothing has landed rather than asking for an empty diff', () => {
    const resolved = resolveScope(
      { kind: 'since-review' },
      { ...CONTEXT, reviewedAt: sha('3') },
    );

    expect(resolved.kind).toBe('unchanged');
  });

  it('refuses the review preset when the viewer has never reviewed', () => {
    expect(resolveScope({ kind: 'since-review' }, CONTEXT).kind).toBe('lost');
  });

  it('keeps the review preset when the reviewed commit was force-pushed away', () => {
    // Unlike a picked commit, this one is not a choice the reviewer can
    // correct — it is where GitHub says their review was left. A three-dot
    // compare against a commit that has left the history still answers the
    // question, from the merge base, so the preset keeps working.
    const resolved = resolveScope(
      { kind: 'since-review' },
      { ...CONTEXT, reviewedAt: sha('9') },
    );

    expect(resolved).toMatchObject({
      kind: 'narrowed',
      range: { base: sha('9'), head: sha('3') },
    });
  });
});

describe('which sides of a narrowed diff share the pull request’s line numbers', () => {
  it('trusts the additions side only when the narrowed head is the pull request head', () => {
    const atHead = resolveScope({ kind: 'since-review' }, { ...CONTEXT, reviewedAt: sha('1') });
    const older = resolveScope({ kind: 'commits', from: sha('2'), to: sha('2') }, CONTEXT);

    expect(atHead).toMatchObject({ sides: { additions: true } });
    expect(older).toMatchObject({ sides: { additions: false } });
  });

  it('trusts the deletions side only when the narrowed base is the pull request base', () => {
    // This is the one that was already wrong. "Since my last review" compares
    // from the reviewed commit, so its deletion lines number against that file
    // and not against the pull request's base — a LEFT-side thread anchored
    // there lands on whatever text happens to occupy the line.
    const sinceReview = resolveScope(
      { kind: 'since-review' },
      { ...CONTEXT, reviewedAt: sha('1') },
    );
    const wholeRange = resolveScope(
      { kind: 'commits', from: sha('1'), to: sha('3') },
      CONTEXT,
    );

    expect(sinceReview).toMatchObject({ sides: { deletions: false } });
    // A range starting at the first commit is based on the pull request's own
    // base commit, so the deletion side does line up.
    expect(wholeRange).toMatchObject({ sides: { deletions: true } });
  });
});

describe('scopeKey', () => {
  it('is stable for the same scope so a re-render does not re-fetch', () => {
    const a: DiffScope = { kind: 'commits', from: sha('1'), to: sha('3') };
    const b: DiffScope = { kind: 'commits', from: sha('1'), to: sha('3') };

    expect(scopeKey(a)).toBe(scopeKey(b));
  });

  it('separates the presets from each other and from the whole diff', () => {
    const keys = new Set([
      scopeKey(WHOLE_DIFF),
      scopeKey({ kind: 'since-review' }),
      scopeKey({ kind: 'commits', from: sha('1'), to: sha('1') }),
      scopeKey({ kind: 'commits', from: sha('1'), to: sha('3') }),
    ]);

    expect(keys.size).toBe(4);
  });
});

describe('commitLabel', () => {
  it('names a commit by its abbreviated oid and headline', () => {
    expect(commitLabel(COMMITS[1] as PrCommit)).toBe('2222222 Second');
  });
});
