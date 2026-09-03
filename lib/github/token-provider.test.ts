/**
 * Deciding when cached reads have to be forgotten.
 *
 * The provider itself is thin and exercised through the client; what needs its
 * own tests is the question "did the token just change", because getting it
 * wrong is either a stale-data leak or a cache that clears itself constantly.
 */

import { describe, expect, it } from 'vitest';
import { TOKEN_KEY, isTokenChange } from './token-provider';

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
