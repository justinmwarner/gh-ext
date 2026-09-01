import { describe, expect, it } from 'vitest';
import { parseReviewHash, reviewHash } from './pr-url';

const ref = { owner: 'octocat', repo: 'hello-world', number: 42 };

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
