/**
 * Deciding when cached reads have to be forgotten.
 *
 * The provider itself is thin and exercised through the client; what needs its
 * own tests is the question "did the token just change", because getting it
 * wrong is either a stale-data leak or a cache that clears itself constantly.
 */

import { describe, expect, it } from 'vitest';
import { TOKEN_KEY, isTokenChange, tokenProblem } from './token-provider';

describe('isTokenChange', () => {
  it('is true when the token is replaced', () => {
    expect(
      isTokenChange({ [TOKEN_KEY]: { oldValue: 'ghp_a', newValue: 'ghp_b' } }, 'local'),
    ).toBe(true);
  });

  it('is true when the token is cleared', () => {
    // The one that matters most: clearing the token has to stop the cache
    // serving a pull request the reviewer can no longer read from GitHub.
    expect(isTokenChange({ [TOKEN_KEY]: { oldValue: 'ghp_a' } }, 'local')).toBe(true);
  });

  it('is true when a token is set for the first time', () => {
    expect(isTokenChange({ [TOKEN_KEY]: { newValue: 'ghp_a' } }, 'local')).toBe(true);
  });

  it('is false when the same token is saved again', () => {
    expect(
      isTokenChange({ [TOKEN_KEY]: { oldValue: 'ghp_a', newValue: 'ghp_a' } }, 'local'),
    ).toBe(false);
  });

  it('ignores changes to other keys in local', () => {
    expect(isTokenChange({ 'some-draft': { newValue: 'x' } }, 'local')).toBe(false);
  });

  it('ignores the session area, which is where the cache itself lives', () => {
    // Without this a cache write would look like a sign-out and sweep the
    // cache it had just populated, on every single read.
    expect(
      isTokenChange({ [TOKEN_KEY]: { oldValue: 'a', newValue: 'b' } }, 'session'),
    ).toBe(false);
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
