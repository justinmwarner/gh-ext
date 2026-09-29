/**
 * Who the reviewer is, as a CODEOWNERS file would name them.
 *
 * `VIEWER_TEAMS_QUERY`'s reply, read into the two things an owner line can
 * spell: a login and a team. Teams come back as `@org/slug`, lowercased,
 * because that is how CODEOWNERS writes one and GitHub reads both without case.
 *
 * Pure: the worker asks GitHub for the login, then for the teams, and hands
 * over what came back — refusals included, because what was refused decides
 * which of three answers this is.
 */

import type { DeniedField } from './graphql-errors';

/** The most teams the query lists. More than this is said, not assumed away. */
export const TEAM_PAGE = 100;

export interface ViewerTeams {
  login: string;
  /**
   * Every team the reviewer is on in the repository owner's organization, with
   * the parents they inherit from — or null when GitHub would not say.
   *
   * Empty, not null, for a repository a person owns. There are no teams there
   * to be on, and the difference matters to what the page says: "matching your
   * login" is complete in one case and a shortfall in the other.
   */
  teams: string[] | null;
  /**
   * GitHub counted more teams than it listed, so `teams` is the first
   * {@link TEAM_PAGE} and their parents rather than all of them.
   */
  truncated: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The slugs in the team list, each followed by its ancestors'. */
function slugsIn(list: Record<string, unknown>): string[] {
  const nodes = list['nodes'];
  if (!Array.isArray(nodes)) return [];
  const slugs: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node) || typeof node['slug'] !== 'string') continue;
    slugs.push(node['slug']);
    const ancestors = node['ancestors'];
    if (!isRecord(ancestors) || !Array.isArray(ancestors['nodes'])) continue;
    for (const ancestor of ancestors['nodes']) {
      if (isRecord(ancestor) && typeof ancestor['slug'] === 'string') slugs.push(ancestor['slug']);
    }
  }
  return slugs;
}

/**
 * The teams half of the answer, given the login the worker already has.
 *
 * Three outcomes, kept three:
 *
 * - A repository a person owns: GitHub cannot resolve an organization for the
 *   login and says so with NOT_FOUND at exactly `organization`. `teams: []`.
 * - Anything else refused on the way to the teams — the organization, or the
 *   list — and the list is not the list. `teams: null`.
 * - The list.
 */
export function readViewerTeams(
  owner: string,
  login: string,
  data: unknown,
  denied: readonly DeniedField[],
): ViewerTeams {
  const personal = denied.some(
    (refusal) => refusal.path === 'organization' && refusal.type === 'NOT_FOUND',
  );
  if (personal) return { login, teams: [], truncated: false };

  const about = (path: string | null): boolean =>
    path !== null && (path === 'organization' || path.startsWith('organization.'));
  if (denied.some((refusal) => about(refusal.path))) {
    return { login, teams: null, truncated: false };
  }

  const organization = isRecord(data) ? data['organization'] : null;
  const list = isRecord(organization) ? organization['teams'] : null;
  if (!isRecord(list)) return { login, teams: null, truncated: false };

  const prefix = `@${owner.toLowerCase()}/`;
  const teams = [...new Set(slugsIn(list).map((slug) => `${prefix}${slug.toLowerCase()}`))];
  const counted = typeof list['totalCount'] === 'number' ? list['totalCount'] : 0;
  const listed = Array.isArray(list['nodes']) ? list['nodes'].length : 0;
  return { login, teams, truncated: counted > listed };
}
