/**
 * Deciding when cached reads have to be forgotten.
 *
 * The provider itself is thin and exercised through the client; what needs its
 * own tests is the question "did the token just change", because getting it
 * wrong is either a stale-data leak or a cache that clears itself constantly.
 */

import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_KEY,
  TOKEN_KEY,
  VAULT_KEY,
  invalidatesCachedReads,
  isTokenChange,
  tokenProblem,
} from './token-provider';

/**
 * Two predicates over the same storage events, because two callers want
 * opposite answers about one of them.
 *
 * The credential now lives in two places — the sealed vault in `local` and the
 * decrypted copy in `session` — and the pull request cache shares `session`
 * with the latter.
 */
describe('isTokenChange', () => {
  /** What the review page listens to, so it can retry the load. */
  it('is true on the first unlock of a browser session', () => {
    // The whole point for this caller: the reviewer just unlocked and the page
    // is sitting on the locked screen it promised would go away.
    expect(isTokenChange({ [SESSION_TOKEN_KEY]: { newValue: 'ghp_a' } }, 'session')).toBe(true);
  });

  it('is true when locking removes the decrypted copy', () => {
    expect(isTokenChange({ [SESSION_TOKEN_KEY]: { oldValue: 'ghp_a' } }, 'session')).toBe(true);
  });

  it('is true when the vault itself is replaced', () => {
    expect(
      isTokenChange({ [VAULT_KEY]: { oldValue: { ct: 'a' }, newValue: { ct: 'b' } } }, 'local'),
    ).toBe(true);
  });

  it('is true when a legacy plaintext token is cleared by a migration', () => {
    expect(isTokenChange({ [TOKEN_KEY]: { oldValue: 'ghp_a' } }, 'local')).toBe(true);
  });

  it('is false when the same token is written again', () => {
    expect(
      isTokenChange({ [SESSION_TOKEN_KEY]: { oldValue: 'ghp_a', newValue: 'ghp_a' } }, 'session'),
    ).toBe(false);
  });

  it('ignores cache writes, which share the session area', () => {
    expect(isTokenChange({ 'pr:acme/widgets:42': { newValue: '{}' } }, 'session')).toBe(false);
  });

  it('ignores changes to other keys in local, such as drafts', () => {
    expect(isTokenChange({ 'some-draft': { newValue: 'x' } }, 'local')).toBe(false);
  });
});

/**
 * What the background worker listens to, so it can sweep cached reads that no
 * longer belong to whoever is signed in.
 */
describe('invalidatesCachedReads', () => {
  it('is false on the first unlock of a browser session', () => {
    // The one place the two predicates disagree. Session storage holds the
    // cache too, so if the token was absent the cache was empty — sweeping
    // here would be pure churn on every single unlock.
    expect(
      invalidatesCachedReads({ [SESSION_TOKEN_KEY]: { newValue: 'ghp_a' } }, 'session'),
    ).toBe(false);
  });

  it('is true when locking removes the decrypted copy', () => {
    // Locking is the reviewer saying "protect this now". Leaving a warm cache
    // would keep whole pull requests readable behind a locked vault.
    expect(
      invalidatesCachedReads({ [SESSION_TOKEN_KEY]: { oldValue: 'ghp_a' } }, 'session'),
    ).toBe(true);
  });

  it('is true when the decrypted copy is replaced with a different token', () => {
    expect(
      invalidatesCachedReads(
        { [SESSION_TOKEN_KEY]: { oldValue: 'ghp_a', newValue: 'ghp_b' } },
        'session',
      ),
    ).toBe(true);
  });

  it('is true when the vault is cleared', () => {
    // Clearing the token has to stop the cache serving a pull request the
    // reviewer can no longer read from GitHub.
    expect(invalidatesCachedReads({ [VAULT_KEY]: { oldValue: { ct: 'a' } } }, 'local')).toBe(true);
  });

  it('ignores cache writes, which share the session area', () => {
    // Without this a cache write would look like a sign-out and sweep the
    // cache it had just populated, on every single read.
    expect(invalidatesCachedReads({ 'pr:acme/widgets:42': { newValue: '{}' } }, 'session')).toBe(
      false,
    );
  });
});

describe('tokenProblem', () => {
  /**
   * A token is an HTTP header value. Anything that cannot go in one fails
   * inside `fetch` with "Failed to construct 'Headers': Invalid value" — a
   * TypeError with nothing in it about tokens, which the worker reports as
   * `unknown` and the page renders as "Something went wrong". Over a problem
   * that is entirely about the token, and that the options page had already
   * called "Token saved."
   */
  it('accepts an ordinary fine-grained token', () => {
    expect(tokenProblem(`github_pat_${'A'.repeat(60)}`)).toBeNull();
  });

  it('accepts a classic token', () => {
    expect(tokenProblem(`ghp_${'a'.repeat(36)}`)).toBeNull();
  });

  it('accepts surrounding whitespace, which is trimmed', () => {
    // Pasting from a terminal picks up a trailing newline constantly, and that
    // one is harmless.
    expect(tokenProblem('  ghp_abcdefghijklmnop  \n')).toBeNull();
  });

  it('rejects a newline in the middle', () => {
    // What a wrapped terminal line gives you.
    expect(tokenProblem('ghp_abcdef\nghijkl')).not.toBeNull();
  });

  it('rejects a space in the middle', () => {
    expect(tokenProblem('ghp_abcdef ghijkl')).not.toBeNull();
  });

  it('rejects a non-ASCII character', () => {
    // A smart quote or an en dash, from a token pasted out of a document.
    expect(tokenProblem('ghp_abcdef–ghijkl')).not.toBeNull();
  });

  it('says what is wrong rather than only that something is', () => {
    const problem = tokenProblem('ghp_abcdef\nghijkl');
    expect(problem).toMatch(/space|whitespace|line break|character/i);
  });

  it('has no problem with an empty token, which means clearing it', () => {
    expect(tokenProblem('')).toBeNull();
    expect(tokenProblem('   ')).toBeNull();
  });
});
