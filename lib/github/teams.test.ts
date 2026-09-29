/**
 * Reading `VIEWER_TEAMS_QUERY`'s reply.
 *
 * Three answers have to stay three. A person's repository has no teams to be
 * on; a token GitHub will not tell about team membership has teams nobody can
 * see; and an organization member has a list. Collapsing the second into the
 * first would have the ownership filter quietly match on the login alone and
 * say nothing, which is the one outcome worse than saying it cannot tell.
 */

import { describe, expect, it } from 'vitest';
import type { DeniedField } from './graphql-errors';
import { readViewerTeams } from './teams';

const denial = (path: string, type: string): DeniedField => ({
  message: 'refused',
  path,
  count: 1,
  type,
});

const team = (slug: string, ancestors: string[] = []) => ({
  slug,
  ancestors: { nodes: ancestors.map((ancestor) => ({ slug: ancestor })) },
});

const listed = (nodes: ReturnType<typeof team>[], totalCount = nodes.length) => ({
  organization: { teams: { totalCount, nodes } },
});

describe('the reviewer’s teams', () => {
  it('names every team they are on the way CODEOWNERS spells one', () => {
    expect(readViewerTeams('Acme', 'Reviewer', listed([team('Backend'), team('docs')]), [])).toEqual({
      login: 'Reviewer',
      teams: ['@acme/backend', '@acme/docs'],
      truncated: false,
    });
  });

  it('counts a child team’s parents, which it inherits ownership from', () => {
    const data = listed([team('payments-api', ['payments', 'engineering'])]);

    expect(readViewerTeams('acme', 'reviewer', data, []).teams).toEqual([
      '@acme/payments-api',
      '@acme/payments',
      '@acme/engineering',
    ]);
  });

  it('names a team once however many ways they are on it', () => {
    const data = listed([team('backend'), team('api', ['backend'])]);

    expect(readViewerTeams('acme', 'reviewer', data, []).teams).toEqual([
      '@acme/backend',
      '@acme/api',
    ]);
  });

  it('says when GitHub counted more teams than it listed', () => {
    const data = listed([team('a'), team('b')], 140);

    expect(readViewerTeams('acme', 'reviewer', data, []).truncated).toBe(true);
  });

  it('has no teams in a repository a person owns, which is an answer rather than a refusal', () => {
    expect(
      readViewerTeams('someone', 'reviewer', { organization: null }, [
        denial('organization', 'NOT_FOUND'),
      ]),
    ).toEqual({ login: 'reviewer', teams: [], truncated: false });
  });

  it('does not know the teams when GitHub refuses to say', () => {
    const data = { organization: { teams: null } };

    expect(
      readViewerTeams('acme', 'reviewer', data, [denial('organization.teams', 'FORBIDDEN')]).teams,
    ).toBeNull();
  });

  it('does not know the teams when the list is simply missing', () => {
    // No refusal and no list is not "no teams": it is a reply this module does
    // not recognise, and the honest reading of that is that it cannot tell.
    expect(readViewerTeams('acme', 'reviewer', { organization: {} }, []).teams).toBeNull();
  });
});
