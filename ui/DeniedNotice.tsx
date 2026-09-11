/**
 * The notice for a pull request GitHub only partly answered.
 *
 * A GraphQL response is not pass or fail. A fine-grained token that grants the
 * repository but not one permission inside it gets the whole pull request back
 * with the denied subtree nulled and one error per refusal — so the page is
 * complete and correct apart from one missing part, and the right thing to do
 * is render it.
 *
 * The wrong thing to do is render it quietly. A nulled `statusCheckRollup`
 * reaches `ChecksChip` as `null` and comes out as "No checks", which is not a
 * gap in the page — it is a false statement about the pull request. This exists
 * so that the one place the page cannot be trusted says so itself, and points at
 * the token, which is the only thing that can fix it.
 *
 * It used to be a banner between the top bar and the diff. It is now a section
 * of the panel behind the top bar's notice button, which is where `NoticeCenter`
 * explains the trade: read on demand, but never scrolled away from.
 *
 * The table translating a GraphQL path into a permission on GitHub's token page
 * used to live here. It is now `lib/github/permissions.ts`, because the
 * full-page error for a pull request GitHub refused *outright* has to name the
 * same permissions in the same words — and a reviewer told "Checks" on one
 * screen and "status checks" on the other has to work out for themselves that
 * they are the same setting.
 */

import type { DeniedField } from '@/lib/github/graphql-errors';
import { list, summarizeAreas } from '@/lib/github/permissions';
import type { PrRef } from '@/lib/messages';
import { OpenInGitHub } from './OpenInGitHub';
import { openOptions } from './openOptions';

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

  const { areas, permissions, section } = summarizeAreas(denied);

  return (
    // `status`, not `alert`. The review below is real and usable; this is a
    // caveat on one part of it, not a reason to stop reading.
    <div className="notice-body" role="status">
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
      <p className="notice-detail">
        {denied.map((entry) => (
          <span key={`${entry.message} ${entry.path ?? ''}`} className="notice-line">
            {entry.message}
            {entry.path === null ? '' : ` — ${entry.path}`}
            {entry.count > 1 ? ` (${entry.count} fields)` : ''}
          </span>
        ))}
      </p>
      <div className="notice-actions">
        <button type="button" className="button" onClick={openOptions}>
          Check your token
        </button>
        <OpenInGitHub pr={pr} href={href} />
      </div>
    </div>
  );
}
