/**
 * The banner for a pull request GitHub only partly answered.
 *
 * A GraphQL response is not pass or fail. A fine-grained token that grants the
 * repository but not one permission inside it gets the whole pull request back
 * with the denied subtree nulled and one error per refusal — so the page is
 * complete and correct apart from one missing part, and the right thing to do
 * is render it.
 *
 * The wrong thing to do is render it quietly. A nulled `statusCheckRollup`
 * reaches `ChecksChip` as `null` and comes out as "No checks", which is not a
 * gap in the page — it is a false statement about the pull request. This banner
 * exists so that the one place the page cannot be trusted says so itself, and
 * points at the token, which is the only thing that can fix it.
 */

import type { DeniedField } from '@/lib/github/graphql-errors';
import type { PrRef } from '@/lib/messages';
import { OpenInGitHub } from './OpenInGitHub';
import { openOptions } from './openOptions';

/**
 * Which list on GitHub's token page the setting is under.
 *
 * Named per permission rather than assumed, because they are not all in the
 * same place: `Members` is an organisation permission, and telling someone to
 * find it under Repository permissions sends them to scroll a list that does
 * not contain it.
 */
type Section = 'Repository permissions' | 'Organization permissions';

/**
 * A denied path, in terms of the page rather than the schema.
 *
 * Only the subtrees this query actually asks for that a token can be refused.
 * Anything else falls through to the path itself — worse to read, but a banner
 * naming a field nobody recognizes still beats a page that has gone quiet about
 * something it could not load.
 */
const AREAS: { match: string; what: string; permission: string; section: Section }[] = [
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

interface Area {
  what: string;
  permission: string | null;
  section: Section | null;
}

function areaOf(denied: DeniedField): Area {
  const path = denied.path;
  if (path !== null) {
    const known = AREAS.find((area) => path.includes(area.match));
    if (known) {
      return { what: known.what, permission: known.permission, section: known.section };
    }
    return { what: `part of this pull request (${path})`, permission: null, section: null };
  }
  return { what: 'part of this pull request', permission: null, section: null };
}

/** The distinct areas, in the order they were refused. */
function summarize(denied: readonly DeniedField[]): {
  areas: Area[];
  permissions: string[];
  section: Section | null;
} {
  const areas: Area[] = [];
  const seen = new Set<string>();
  for (const entry of denied) {
    const area = areaOf(entry);
    if (seen.has(area.what)) continue;
    seen.add(area.what);
    areas.push(area);
  }

  const permissions = [
    ...new Set(areas.map((a) => a.permission).filter((p): p is string => p !== null)),
  ];
  // Named only when every missing permission lives in the same list. Mixed, a
  // single heading would be wrong for at least one of them, and a wrong
  // instruction is worse than a slightly vaguer one.
  const sections = [
    ...new Set(areas.map((a) => a.section).filter((s): s is Section => s !== null)),
  ];
  const section = sections.length === 1 ? (sections[0] ?? null) : null;
  return { areas, permissions, section };
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function DeniedNotice({
  denied,
  pr,
  href,
}: {
  denied: readonly DeniedField[];
  pr: PrRef;
  href?: string | null;
}) {
  if (denied.length === 0) return null;

  const { areas, permissions, section } = summarize(denied);

  return (
    // `status`, not `alert`. The review below is real and usable; this is a
    // caveat on one part of it, not a reason to stop reading.
    <div className="notice denied-notice" role="status">
      <div className="denied-body">
        <p>
          GitHub would not show this token {list(areas.map((a) => a.what))}, so that
          part of this page is missing rather than empty.
        </p>
        {permissions.length > 0 && (
          <p>
            Usually the token is missing the <strong>{list(permissions)}</strong>{' '}
            permission. On the token's page
            {section === null ? '' : ', under '}
            {section === null ? '' : <strong>{section}</strong>}, set{' '}
            {permissions.length === 1 ? 'it' : 'them'} to <strong>Read-only</strong>{' '}
            and reload.
          </p>
        )}
        {/* GitHub's own words. The only part of this that is specific to what
            actually happened, and the only part worth quoting to anyone. */}
        <p className="detail">
          {denied.map((entry) => (
            <span key={`${entry.message} ${entry.path ?? ''}`} className="denied-line">
              {entry.message}
              {entry.path === null ? '' : ` — ${entry.path}`}
              {entry.count > 1 ? ` (${entry.count} fields)` : ''}
            </span>
          ))}
        </p>
      </div>
      <div className="denied-actions">
        <button type="button" className="button" onClick={openOptions}>
          Check your token
        </button>
        <OpenInGitHub pr={pr} href={href} />
      </div>
    </div>
  );
}
