/**
 * GitHub's refusals, translated into the words on GitHub's own token page.
 *
 * A denial arrives as a GraphQL path (`…commit.statusCheckRollup.contexts…`)
 * or as a REST header (`x-accepted-github-permissions: checks=read`). Neither
 * is a sentence a reviewer can act on, and neither matches the headings they
 * would have to find to fix it — so both are mapped here, once, to the
 * permission name and the list it lives under on the token page.
 *
 * It lives in `lib/` because two surfaces need the same words: the notice for
 * a pull request GitHub only *partly* answered, and the full-page error for
 * one it refused outright. Two copies of this table would drift, and a
 * reviewer told "Checks" on one screen and "status checks" on the other has to
 * work out that they are the same setting.
 *
 * Pure: no DOM, no `chrome.*`, no network.
 */

import type { DeniedField } from './graphql-errors';

/**
 * Which list on GitHub's token page the setting is under.
 *
 * Named per permission rather than assumed, because they are not all in the
 * same place: `Members` is an organisation permission, and telling someone to
 * find it under Repository permissions sends them to scroll a list that does
 * not contain it.
 */
export type Section = 'Repository permissions' | 'Organization permissions';

/** A refused subtree, in terms of the page rather than the schema. */
export interface Area {
  what: string;
  permission: string | null;
  section: Section | null;
}

/**
 * Only the subtrees this extension's query actually asks for that a token can
 * be refused. Anything else falls through to the path itself — worse to read,
 * but a notice naming a field nobody recognizes still beats a page that has
 * gone quiet about something it could not load.
 */
const AREAS: readonly {
  match: string;
  what: string;
  permission: string;
  section: Section;
}[] = [
  {
    match: 'statusCheckRollup',
    what: 'the status checks',
    permission: 'Checks',
    section: 'Repository permissions',
  },
  {
    match: 'reviewThreads',
    what: 'some review comments',
    permission: 'Pull requests',
    section: 'Repository permissions',
  },
  {
    match: 'files',
    what: 'part of the file list',
    permission: 'Pull requests',
    section: 'Repository permissions',
  },
  {
    // `requestedReviewer` is a union with `Team` and `EnterpriseTeam` in it,
    // and those are organisation objects — not something a token scoped to a
    // repository is granted. GitHub nulls the node, the avatar row comes out
    // empty, and an empty row is indistinguishable from "nobody has been
    // asked to review this", which is the exact confusion the union was
    // widened to prevent.
    match: 'reviewRequests',
    what: 'who has been asked to review',
    permission: 'Members',
    // Not a repository permission. Naming the wrong heading sends the reviewer
    // to scroll a list that does not contain the setting.
    section: 'Organization permissions',
  },
];

/**
 * GitHub's REST permission slugs, in the words its own token page uses.
 *
 * `x-accepted-github-permissions` answers in snake_case — `pull_requests=read`
 * — and two of them are not simply the slug with the underscore removed:
 * `statuses` is listed as **Commit statuses**, and `administration` as
 * **Administration**. Printing the raw slug would send a reviewer looking for
 * a row called "statuses" that is not there.
 */
const SLUGS: Readonly<Record<string, { permission: string; section: Section }>> = {
  pull_requests: { permission: 'Pull requests', section: 'Repository permissions' },
  contents: { permission: 'Contents', section: 'Repository permissions' },
  checks: { permission: 'Checks', section: 'Repository permissions' },
  statuses: { permission: 'Commit statuses', section: 'Repository permissions' },
  metadata: { permission: 'Metadata', section: 'Repository permissions' },
  issues: { permission: 'Issues', section: 'Repository permissions' },
  administration: { permission: 'Administration', section: 'Repository permissions' },
  members: { permission: 'Members', section: 'Organization permissions' },
};

/** A denied GraphQL path, as an area of the page. */
export function areaOf(path: string | null): Area {
  if (path !== null) {
    const known = AREAS.find((area) => path.includes(area.match));
    if (known) {
      return { what: known.what, permission: known.permission, section: known.section };
    }
    return { what: `part of this pull request (${path})`, permission: null, section: null };
  }
  return { what: 'part of this pull request', permission: null, section: null };
}

export interface AreaSummary {
  /** The distinct areas, in the order they were refused. */
  areas: Area[];
  /** The permissions those areas want, deduplicated. */
  permissions: string[];
  /**
   * The list all of them live under, or null when they are not all in one.
   *
   * Named only when every missing permission lives in the same list. Mixed, a
   * single heading would be wrong for at least one of them, and a wrong
   * instruction is worse than a slightly vaguer one.
   */
  section: Section | null;
}

export function summarizeAreas(denied: readonly DeniedField[]): AreaSummary {
  const areas: Area[] = [];
  const seen = new Set<string>();
  for (const entry of denied) {
    const area = areaOf(entry.path);
    if (seen.has(area.what)) continue;
    seen.add(area.what);
    areas.push(area);
  }

  const permissions = [
    ...new Set(areas.map((a) => a.permission).filter((p): p is string => p !== null)),
  ];
  const sections = [
    ...new Set(areas.map((a) => a.section).filter((s): s is Section => s !== null)),
  ];
  return { areas, permissions, section: sections.length === 1 ? (sections[0] ?? null) : null };
}

/**
 * `x-accepted-github-permissions`, as a permission name and its list.
 *
 * The header can name more than one requirement — `issues=write,metadata=read`
 * — and GitHub also writes alternatives with `; `. Only the first is taken:
 * listing every acceptable permission turns a one-line instruction into a
 * puzzle, and the first is the one the endpoint primarily wanted.
 */
export function permissionFromHeader(header: string | null): Area | null {
  if (header === null || header === '') return null;
  const first = header.split(/[;,]/)[0]?.trim() ?? '';
  const slug = first.split('=')[0]?.trim() ?? '';
  const known = SLUGS[slug];
  if (!known) return null;
  return { what: 'this request', permission: known.permission, section: known.section };
}

/** `['a', 'b', 'c']` → `a, b and c`. */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
