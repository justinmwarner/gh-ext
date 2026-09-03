/**
 * The rail's Overview page.
 *
 * Three regions, and each one has a way of lying that these tests exist to
 * prevent: a description that injects HTML, a check list that renders only one
 * arm of the `statusCheckRollup.contexts` union, and a reviewer list that drops
 * teams.
 *
 * Threads are not here. They have a page of their own, because "what is still
 * outstanding" was the thing a reviewer looks at most and it was at the bottom
 * of a scrolling box under a description of arbitrary length.
 */

import { render, screen } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { DraftStore } from '@/lib/review/drafts';
import { OverviewPage } from './OverviewPage';
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
      <OverviewPage payload={payload} />
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

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('bold');
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

  it('renders "no checks" for a head commit that has none', () => {
    // Null means no CI is configured, which is not an error and not a pending
    // check. `pierrecomputer/pierre#1` really does come back this way.
    mount(prPayload({ checks: null }));

    expect(screen.getByText(/no checks/i)).toBeDefined();
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
