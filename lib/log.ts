/**
 * Diagnostic logging, off unless the reviewer asks for it.
 *
 * The console belongs to whoever opened it. An extension that writes to it
 * uninvited makes the page harder to debug for the person who actually owns
 * it, and on github.com — where this runs on every page — that noise is
 * permanent. So the default is silence, and the only way out of it is the
 * setting on the options page.
 *
 * Pure, like the rest of `lib/`: `console` exists in Node too, so this names no
 * extension API and is tested without a browser. The flag is pushed in by
 * `lib/logging-store.ts`, which is the part that reads storage.
 */

/** Whose warning this is, once a reviewer is looking at a console full of them. */
const PREFIX = '[a-better-reviewer]';

/**
 * Module state rather than a parameter on every call.
 *
 * The alternative is threading a logger through every constructor in the
 * worker, which is a lot of plumbing for a boolean that changes about twice in
 * the life of an install.
 */
let enabled = false;

/** Called by the storage adapter on startup and on every settings change. */
export function setLoggingEnabled(value: boolean): void {
  enabled = value;
}

export function isLoggingEnabled(): boolean {
  return enabled;
}

/**
 * A warning, if the reviewer asked for warnings.
 *
 * `warn` rather than `log` throughout, because everything this extension has
 * to say is something that went wrong. Nothing here is progress reporting.
 */
export function logWarn(...args: unknown[]): void {
  if (!enabled) return;
  console.warn(PREFIX, ...args);
}
