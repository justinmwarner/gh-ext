/**
 * Reading `statusCheckRollup.contexts`.
 *
 * The connection is a union of `CheckRun` and `StatusContext` and both turn up
 * on real pull requests — `nodejs/node#60000` carried 41 of the first and 32 of
 * the second on one commit. A reader that understands only one of them drops
 * half the CI silently, which reads as "that check does not exist".
 */

import { describe, expect, it } from 'vitest';
import { checksSummary } from './checks';

const rollup = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({
  state: 'SUCCESS',
  contexts: { totalCount: nodes.length, nodes, ...extra },
});

const checkRun = (overrides: Record<string, unknown> = {}) => ({
  __typename: 'CheckRun',
  name: 'Compile & Hygiene',
  conclusion: 'SUCCESS',
  status: 'COMPLETED',
  detailsUrl: 'https://github.com/nodejs/node/actions/runs/1/job/2',
  checkSuite: { app: { name: 'GitHub Actions' } },
  ...overrides,
});

const statusContext = (overrides: Record<string, unknown> = {}) => ({
  __typename: 'StatusContext',
  context: 'node-test-commit',
  state: 'SUCCESS',
  targetUrl: 'https://ci.nodejs.org/job/node-test-commit/83114/',
  description: 'tests passed',
  ...overrides,
});

describe('checksSummary', () => {
  it('reports the absence of checks rather than an error', () => {
    // `statusCheckRollup` is null when the head commit has no CI configured at
    // all, which is not the same thing as a check that has not finished.
    expect(checksSummary(null)).toEqual({ kind: 'none' });
  });

  it('reads a CheckRun', () => {
    const summary = checksSummary(rollup([checkRun()]));
    expect(summary.kind).toBe('contexts');
    if (summary.kind !== 'contexts') return;

    expect(summary.contexts[0]?.name).toBe('Compile & Hygiene');
    expect(summary.contexts[0]?.label).toMatch(/passed/i);
    expect(summary.contexts[0]?.tone).toBe('good');
    expect(summary.contexts[0]?.url).toBe(
      'https://github.com/nodejs/node/actions/runs/1/job/2',
    );
    expect(summary.contexts[0]?.detail).toBe('GitHub Actions');
  });

  it('reads a StatusContext', () => {
    const summary = checksSummary(rollup([statusContext()]));
    expect(summary.kind).toBe('contexts');
    if (summary.kind !== 'contexts') return;

    expect(summary.contexts[0]?.name).toBe('node-test-commit');
    expect(summary.contexts[0]?.label).toMatch(/passed/i);
    expect(summary.contexts[0]?.tone).toBe('good');
    expect(summary.contexts[0]?.url).toBe(
      'https://ci.nodejs.org/job/node-test-commit/83114/',
    );
    expect(summary.contexts[0]?.detail).toBe('tests passed');
  });

  it('reads both union members out of one connection', () => {
    const summary = checksSummary(rollup([checkRun(), statusContext()]));
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts.map((c) => c.name)).toEqual([
      'Compile & Hygiene',
      'node-test-commit',
    ]);
  });

  it('says how many contexts the page left behind', () => {
    // `contexts(first: 100)` caps. A pull request with more than a hundred
    // checks must not silently show a hundred as if that were all of them.
    const summary = checksSummary(rollup([checkRun()], { totalCount: 140 }));
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.withheld).toBe(139);
  });

  const conclusions: [string, string, string][] = [
    ['SUCCESS', 'good', 'passed'],
    ['FAILURE', 'bad', 'failed'],
    ['TIMED_OUT', 'bad', 'timed out'],
    ['STARTUP_FAILURE', 'bad', 'failed to start'],
    ['ACTION_REQUIRED', 'bad', 'action required'],
    ['CANCELLED', 'neutral', 'cancelled'],
    ['NEUTRAL', 'neutral', 'neutral'],
    ['SKIPPED', 'neutral', 'skipped'],
    ['STALE', 'neutral', 'stale'],
  ];

  for (const [conclusion, tone, label] of conclusions) {
    it(`maps the ${conclusion} conclusion`, () => {
      const summary = checksSummary(rollup([checkRun({ conclusion })]));
      if (summary.kind !== 'contexts') throw new Error('expected contexts');

      expect(summary.contexts[0]?.tone).toBe(tone);
      expect(summary.contexts[0]?.label.toLowerCase()).toContain(label);
    });
  }

  const states: [string, string, string][] = [
    ['SUCCESS', 'good', 'passed'],
    ['FAILURE', 'bad', 'failed'],
    ['ERROR', 'bad', 'errored'],
    ['PENDING', 'pending', 'pending'],
    ['EXPECTED', 'pending', 'expected'],
  ];

  for (const [state, tone, label] of states) {
    it(`maps the ${state} status state`, () => {
      const summary = checksSummary(rollup([statusContext({ state })]));
      if (summary.kind !== 'contexts') throw new Error('expected contexts');

      expect(summary.contexts[0]?.tone).toBe(tone);
      expect(summary.contexts[0]?.label.toLowerCase()).toContain(label);
    });
  }

  it('describes a run that has not concluded by its status', () => {
    const summary = checksSummary(
      rollup([checkRun({ conclusion: null, status: 'IN_PROGRESS' })]),
    );
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts[0]?.tone).toBe('pending');
    expect(summary.contexts[0]?.label.toLowerCase()).toContain('running');
  });

  it('degrades an unmapped conclusion into words rather than a blank', () => {
    // GitHub has added members to these enums before. A check that renders as
    // an empty row is indistinguishable from one that is not there.
    const summary = checksSummary(
      rollup([checkRun({ conclusion: 'QUANTUM_UNCERTAINTY' })]),
    );
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts[0]?.label).toBe('Quantum uncertainty');
    expect(summary.contexts[0]?.tone).toBe('neutral');
  });

  it('degrades an unmapped status state the same way', () => {
    const summary = checksSummary(rollup([statusContext({ state: 'BRAND_NEW' })]));
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts[0]?.label).toBe('Brand new');
  });

  it('still names a union member this build does not know', () => {
    const summary = checksSummary(
      rollup([{ __typename: 'FutureCheckThing', name: 'something-new' }]),
    );
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts[0]?.name).toBe('something-new');
    expect(summary.contexts[0]?.label).not.toBe('');
  });

  it('names a context with nothing nameable rather than rendering blank', () => {
    const summary = checksSummary(rollup([{ __typename: 'CheckRun' }]));
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts[0]?.name).not.toBe('');
    expect(summary.contexts[0]?.label).not.toBe('');
  });

  it('drops a url that is not http', () => {
    const summary = checksSummary(
      rollup([statusContext({ targetUrl: 'javascript:alert(1)' })]),
    );
    if (summary.kind !== 'contexts') throw new Error('expected contexts');

    expect(summary.contexts[0]?.url).toBeNull();
  });
});
