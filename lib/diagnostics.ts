/**
 * The diagnostics report, assembled for a reviewer to paste into a bug report.
 *
 * This extension measures nothing about the people using it, so an issue
 * somebody writes is the only account of a fault anyone will ever get. That
 * makes the quality of the report the whole of the feedback loop, and "it
 * doesn't work" is not something anybody can act on.
 *
 * Two constraints shape everything below.
 *
 * The report is *published*. It goes into a public issue, by hand, by someone
 * who is doing the project a favour. So it carries the smallest set of facts
 * that make a fault reproducible and not one thing more — no repository names,
 * no pull request titles, no file paths from settings, and above all no token.
 * Anything added here later is being added to a public document.
 *
 * The report is *assembled, never sent*. Nothing in this file transmits, and
 * nothing calls it on the reviewer's behalf. It renders text; the options page
 * shows that text to the reviewer and puts it on the clipboard if they ask.
 *
 * Pure, like the rest of `lib/`: it is handed its inputs rather than reading
 * them. `VaultState` is a type-only import and so is erased at build, which is
 * what keeps this module free of the adapter it names.
 */

import type { VaultState } from './github/token-provider';
import type { Warning } from './log';
import type { Settings } from './settings';

/**
 * The settings that go in the report, named one at a time.
 *
 * An allowlist rather than the whole object, and the direction matters: a
 * setting added to `Settings` later is excluded until somebody deliberately
 * adds it here. The other way round, a future setting holding a path or a
 * repository name would start appearing in public issues the day it shipped,
 * and nobody would notice until it had.
 *
 * Two current settings are left out for exactly that reason. `watchedRepos` is
 * a list of the reviewer's repositories, which is the most sensitive thing on
 * the options page and is nobody's business in a bug report.
 * `generatedPatterns` is written by the reviewer and routinely names
 * directories from a private tree.
 */
const REPORTED: readonly (keyof Settings)[] = [
  'splitView',
  'ignoreWhitespace',
  'lineDiff',
  'hideGenerated',
  'collapseTree',
  'diffTheme',
  'openIn',
  'openInBackground',
  'autoOpen',
  'releaseFindKey',
  'stalenessDays',
  'debugLogging',
];

/**
 * Credential shapes, redacted wherever they appear.
 *
 * The retained warnings are formatted from arguments this file never sees, and
 * a token reaching a log line is the sort of mistake that gets made once, in a
 * hurry, in a call site nobody revisits. The cost of being wrong about that is
 * a live credential in a public issue, so the report is scrubbed on the way out
 * whether or not anything is expected to match.
 *
 * GitHub's prefixes are all of the documented ones rather than the two this
 * extension asks for: a reviewer may well paste the wrong kind of token into
 * the field and the wrong kind is just as live.
 */
const SECRETS: readonly RegExp[] = [
  /\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
];

/** Replace anything token-shaped with a marker that says what happened. */
export function redact(text: string): string {
  return SECRETS.reduce((scrubbed, pattern) => scrubbed.replace(pattern, '[redacted]'), text);
}

/**
 * One context's retained warnings.
 *
 * Kept apart rather than concatenated because `lib/log.ts` holds its buffer in
 * module state, and each context has its own: the worker's warnings and the
 * page's are two sequences, each in order, with no shared clock to merge them
 * by. Running them together would produce a single list claiming an order it
 * does not have, and the failure that matters is usually the worker's — so it
 * is worth being able to see which side of the boundary a line came from.
 */
export interface WarningSource {
  /** Where these were logged, in words a reader will recognise. */
  readonly name: string;
  readonly warnings: readonly Warning[];
}

/** What the options page knows, gathered where the browser APIs are allowed. */
export interface DiagnosticsInput {
  /** From the manifest. */
  readonly version: string;
  /**
   * `runtime.id`, which says which *install* this is.
   *
   * The store's copy and a locally loaded one get different ids and can be
   * running side by side at different versions, so "I reloaded and nothing
   * changed" is usually two installs rather than a broken build. The version
   * alone cannot separate them.
   */
  readonly extensionId: string;
  /** `navigator.userAgent`, whole: the browser build is the point of it. */
  readonly userAgent: string;
  /** How the token is held, if it is held. Never the token. */
  readonly vault: VaultState;
  readonly settings: Settings;
  readonly warnings: readonly WarningSource[];
}

/** Plain words for a state whose names are internal. */
function describeVault(vault: VaultState): string {
  switch (vault) {
    case 'empty':
      return 'none stored';
    case 'plain':
      return 'stored, not encrypted';
    case 'locked':
      return 'stored, encrypted, locked';
    case 'unlocked':
      return 'stored, encrypted, unlocked';
  }
}

function describeWarning(warning: Warning): string {
  return warning.count > 1 ? `${warning.text} (x${warning.count})` : warning.text;
}

/**
 * The report, as plain text.
 *
 * Plain rather than Markdown because the issue form renders this field inside a
 * code block: Markdown here would be shown as its own source, and a path with
 * an underscore in it would arrive italicised in the one document where the
 * exact characters matter.
 */
export function diagnosticsReport(input: DiagnosticsInput): string {
  const lines: string[] = [
    `A Better Reviewer ${input.version}`,
    `Extension id: ${input.extensionId}`,
    `User agent: ${input.userAgent}`,
    `Token: ${describeVault(input.vault)}`,
    '',
    'Settings',
  ];

  for (const key of REPORTED) {
    // An empty string is a real value here rather than a missing one —
    // `diffTheme` uses it for "follow the page", and it is the default. Printed
    // bare it leaves a line ending in a colon, which reads as a setting the
    // report failed to collect.
    const value = String(input.settings[key]);
    lines.push(`  ${key}: ${value === '' ? '(not set)' : value}`);
  }

  for (const source of input.warnings) {
    lines.push('');
    if (source.warnings.length === 0) {
      lines.push(`Warnings from the ${source.name}: none recorded this session.`);
      continue;
    }
    lines.push(`Warnings from the ${source.name}, oldest first`);
    for (const warning of source.warnings) lines.push(`  ${describeWarning(warning)}`);
  }

  return redact(lines.join('\n'));
}
