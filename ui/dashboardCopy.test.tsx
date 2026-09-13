import { describe, expect, it } from 'vitest';
import type { Reason } from '@/lib/dashboard/buckets';
import { describeLapse, describeReason, relativeAge } from './dashboardCopy';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-13T12:00:00Z');

describe('relativeAge', () => {
  it('calls the last minute just now', () => {
    expect(relativeAge(NOW - 30_000, NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(relativeAge(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(relativeAge(NOW - 3 * 3_600_000, NOW)).toBe('3 hours ago');
    expect(relativeAge(NOW - 4 * DAY, NOW)).toBe('4 days ago');
  });

  it('says one rather than 1', () => {
    expect(relativeAge(NOW - 60_000, NOW)).toBe('1 minute ago');
    expect(relativeAge(NOW - 3_600_000, NOW)).toBe('1 hour ago');
    expect(relativeAge(NOW - DAY, NOW)).toBe('1 day ago');
  });

  it('switches to months past sixty days', () => {
    // A row reading "412 days ago" is a number nobody converts. Months are
    // the unit somebody actually reasons in at that range.
    expect(relativeAge(NOW - 90 * DAY, NOW)).toBe('3 months ago');
    expect(relativeAge(NOW - 400 * DAY, NOW)).toBe('13 months ago');
  });

  it('does not produce a negative age from a clock that disagrees', () => {
    // The instant comes from GitHub and `now` from the reviewer's machine, so
    // a future timestamp is ordinary rather than impossible.
    expect(relativeAge(NOW + 10 * 60_000, NOW)).toBe('just now');
  });

  it('says nothing useful about an instant it never got', () => {
    expect(relativeAge(0, NOW)).toBe('at an unknown time');
  });
});

describe('describeReason', () => {
  const cases: [Reason, string][] = [
    [{ kind: 'review-requested' }, 'Your review was requested'],
    [{ kind: 'pushed-since-review' }, 'Pushed since your review'],
    [{ kind: 'changes-requested' }, 'Changes requested'],
    [{ kind: 'conflicts' }, 'Conflicts with the base branch'],
    [{ kind: 'checks-failing' }, 'Checks failed'],
    [{ kind: 'approved-and-clean' }, 'Approved and mergeable'],
    [{ kind: 'draft' }, 'Draft'],
  ];

  for (const [reason, expected] of cases) {
    it(`describes ${reason.kind}`, () => {
      expect(describeReason(reason, false)).toBe(expected);
    });
  }

  it('counts unresolved conversations', () => {
    expect(describeReason({ kind: 'unresolved', count: 1 }, false)).toBe(
      '1 unresolved conversation',
    );
    expect(describeReason({ kind: 'unresolved', count: 3 }, false)).toBe(
      '3 unresolved conversations',
    );
  });

  it('says at least when the thread list was capped', () => {
    // The query reads 25 threads per pull request. Past that the count is a
    // floor, and a bare number would be a claim the data does not support.
    expect(describeReason({ kind: 'unresolved', count: 25 }, true)).toBe(
      'At least 25 unresolved conversations',
    );
  });

  it('counts reviewers still being waited on', () => {
    expect(describeReason({ kind: 'awaiting-reviewers', count: 1 }, false)).toBe(
      'Waiting on 1 reviewer',
    );
    expect(describeReason({ kind: 'awaiting-reviewers', count: 2 }, false)).toBe(
      'Waiting on 2 reviewers',
    );
  });

  it('names why an approved pull request is not mergeable', () => {
    expect(describeReason({ kind: 'approved-not-clean', status: 'BLOCKED' }, false)).toBe(
      'Approved, merging is blocked',
    );
    expect(describeReason({ kind: 'approved-not-clean', status: 'BEHIND' }, false)).toBe(
      'Approved, behind the base branch',
    );
    expect(describeReason({ kind: 'approved-not-clean', status: 'UNSTABLE' }, false)).toBe(
      'Approved, checks still running',
    );
  });

  it('does not invent a cause it was not given', () => {
    expect(describeReason({ kind: 'approved-not-clean', status: null }, false)).toBe(
      'Approved, not mergeable yet',
    );
    expect(
      describeReason({ kind: 'approved-not-clean', status: 'SOMETHING_NEW' }, false),
    ).toBe('Approved, not mergeable yet');
  });

  it('says how long a quiet pull request has been quiet', () => {
    expect(describeReason({ kind: 'quiet', days: 40 }, false)).toBe('No activity in 40 days');
    expect(describeReason({ kind: 'quiet', days: 1 }, false)).toBe('No activity in 1 day');
  });

  it('says nothing rather than something vague when there is no reason', () => {
    expect(describeReason({ kind: 'nothing' }, false)).toBe('');
  });

  it('never uses an exclamation mark or an emoji', () => {
    // PRODUCT.md's voice section, as a test rather than as a convention.
    const all: Reason[] = [
      ...cases.map(([reason]) => reason),
      { kind: 'unresolved', count: 2 },
      { kind: 'awaiting-reviewers', count: 2 },
      { kind: 'approved-not-clean', status: 'BLOCKED' },
      { kind: 'quiet', days: 3 },
    ];

    for (const reason of all) {
      const text = describeReason(reason, false);
      expect(text).not.toMatch(/!/);
      expect(text).toMatch(/^[\w\s,.'-]*$/);
    }
  });
});

describe('describeLapse', () => {
  it('says a push retired the override', () => {
    expect(describeLapse('pushed')).toBe('Moved back: there was a push');
  });

  it('says a change retired the override', () => {
    expect(describeLapse('changed')).toBe('Moved back: something happened here');
  });
});
