/**
 * The github.com URLs this page hands out.
 *
 * Every one of them is a link a reviewer will click to leave, so the only way
 * it can be wrong is quietly: a path that 404s, or an owner with a slash in it
 * that walks somewhere else entirely.
 */

import { describe, expect, it } from 'vitest';
import { branchUrl, commitUrl, pullRequestUrl, safeGitHubUrl } from './githubUrl';

const PR = { owner: 'acme', repo: 'widgets', number: 42 };

describe('pullRequestUrl', () => {
  it('points at the pull request', () => {
    expect(pullRequestUrl(PR)).toBe('https://github.com/acme/widgets/pull/42');
  });
});

describe('commitUrl', () => {
  it('points at the commit inside the repository, not the pull request', () => {
    // `/pull/42/commits/<oid>` exists too and is the wrong destination: it is
    // the commit as one step of a review, and what the reviewer asked for is
    // the commit.
    expect(commitUrl(PR, 'a'.repeat(40))).toBe(
      `https://github.com/acme/widgets/commit/${'a'.repeat(40)}`,
    );
  });

  it('escapes an owner that would otherwise walk out of the path', () => {
    // Owners and repositories cannot contain a slash, but this is data from a
    // route the content script parsed out of a URL.
    expect(commitUrl({ ...PR, owner: 'a/../b' }, 'c'.repeat(40))).toContain('a%2F..%2Fb');
  });

  it('escapes the oid too, which is the part that varies most', () => {
    expect(commitUrl(PR, '../../etc')).not.toContain('../..');
  });
});

describe('branchUrl', () => {
  it('points at the branch in the repository it was given', () => {
    expect(branchUrl(PR, 'main')).toBe('https://github.com/acme/widgets/tree/main');
  });

  it('keeps the slashes in a branch name, which GitHub needs', () => {
    // `release%2F2.4` is not a path GitHub resolves to the branch, so the
    // segments are escaped one at a time rather than the whole name at once.
    expect(branchUrl(PR, 'release/2.4')).toBe(
      'https://github.com/acme/widgets/tree/release/2.4',
    );
  });

  it('escapes everything else in a segment', () => {
    expect(branchUrl(PR, 'feature/a b?c#d')).toBe(
      'https://github.com/acme/widgets/tree/feature/a%20b%3Fc%23d',
    );
  });

  it('refuses a name that would climb out of the repository', () => {
    // The slashes in a branch name are left unescaped so GitHub resolves them,
    // which is exactly what makes `..` a path segment rather than two dots.
    expect(branchUrl(PR, '../../etc')).toBeNull();
    expect(branchUrl(PR, 'release/../../etc')).toBeNull();
    expect(branchUrl(PR, '.')).toBeNull();
  });

  it('keeps a name that merely contains dots', () => {
    expect(branchUrl(PR, 'v1.2..3')).toBe('https://github.com/acme/widgets/tree/v1.2..3');
  });

  it('escapes an owner that would otherwise walk out of the path', () => {
    expect(branchUrl({ ...PR, owner: 'a/../b' }, 'main')).toContain('a%2F..%2Fb');
  });

  it('takes a repository that is not the one in the route', () => {
    // The fork case. The head branch of a cross-repository pull request is not
    // in the repository being reviewed.
    expect(branchUrl({ owner: 'someone', repo: 'widgets' }, 'patch-1')).toBe(
      'https://github.com/someone/widgets/tree/patch-1',
    );
  });
});

describe('safeGitHubUrl', () => {
  it('takes a github.com URL', () => {
    expect(safeGitHubUrl('https://github.com/acme/widgets')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('refuses anything else, however plausible', () => {
    expect(safeGitHubUrl('https://github.com.evil.test/acme')).toBeNull();
    expect(safeGitHubUrl('javascript:alert(1)')).toBeNull();
    expect(safeGitHubUrl(null)).toBeNull();
  });
});
