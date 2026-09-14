import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type Warning,
  clearWarnings,
  logWarn,
  recentWarnings,
  setLoggingEnabled,
} from './log';

/**
 * An extension writing to a console nobody asked it to write to is a small
 * rudeness that adds up: the reviewer's console is theirs, and a page full of
 * someone else's warnings makes their own debugging harder.
 *
 * So silence is the default and the only way out of it is a setting. These
 * tests are mostly about the default, because that is the part a later change
 * is most likely to erode.
 */

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  // The flag is module state, so a test that enabled it would otherwise decide
  // the outcome of every test after it.
  setLoggingEnabled(false);
  // So is the buffer, and it now fills on every `logWarn` in every test above.
  clearWarnings();
});

describe('logWarn', () => {
  test('says nothing at all by default', () => {
    // Not "logs less" — logs nothing. A fresh install has never been near the
    // options page, so this default is what almost every user experiences.
    logWarn('something happened', { detail: 1 });

    expect(warn).not.toHaveBeenCalled();
  });

  test('stays silent when logging is explicitly disabled', () => {
    setLoggingEnabled(false);

    logWarn('something happened');

    expect(warn).not.toHaveBeenCalled();
  });

  test('writes once logging is enabled', () => {
    setLoggingEnabled(true);

    logWarn('prefetch failed', 'acme/widgets#42');

    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('prefixes the extension name, so the reviewer can tell whose warning it is', () => {
    setLoggingEnabled(true);

    logWarn('cache write failed');

    expect(warn.mock.calls[0]?.[0]).toContain('a-better-reviewer');
  });

  test('passes every argument through, not just the first', () => {
    setLoggingEnabled(true);
    const error = new Error('boom');

    logWarn('could not clear the cache', error, 7);

    expect(warn.mock.calls[0]).toContain(error);
    expect(warn.mock.calls[0]).toContain(7);
  });

  test('goes quiet again when the reviewer turns it back off', () => {
    setLoggingEnabled(true);
    logWarn('first');
    setLoggingEnabled(false);

    logWarn('second');

    expect(warn).toHaveBeenCalledTimes(1);
  });

});

/**
 * Retention is deliberately not gated on the console setting, and that is the
 * property most likely to be "tidied up" later by someone who reads the top of
 * the file and assumes one flag governs both. It does not: a reviewer only
 * decides to report a bug after the bug, and a buffer that was empty because
 * the console was quiet would make the report useless at exactly the moment it
 * is wanted.
 */
describe('recentWarnings', () => {
  test('retains a warning the console was never told about', () => {
    logWarn('prefetch failed', 'acme/widgets#42');

    expect(warn).not.toHaveBeenCalled();
    expect(recentWarnings()).toHaveLength(1);
    expect(recentWarnings()[0]?.text).toContain('acme/widgets#42');
  });

  test('retains when the console is on as well, rather than instead', () => {
    setLoggingEnabled(true);

    logWarn('cache write failed');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(recentWarnings()).toHaveLength(1);
  });

  test('is empty until something goes wrong', () => {
    expect(recentWarnings()).toEqual([]);
  });

  test('folds an immediate repeat into a count rather than a second entry', () => {
    logWarn('rate limited');
    logWarn('rate limited');
    logWarn('rate limited');

    expect(recentWarnings()).toHaveLength(1);
    expect(recentWarnings()[0]?.count).toBe(3);
  });

  test('starts a new entry when the repeat is not immediate', () => {
    logWarn('rate limited');
    logWarn('token refused');
    logWarn('rate limited');

    expect(recentWarnings().map((w) => w.text)).toEqual([
      'rate limited',
      'token refused',
      'rate limited',
    ]);
  });

  test('keeps the most recent fifty and drops the oldest', () => {
    for (let i = 0; i < 60; i += 1) logWarn(`warning ${i}`);

    const kept = recentWarnings();
    expect(kept).toHaveLength(50);
    expect(kept[0]?.text).toBe('warning 10');
    expect(kept[49]?.text).toBe('warning 59');
  });

  test('a warning inside a loop does not evict the context that explains it', () => {
    // The reason the fold above exists. Without it these two hundred identical
    // lines are two hundred entries, the buffer holds nothing but the last
    // fifty of them, and the one line saying what the extension had been doing
    // when it started is gone.
    logWarn('opening acme/widgets#42');
    for (let i = 0; i < 200; i += 1) logWarn('hunk render failed');

    expect(recentWarnings()[0]?.text).toBe('opening acme/widgets#42');
    expect(recentWarnings()).toHaveLength(2);
    expect(recentWarnings()[1]?.count).toBe(200);
  });

  test('renders an Error as its name and message', () => {
    // `JSON.stringify(new Error('boom'))` is `{}`, which would silently turn
    // the most useful line in a report into no line at all.
    logWarn('could not clear the cache', new TypeError('boom'));

    expect(recentWarnings()[0]?.text).toBe('could not clear the cache TypeError: boom');
  });

  test('survives an argument that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => logWarn('bad state', cyclic)).not.toThrow();
    expect(recentWarnings()[0]?.text).toBe('bad state [unserializable]');
  });

  test('hands back a copy, so a caller cannot empty the buffer by accident', () => {
    logWarn('first');

    (recentWarnings() as Warning[]).length = 0;

    expect(recentWarnings()).toHaveLength(1);
  });

  test('caps one entry, so a logged payload cannot grow the buffer without limit', () => {
    logWarn('x'.repeat(5000));

    const text = recentWarnings()[0]?.text ?? '';
    expect(text.length).toBeLessThan(600);
    expect(text).toContain('[truncated]');
  });

  test('truncates what is retained, not what reaches the console', () => {
    // The console is local and was asked for; the buffer is published. Only one
    // of the two has a reason to be abbreviated.
    setLoggingEnabled(true);
    const long = 'x'.repeat(5000);

    logWarn(long);

    expect(warn.mock.calls[0]).toContain(long);
    expect(recentWarnings()[0]?.text).toContain('[truncated]');
  });

  test('clears on request', () => {
    logWarn('first');

    clearWarnings();

    expect(recentWarnings()).toEqual([]);
  });
});
