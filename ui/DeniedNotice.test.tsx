/**
 * The banner for a pull request GitHub only partly answered.
 *
 * The failure that produced it: a fine-grained token granting the repository
 * but not the Checks permission. GitHub returned the whole pull request with
 * the check runs nulled out and one error per denial — and the page, which
 * refused any response carrying an error, showed "Resource not accessible by
 * personal access token" seven times over instead of the review.
 *
 * Tolerating that is most of the fix. This is the rest of it: `checks: null`
 * renders as "No checks", and telling a reviewer a pull request has no CI when
 * the truth is they may not see it is a worse failure than the crash was.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeniedField } from '@/lib/github/graphql-errors';
import type { PrRef } from '@/lib/messages';
import { DeniedNotice } from './DeniedNotice';

vi.mock('./openOptions', () => ({ openOptions: vi.fn() }));

const pr: PrRef = { owner: 'acme', repo: 'widgets', number: 42 };

const checksDenied: DeniedField[] = [
  {
    message: 'Resource not accessible by personal access token',
    path: 'repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.contexts.nodes.N',
    count: 7,
    type: null,
  },
];

const notice = () => screen.queryByRole('status');

describe('DeniedNotice', () => {
  it('renders nothing on an ordinary read', () => {
    render(<DeniedNotice denied={[]} pr={pr} />);

    expect(notice()).toBeNull();
  });

  it('names the status checks rather than the GraphQL path', () => {
    // `commits.nodes.N.commit.statusCheckRollup.contexts.nodes.N` is the
    // diagnosis, not the explanation. The reviewer needs to know which part of
    // the page is lying to them.
    render(<DeniedNotice denied={checksDenied} pr={pr} />);

    expect(notice()?.textContent).toMatch(/status checks/i);
  });

  it('names the permission that would fix it', () => {
    render(<DeniedNotice denied={checksDenied} pr={pr} />);

    expect(notice()?.textContent).toMatch(/checks/i);
    expect(notice()?.textContent).toMatch(/read/i);
  });

  it('offers the settings page, because that is where the token is changed', () => {
    render(<DeniedNotice denied={checksDenied} pr={pr} />);

    expect(screen.getByRole('button', { name: /token/i })).toBeTruthy();
  });

  it('keeps GitHub’s own sentence, which is the only specific thing it has', () => {
    render(<DeniedNotice denied={checksDenied} pr={pr} />);

    expect(notice()?.textContent).toContain(
      'Resource not accessible by personal access token',
    );
  });

  it('says something useful about a refusal it does not recognize', () => {
    // A field this build has never heard of must still produce a banner. The
    // alternative is a page silently missing something with no way to tell.
    render(
      <DeniedNotice
        denied={[{ message: 'Nope', path: 'repository.pullRequest.mystery', count: 1, type: null }]}
        pr={pr}
      />,
    );

    expect(notice()).not.toBeNull();
    expect(notice()?.textContent).toContain('repository.pullRequest.mystery');
  });

  it('survives a refusal GitHub sent no path for', () => {
    render(<DeniedNotice denied={[{ message: 'Nope', path: null, count: 1, type: null }]} pr={pr} />);

    expect(notice()?.textContent).toContain('Nope');
  });
});

describe('a requested reviewer the token could not read', () => {
  /**
   * `requestedReviewer` is a union with `Team` and `EnterpriseTeam` in it, and
   * those are organisation objects a repository-scoped fine-grained token is
   * not granted. GitHub nulls the node and the avatar row renders empty —
   * indistinguishable from "nobody has been asked", which is exactly the
   * failure the union was widened to prevent.
   *
   * Without an entry here the banner falls through to printing the raw GraphQL
   * path and suppresses the "usually the token is missing X" line entirely, so
   * the reviewer is shown a schema path and no action.
   */
  const teamDenied: DeniedField[] = [
    {
      message: 'Resource not accessible by personal access token',
      path: 'repository.pullRequest.reviewRequests.nodes.N.requestedReviewer',
      count: 1,
      type: 'FORBIDDEN',
    },
  ];

  it('names the requested reviewers in words a reader recognises', () => {
    render(<DeniedNotice denied={teamDenied} pr={pr} href={null} />);

    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/reviewer/i);
  });

  it('does not describe the missing part as a GraphQL path', () => {
    // The verbatim path still appears in the detail line, which is deliberate.
    // What must not happen is the schema path standing in for the sentence
    // that tells a reader what is missing.
    render(<DeniedNotice denied={teamDenied} pr={pr} href={null} />);

    expect(screen.getByRole('status').textContent).not.toMatch(
      /would not show this token part of this pull request/,
    );
  });

  it('sends the reviewer to the section that permission is actually in', () => {
    // Members is an organisation permission. The remedy used to name
    // "Repository permissions" for every case, so following it means scrolling
    // a list that does not contain the setting.
    render(<DeniedNotice denied={teamDenied} pr={pr} href={null} />);

    expect(screen.getByRole('status').textContent).toMatch(/Organization permissions/);
  });

  it('names a permission that would fix it', () => {
    render(<DeniedNotice denied={teamDenied} pr={pr} href={null} />);

    expect(screen.getByRole('status').textContent).toMatch(/permission/i);
  });
});
