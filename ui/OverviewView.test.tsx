/**
 * The Overview view: everything about the change that is not the change.
 *
 * Four regions, and each has a way of lying that these tests exist to prevent:
 * a description that injects HTML, a check list that renders only one arm of
 * the `statusCheckRollup.contexts` union, a reviewer list that drops teams, and
 * a branch pair that silently shows one branch twice.
 *
 * Threads are not here. They have a view of their own, because "what is still
 * outstanding" is the thing a reviewer looks at most and it was at the bottom
 * of a scrolling box under a description of arbitrary length.
 */

import { render, screen } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { DraftStore } from '@/lib/review/drafts';
import { OverviewView } from './OverviewView';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { prPayload, pullRequestNode } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

beforeEach(() => {
  (request as unknown as Mock).mockReset();
});

function mount(payload: PrPayload) {
  return render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
      drafts={new DraftStore(memoryStore())}
    >
      <OverviewView payload={payload} />
    </ReviewSessionProvider>,
  );
}

describe('the description', () => {
  it('renders the words of bodyHTML', () => {
    mount(
      prPayload({
        pullRequest: pullRequestNode({
          bodyHTML: '<p>Caches the diff on <code>headRefOid</code>.</p>',
        }),
      }),
    );

    expect(screen.getByText(/Caches the diff on headRefOid\./)).toBeDefined();
  });

  it('does not inject the HTML it was given', () => {
    // No dangerouslySetInnerHTML and no sanitizer: the markup becomes text, so
    // nothing GitHub renders into a description can become a live element here.
    const { container } = mount(
      prPayload({
        pullRequest: pullRequestNode({
          bodyHTML: '<p><img src="x" onerror="1"><b>bold</b></p>',
        }),
      }),
    );

    // Scoped to the description. Reviewer avatars are real `<img>` elements
    // elsewhere on this view, and an unscoped query would pass on those.
    const description = container.querySelector('.overview-main');
    expect(description?.querySelector('img')).toBeNull();
    expect(description?.querySelector('b')).toBeNull();
    expect(description?.textContent).toContain('bold');
  });

  it('says so when there is no description at all', () => {
    mount(prPayload({ pullRequest: pullRequestNode({ bodyHTML: '' }) }));

    expect(screen.getByText(/no description/i)).toBeDefined();
  });
});

describe('the checks', () => {
  const withChecks = (nodes: unknown[], totalCount = nodes.length): PrPayload =>
    prPayload({
      checks: { state: 'SUCCESS', contexts: { totalCount, nodes } },
    });

  it('renders a CheckRun and a StatusContext from the same rollup', () => {
    mount(
      withChecks([
        {
          __typename: 'CheckRun',
          name: 'Compile & Hygiene',
          conclusion: 'FAILURE',
          status: 'COMPLETED',
          detailsUrl: 'https://github.com/acme/widgets/actions/runs/1',
          checkSuite: { app: { name: 'GitHub Actions' } },
        },
        {
          __typename: 'StatusContext',
          context: 'node-test-commit',
          state: 'SUCCESS',
          targetUrl: 'https://ci.nodejs.org/job/node-test-commit/1/',
          description: 'tests passed',
        },
      ]),
    );

    expect(screen.getByText('Compile & Hygiene')).toBeDefined();
    expect(screen.getByText('node-test-commit')).toBeDefined();
  });

  it('says nothing has run for a head commit with no checks', () => {
    // Null means no CI is configured, which is not an error and not a pending
    // check. `pierrecomputer/pierre#1` really does come back this way.
    mount(prPayload({ checks: null }));

    expect(screen.getByText(/nothing has run/i)).toBeDefined();
  });

  it('degrades an unknown conclusion into readable words', () => {
    mount(
      withChecks([
        { __typename: 'CheckRun', name: 'future', conclusion: 'QUANTUM_UNCERTAINTY' },
      ]),
    );

    expect(screen.getByText('Quantum uncertainty')).toBeDefined();
  });

  it('says how many contexts the page did not carry', () => {
    mount(
      withChecks(
        [{ __typename: 'CheckRun', name: 'one', conclusion: 'SUCCESS' }],
        140,
      ),
    );

    expect(screen.getByText(/139 more/i)).toBeDefined();
  });
});

describe('the reviewers', () => {
  it('names everyone with their verdict, including teams and bots', () => {
    mount(
      prPayload({
        pullRequest: pullRequestNode({
          latestReviews: {
            nodes: [
              { author: { login: 'dana' }, state: 'CHANGES_REQUESTED' },
            ],
          },
          reviewRequests: {
            nodes: [
              {
                requestedReviewer: {
                  __typename: 'Team',
                  name: 'Platform Infrastructure',
                  slug: 'platform-infra',
                },
              },
              {
                requestedReviewer: {
                  __typename: 'Bot',
                  login: 'copilot-pull-request-reviewer',
                },
              },
            ],
          },
        }),
      }),
    );

    const reviewers = screen.getByRole('list', { name: /reviewers/i });
    expect(reviewers.textContent).toMatch(/dana/);
    expect(reviewers.textContent).toMatch(/requested changes/i);
    expect(reviewers.textContent).toMatch(/platform-infra \(team\)/);
    expect(reviewers.textContent).toMatch(/copilot-pull-request-reviewer \(bot\)/);
  });

  it('says so when nobody has been asked', () => {
    mount(
      prPayload({
        pullRequest: pullRequestNode({
          latestReviews: { nodes: [] },
          reviewRequests: { nodes: [] },
        }),
      }),
    );

    expect(screen.getByText(/no reviewers/i)).toBeDefined();
  });
});

describe('the branches', () => {
  it('names what is being merged into what', () => {
    // It was in the top bar beside the title, as though it described the pull
    // request rather than one fact about it.
    mount(
      prPayload({
        pullRequest: pullRequestNode({
          baseRefName: 'main',
          headRefName: 'cache-the-diff',
        }),
      }),
    );

    const branches = screen.getByTitle(/merging cache-the-diff into main/i);
    expect(branches.textContent).toContain('main');
    expect(branches.textContent).toContain('cache-the-diff');
  });

  it('says nothing rather than half a pair when GitHub withheld one', () => {
    // `main ←` reads as a branch pair with one branch in it, not as a gap.
    mount(prPayload({ pullRequest: pullRequestNode({ headRefName: null }) }));

    expect(screen.getByText(/did not say which branches/i)).toBeDefined();
    expect(screen.queryByTitle(/merging/i)).toBeNull();
  });
});

describe('the summaries beside each list', () => {
  it('puts the rollup chip at the head of the checks', () => {
    const { container } = mount(prPayload({ checks: null }));

    const head = container.querySelector('.overview-head .chip');
    expect(head?.textContent).toBe('No checks');
  });

  it('summarizes the rollup in that chip, including the absence of one', () => {
    const chip = () =>
      document.querySelector('.overview-head .chip')?.textContent ?? '';

    const { unmount } = mount(prPayload());
    expect(chip()).toMatch(/checks passed/i);
    unmount();

    const failed = mount(prPayload({ checks: { state: 'FAILURE' } }));
    expect(chip()).toMatch(/checks failed/i);
    failed.unmount();

    // A head commit with no checks at all is not a pending check.
    mount(prPayload({ checks: null }));
    expect(chip()).toMatch(/no checks/i);
  });

  it('puts the avatars at the head of the reviewers', () => {
    mount(prPayload());

    expect(screen.getByRole('img', { name: /dana/ })).toBeDefined();
    expect(screen.getByRole('img', { name: /kim/ })).toBeDefined();
  });

  it('names a team and a bot reviewer as such, not as usernames', () => {
    // A pull request whose only pending reviewer is a team used to render no
    // avatars at all, which reads as "nobody has been asked to review".
    mount(
      prPayload({
        pullRequest: pullRequestNode({
          latestReviews: { nodes: [] },
          reviewRequests: {
            nodes: [
              {
                requestedReviewer: {
                  __typename: 'Team',
                  name: 'Platform Infrastructure',
                  slug: 'platform-infra',
                },
              },
              {
                requestedReviewer: {
                  __typename: 'Bot',
                  login: 'copilot-pull-request-reviewer',
                  avatarUrl: 'https://avatars.example/copilot',
                },
              },
            ],
          },
        }),
      }),
    );

    expect(screen.getByRole('img', { name: /platform-infra \(team\)/ })).toBeDefined();
    expect(
      screen.getByRole('img', { name: /copilot-pull-request-reviewer \(bot\)/ }),
    ).toBeDefined();
  });
});
