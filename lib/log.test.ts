import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { logWarn, setLoggingEnabled } from './log';

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
