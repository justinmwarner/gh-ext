/**
 * The one-line form.
 *
 * The failure it replaces: the options page answering **Check token** with
 * `unknown: GitHub request failed: 404` — a sentence naming neither the
 * problem nor the remedy, which reads as a bug in the extension rather than a
 * fact about the token.
 */

import { describe, expect, it } from 'vitest';
import type { Cause, Diagnosis } from '@/lib/github/diagnosis';
import { summarizeDiagnosis } from './diagnosisSummary';

const diagnosis = (cause: Cause, over: Partial<Diagnosis> = {}): Diagnosis => ({
  cause,
  confidence: 'confirmed',
  login: null,
  permission: null,
  section: null,
  fixUrl: null,
  observed: [],
  ...over,
});

describe('summarizeDiagnosis', () => {
  it('names an expired or revoked token, which is what a token check hits', () => {
    expect(summarizeDiagnosis(diagnosis('token-rejected'))).toMatch(/expire|revoke/i);
  });

  it('blames the network rather than the token when nothing was sent', () => {
    const line = summarizeDiagnosis(diagnosis('offline')) ?? '';

    expect(line).toMatch(/never left this machine/i);
    expect(line).not.toMatch(/token/i);
  });

  it('names the account when the probe found it, as proof the token works', () => {
    expect(summarizeDiagnosis(diagnosis('token-lacks-repo', { login: 'warne' }))).toContain(
      '@warne',
    );
  });

  it('leaves the account out rather than hedging about who it might be', () => {
    expect(summarizeDiagnosis(diagnosis('token-lacks-repo'))).not.toMatch(/@|\(\)/);
  });

  it('names the permission when there is one', () => {
    expect(
      summarizeDiagnosis(diagnosis('token-lacks-permission', { permission: 'Checks' })),
    ).toContain('Checks');
  });

  it('does not print a null permission', () => {
    const line = summarizeDiagnosis(diagnosis('token-lacks-permission')) ?? '';

    expect(line).not.toMatch(/null|undefined/);
    expect(line).toMatch(/missing a permission/i);
  });

  it('returns nothing for a cause it cannot improve on', () => {
    // The caller then falls back to GitHub's own words, which beat a generic
    // apology printed over the top of them.
    expect(summarizeDiagnosis(diagnosis('unknown'))).toBeNull();
  });

  it.each([
    'offline',
    'github-down',
    'no-token',
    'token-rejected',
    'sso-required',
    'token-lacks-repo',
    'token-lacks-permission',
    'pr-not-found',
    'rate-limited',
  ] as const)('stays to one sentence for %s', (cause) => {
    const line = summarizeDiagnosis(diagnosis(cause, { permission: 'Checks' })) ?? '';

    // It goes in a status line under a button. Two sentences wrap it onto a
    // third line and push the button off the fold.
    expect(line.length).toBeLessThan(110);
    expect(line.endsWith('.')).toBe(true);
  });
});
