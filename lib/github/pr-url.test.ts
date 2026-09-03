import { describe, expect, it } from 'vitest';
import { parsePrUrl, parseReviewHash, reviewHash } from './pr-url';

const ref = { owner: 'octocat', repo: 'hello-world', number: 42 };

describe('parsePrUrl', () => {
  it('reads a pull request URL', () => {
    expect(parsePrUrl('https://github.com/octocat/hello-world/pull/42')).toEqual(ref);
  });

  it('reads the /files sub-path', () => {
    expect(parsePrUrl('https://github.com/octocat/hello-world/pull/42/files')).toEqual(ref);
  });

  it('reads the /commits sub-path', () => {
    expect(parsePrUrl('https://github.com/octocat/hello-world/pull/42/commits')).toEqual(
      ref,
    );
  });

  it('reads a deeper sub-path', () => {
    expect(
      parsePrUrl('https://github.com/octocat/hello-world/pull/42/files/abc123..def456'),
    ).toEqual(ref);
  });

  it('ignores a query string', () => {
    expect(
      parsePrUrl('https://github.com/octocat/hello-world/pull/42/files?w=1&diff=split'),
    ).toEqual(ref);
  });

  it('ignores a fragment', () => {
    expect(
      parsePrUrl('https://github.com/octocat/hello-world/pull/42#discussion_r123'),
    ).toEqual(ref);
  });

  it('ignores a query string and a fragment together', () => {
    expect(
      parsePrUrl('https://github.com/octocat/hello-world/pull/42/files?w=1#diff-abc'),
    ).toEqual(ref);
  });

  it('tolerates a trailing slash', () => {
    expect(parsePrUrl('https://github.com/octocat/hello-world/pull/42/')).toEqual(ref);
  });

  it('decodes percent-escaped path segments', () => {
    expect(parsePrUrl('https://github.com/oct%C3%B6cat/hello-world/pull/42')).toEqual({
      ...ref,
      owner: 'octöcat',
    });
  });

  it('returns null for a GitHub URL that is not a pull request', () => {
    expect(parsePrUrl('https://github.com/octocat/hello-world')).toBeNull();
    expect(parsePrUrl('https://github.com/octocat/hello-world/issues/42')).toBeNull();
    expect(parsePrUrl('https://github.com/octocat/hello-world/pulls')).toBeNull();
    expect(parsePrUrl('https://github.com/octocat')).toBeNull();
    expect(parsePrUrl('https://github.com/')).toBeNull();
  });

  it('returns null when the number is not a number', () => {
    expect(parsePrUrl('https://github.com/octocat/hello-world/pull/new')).toBeNull();
    expect(parsePrUrl('https://github.com/octocat/hello-world/pull/42x')).toBeNull();
  });

  it('returns null for another host that happens to use the same path shape', () => {
    expect(parsePrUrl('https://gist.github.com/octocat/hello-world/pull/42')).toBeNull();
    expect(parsePrUrl('https://github.com.evil.test/octocat/hello-world/pull/42')).toBeNull();
  });

  it('returns null for something that is not a URL', () => {
    expect(parsePrUrl('')).toBeNull();
    expect(parsePrUrl('/octocat/hello-world/pull/42')).toBeNull();
  });
});

describe('reviewHash', () => {
  it('builds the review page route', () => {
    expect(reviewHash(ref)).toBe('#/pr/octocat/hello-world/42');
  });

  it('escapes characters that would otherwise split the route', () => {
    expect(reviewHash({ ...ref, repo: 'a/b' })).toBe('#/pr/octocat/a%2Fb/42');
  });
});

describe('parseReviewHash', () => {
  it('reads back what reviewHash wrote', () => {
    expect(parseReviewHash(reviewHash(ref))).toEqual(ref);
  });

  it('round-trips an escaped segment', () => {
    const odd = { ...ref, repo: 'a/b' };
    expect(parseReviewHash(reviewHash(odd))).toEqual(odd);
  });

  it('tolerates a missing leading hash', () => {
    expect(parseReviewHash('/pr/octocat/hello-world/42')).toEqual(ref);
  });

  it('returns null for the empty hash a bare review.html has', () => {
    expect(parseReviewHash('')).toBeNull();
    expect(parseReviewHash('#')).toBeNull();
  });

  it('returns null for a route it does not recognize', () => {
    expect(parseReviewHash('#/settings')).toBeNull();
    expect(parseReviewHash('#/pr/octocat/hello-world')).toBeNull();
    expect(parseReviewHash('#/pr/octocat/hello-world/not-a-number')).toBeNull();
  });
});

describe('a hash nobody could have produced', () => {
  /**
   * `parseReviewHash` runs inside a `useMemo`, during render, and the review
   * page mounts with no error boundary above it. A malformed percent sequence
   * makes `decodeURIComponent` throw a `URIError` from inside render, which
   * takes the whole page down to a blank white screen with only a console
   * stack — for a hand-edited URL or a mangled bookmark.
   *
   * Returning null is the answer, because null already renders an explanation.
   */
  it('reports no route rather than throwing', () => {
    expect(parseReviewHash('#/pr/a%zz/b/1')).toBeNull();
  });

  it('is not fooled by a truncated escape either', () => {
    expect(parseReviewHash('#/pr/owner/repo%/1')).toBeNull();
  });

  it('still decodes an escape that is valid', () => {
    // Owner and repo names cannot contain a percent, but the decode is there
    // for a reason and must keep working.
    expect(parseReviewHash('#/pr/my%2Dorg/my%2Drepo/7')).toEqual({
      owner: 'my-org',
      repo: 'my-repo',
      number: 7,
    });
  });
});
