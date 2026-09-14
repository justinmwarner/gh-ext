/**
 * Diagnostic logging, off unless the reviewer asks for it, and a short tail of
 * what went wrong kept either way.
 *
 * The console belongs to whoever opened it. An extension that writes to it
 * uninvited makes the page harder to debug for the person who actually owns
 * it, and on github.com — where this runs on every page — that noise is
 * permanent. So the default is silence, and the only way out of it is the
 * setting on the options page.
 *
 * Retention is a separate question from output, and is answered differently.
 * By the time somebody decides to report a problem, the warning that explains
 * it has already happened; discarding it because the console setting was off
 * leaves the options page asking them to turn logging on and reproduce a fault
 * that may not reproduce. So every warning is retained in memory regardless of
 * the setting, and only the writing to `console` is gated. Nothing here
 * reaches storage or disk, and nothing outlives the page.
 *
 * Pure, like the rest of `lib/`: `console` exists in Node too, so this names no
 * extension API and is tested without a browser. The flag is pushed in by
 * `lib/logging-store.ts`, which is the part that reads storage.
 */

/** Whose warning this is, once a reviewer is looking at a console full of them. */
const PREFIX = '[a-better-reviewer]';

/**
 * How many warnings are kept for a bug report.
 *
 * Long enough to hold the run-up to a failure, short enough that the report
 * stays something a person will actually read before pasting it in public.
 */
const RETAINED = 50;

/**
 * How much of one warning is kept.
 *
 * Every call site today passes a short sentence and an `Error`, so nothing
 * comes near this. It is here for the one that does not: a retained buffer with
 * no ceiling is an unbounded allocation waiting for somebody to log a payload,
 * and the text ends up in a document a reviewer pastes into a public issue,
 * where a five-thousand-character line helps nobody.
 *
 * Two warnings identical up to the cut are folded together by `retain` as if
 * they were the same line. That is the right trade at this length: they are the
 * same call site, and the alternative is keeping everything to tell them apart.
 */
const MAX_TEXT = 500;

/** One retained warning, with the repeats that followed it folded in. */
export interface Warning {
  /** The arguments as one line, rendered by `render` below. */
  readonly text: string;
  /** How many times in a row this exact line was logged. Never below 1. */
  readonly count: number;
}

/**
 * Module state rather than a parameter on every call.
 *
 * The alternative is threading a logger through every constructor in the
 * worker, which is a lot of plumbing for a boolean that changes about twice in
 * the life of an install.
 */
let enabled = false;

const warnings: Warning[] = [];

/** Called by the storage adapter on startup and on every settings change. */
export function setLoggingEnabled(value: boolean): void {
  enabled = value;
}

export function isLoggingEnabled(): boolean {
  return enabled;
}

/**
 * One argument as text.
 *
 * `Error` is special-cased because it is the argument that matters most and
 * the one `JSON.stringify` is worst at — it renders as `{}`, which turns the
 * single most useful line in a bug report into nothing at all.
 *
 * The `try` is not defensive habit: a cyclic object reaches this from real call
 * sites, and a diagnostics report that throws while being assembled is worse
 * than one with a gap in it.
 */
function one(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === null || value === undefined || typeof value !== 'object') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable]';
  }
}

function render(args: unknown[]): string {
  const text = args.map(one).join(' ');
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}… [truncated]`;
}

/**
 * Keep a warning, collapsing an immediate repeat into a count.
 *
 * Without the collapse a warning inside a loop empties the buffer of
 * everything that came before it, which is exactly backwards: the fifty
 * identical lines are one fact, and the lines they evicted were the context
 * that explained it.
 */
function retain(text: string): void {
  const last = warnings[warnings.length - 1];
  if (last !== undefined && last.text === text) {
    warnings[warnings.length - 1] = { text, count: last.count + 1 };
    return;
  }
  warnings.push({ text, count: 1 });
  if (warnings.length > RETAINED) warnings.shift();
}

/**
 * A warning, if the reviewer asked for warnings — and retained either way.
 *
 * `warn` rather than `log` throughout, because everything this extension has
 * to say is something that went wrong. Nothing here is progress reporting.
 */
export function logWarn(...args: unknown[]): void {
  retain(render(args));
  if (!enabled) return;
  console.warn(PREFIX, ...args);
}

/** Oldest first, which is the order they are read in. */
export function recentWarnings(): readonly Warning[] {
  return warnings.slice();
}

/** For tests, and for a reviewer who has already sent one report. */
export function clearWarnings(): void {
  warnings.length = 0;
}
