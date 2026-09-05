/**
 * The github.com URLs this page hands out.
 *
 * Every one of them is a link a reviewer will click to leave, so the only way
 * it can be wrong is quietly: a path that 404s, or an owner with a slash in it
 * that walks somewhere else entirely.
 */

import { describe, expect, it } from 'vitest';
import { commitUrl, pullRequestUrl, safeGitHubUrl } from './githubUrl';

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
