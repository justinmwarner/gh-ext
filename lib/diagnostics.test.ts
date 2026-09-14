import { describe, expect, test } from 'vitest';
import { diagnosticsReport, redact } from './diagnostics';
import type { DiagnosticsInput } from './diagnostics';
import { DEFAULT_SETTINGS, type Settings } from './settings';

/**
 * Everything this file produces is going into a public issue, written by a
 * reviewer who is doing the project a favour and who will not audit it line by
 * line. So the tests that matter most are the ones about what is *absent*: a
 * leak here is a repository list or a live credential published under
 * somebody's own name.
 */

const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  version: '1.0.2',
  extensionId: 'kpjeagilmchpoganlnllmhloplapcnoj',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
  vault: 'unlocked',
  settings: DEFAULT_SETTINGS,
  warnings: [],
  ...over,
});

const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe('diagnosticsReport', () => {
  test('names the version, because the first question is always which build', () => {
    expect(diagnosticsReport(input())).toContain('A Better Reviewer 1.0.2');
  });

  test('names the install, since the store copy and a local one differ', () => {
    // The version cannot separate them: both can be 1.0.3 at once, which is
    // exactly the case where somebody reloads and sees no change.
    expect(diagnosticsReport(input())).toContain(
      'Extension id: kpjeagilmchpoganlnllmhloplapcnoj',
    );
  });

  test('carries the user agent whole', () => {
    expect(diagnosticsReport(input())).toContain('Chrome/140.0.0.0');
  });

  test.each([
    ['empty', 'none stored'],
    ['plain', 'stored, not encrypted'],
    ['locked', 'stored, encrypted, locked'],
    ['unlocked', 'stored, encrypted, unlocked'],
  ] as const)('describes a %s vault in words, not state names', (vault, expected) => {
    expect(diagnosticsReport(input({ vault }))).toContain(`Token: ${expected}`);
  });

  test('reports the settings that change what a diff looks like', () => {
    const report = diagnosticsReport(input({ settings: settings({ splitView: true }) }));

    expect(report).toContain('splitView: true');
    expect(report).toContain('ignoreWhitespace: false');
    expect(report).toContain('lineDiff: word-alt');
  });

  test('names the default theme rather than leaving the line blank', () => {
    // `diffTheme` defaults to the empty string, meaning follow the page. A bare
    // `diffTheme:` reads as a value the report could not collect.
    expect(diagnosticsReport(input())).toContain('diffTheme: (not set)');
  });

  test('never reports the repositories the reviewer is watching', () => {
    // The most sensitive thing on the options page, and nobody's business in a
    // bug report. If this fails, private repository names are being published.
    const report = diagnosticsReport(
      input({ settings: settings({ watchedRepos: ['acme/secret-product'] }) }),
    );

    expect(report).not.toContain('acme/secret-product');
    expect(report).not.toContain('watchedRepos');
  });

  test('never reports the generated-file patterns', () => {
    // Written by the reviewer, and they routinely name directories from a tree
    // nobody outside the company has seen.
    const report = diagnosticsReport(
      input({ settings: settings({ generatedPatterns: ['internal/customers/**'] }) }),
    );

    expect(report).not.toContain('internal/customers');
  });

  test('says so plainly when a context recorded nothing', () => {
    const report = diagnosticsReport(
      input({ warnings: [{ name: 'background worker', warnings: [] }] }),
    );

    expect(report).toContain('Warnings from the background worker: none recorded this session.');
  });

  test('lists warnings oldest first, with repeats folded into a count', () => {
    const report = diagnosticsReport(
      input({
        warnings: [
          {
            name: 'background worker',
            warnings: [
              { text: 'opening a pull request', count: 1 },
              { text: 'hunk render failed', count: 200 },
            ],
          },
        ],
      }),
    );

    expect(report).toContain('opening a pull request');
    expect(report).toContain('hunk render failed (x200)');
    expect(report.indexOf('opening')).toBeLessThan(report.indexOf('hunk render'));
  });

  test('keeps each context under its own heading, rather than merging two clocks', () => {
    // The worker and the page have separate buffers and no shared ordering. A
    // single merged list would be claiming a sequence that does not exist.
    const report = diagnosticsReport(
      input({
        warnings: [
          { name: 'background worker', warnings: [{ text: 'token refused', count: 1 }] },
          { name: 'options page', warnings: [{ text: 'validate failed', count: 1 }] },
        ],
      }),
    );

    expect(report).toContain('Warnings from the background worker, oldest first');
    expect(report).toContain('Warnings from the options page, oldest first');
  });

  test('redacts a token that reached a warning', () => {
    const report = diagnosticsReport(
      input({
        warnings: [
          {
            name: 'background worker',
            warnings: [
              { text: 'request refused for ghp_abcdefghij0123456789ABCDEFGHIJ', count: 1 },
            ],
          },
        ],
      }),
    );

    expect(report).not.toContain('ghp_abcdefghij');
    expect(report).toContain('[redacted]');
  });
});

/**
 * Redaction is belt and braces: no call site is supposed to log a credential.
 * That is exactly why it is tested directly — the protection has to hold for
 * the call site nobody remembers writing.
 */
describe('redact', () => {
  test.each([
    ['ghp_abcdefghij0123456789ABCDEFGHIJ'],
    ['gho_abcdefghij0123456789ABCDEFGHIJ'],
    ['ghs_abcdefghij0123456789ABCDEFGHIJ'],
    ['github_pat_11ABCDE0y0abcdefghij_0123456789ABCDEFGHIJ'],
  ])('removes %s', (secret) => {
    const scrubbed = redact(`failed with ${secret} attached`);

    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toBe('failed with [redacted] attached');
  });

  test('removes a bearer header however it was cased', () => {
    expect(redact('authorization: bearer aGVsbG8gdGhlcmU9PQ==')).toBe(
      'authorization: [redacted]',
    );
  });

  test('removes every occurrence, not only the first', () => {
    const twice = redact('ghp_abcdefghij0123456789ABCDEFGHIJ and ghp_zyxwvutsrq9876543210ZYXWVUTS');

    expect(twice).toBe('[redacted] and [redacted]');
  });

  test('leaves ordinary text alone', () => {
    const ordinary = 'could not render acme/widgets#42 at src/index.ts';

    expect(redact(ordinary)).toBe(ordinary);
  });
});
