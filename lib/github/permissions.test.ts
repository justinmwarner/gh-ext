/**
 * Translating GitHub's refusals into the words on GitHub's own token page.
 *
 * The whole value of this module is that a reviewer can read what it produces
 * and then *find that row* on the token page. A permission named in schema
 * terms, or in a slug, or under the wrong heading, sends them to scroll a list
 * that does not contain it — which is worse than vague, because it looks
 * specific.
 */

import { describe, expect, it } from 'vitest';
import type { DeniedField } from './graphql-errors';
import { areaOf, list, permissionFromHeader, summarizeAreas } from './permissions';

const denial = (path: string | null): DeniedField => ({
  message: 'Resource not accessible by personal access token',
  path,
  count: 1,
  type: null,
});

describe('areaOf', () => {
  it('names the status checks rather than the GraphQL path', () => {
    const area = areaOf(
      'repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.contexts.nodes.N',
    );

    expect(area.what).toMatch(/status checks/i);
    expect(area.permission).toBe('Checks');
    expect(area.section).toBe('Repository permissions');
  });

  it('puts Members under organisation permissions, where GitHub puts it', () => {
    // Not a repository permission. Naming the wrong heading sends the reviewer
    // to scroll a list that does not contain the setting.
    const area = areaOf('repository.pullRequest.reviewRequests.nodes.N.requestedReviewer');

    expect(area.permission).toBe('Members');
    expect(area.section).toBe('Organization permissions');
  });

  it('falls back to the path rather than going quiet about an unknown field', () => {
    const area = areaOf('repository.pullRequest.mergeQueue');

    expect(area.what).toContain('repository.pullRequest.mergeQueue');
    expect(area.permission).toBeNull();
  });

  it('says something useful even with no path at all', () => {
    expect(areaOf(null).what).toMatch(/part of this pull request/);
  });
});

describe('summarizeAreas', () => {
  it('collapses repeated refusals of the same area into one', () => {
    // Seven check runs denied seven times is one problem, not seven.
    const summary = summarizeAreas([
      denial('repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.a'),
      denial('repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.b'),
    ]);

    expect(summary.areas).toHaveLength(1);
    expect(summary.permissions).toEqual(['Checks']);
  });

  it('names no section when the permissions are not all in one list', () => {
    // A single heading would be wrong for at least one of them, and a wrong
    // instruction is worse than a slightly vaguer one.
    const summary = summarizeAreas([
      denial('repository.pullRequest.commits.nodes.N.commit.statusCheckRollup'),
      denial('repository.pullRequest.reviewRequests.nodes.N'),
    ]);

    expect(summary.permissions).toHaveLength(2);
    expect(summary.section).toBeNull();
  });
});

describe('permissionFromHeader', () => {
  it.each([
    ['pull_requests=read', 'Pull requests'],
    ['contents=read', 'Contents'],
    ['checks=read', 'Checks'],
    ['metadata=read', 'Metadata'],
  ])('reads %s as %s', (header, expected) => {
    expect(permissionFromHeader(header)?.permission).toBe(expected);
  });

  it('uses GitHub’s own label for statuses rather than the slug', () => {
    // The token page lists it as "Commit statuses". Printing `statuses` sends
    // someone looking for a row that is not there.
    expect(permissionFromHeader('statuses=read')?.permission).toBe('Commit statuses');
  });

  it('takes only the first of several requirements', () => {
    expect(permissionFromHeader('issues=write,metadata=read')?.permission).toBe('Issues');
  });

  it('returns nothing for a header naming a permission we cannot place', () => {
    // Better to say nothing than to invent a heading.
    expect(permissionFromHeader('codespaces_lifecycle_admin=write')).toBeNull();
  });

  it.each([null, ''])('returns nothing for %p', (header) => {
    expect(permissionFromHeader(header)).toBeNull();
  });
});

describe('list', () => {
  it.each([
    [[], ''],
    [['Checks'], 'Checks'],
    [['Checks', 'Contents'], 'Checks and Contents'],
    [['Checks', 'Contents', 'Members'], 'Checks, Contents and Members'],
  ])('renders %j as %p', (items, expected) => {
    expect(list(items)).toBe(expected);
  });
});
