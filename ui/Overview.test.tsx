/**
 * The left rail's Overview disclosure.
 *
 * Four regions, and each one has a way of lying that these tests exist to
 * prevent: a description that injects HTML, a check list that renders only one
 * arm of the `statusCheckRollup.contexts` union, a reviewer list that drops
 * teams, and a thread jump list that can only see the files already on screen.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { DraftStore } from '@/lib/review/drafts';
import { Overview } from './Overview';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { prPayload, pullRequestNode, reviewThread } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

beforeEach(() => {
  (request as unknown as Mock).mockReset();
});

function mount(
  payload: PrPayload,
  options: { paths?: readonly string[]; onJump?: (id: string, path: string) => void } = {},
) {
  return render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
      drafts={new DraftStore(memoryStore())}
    >
      <Overview
        payload={payload}
        paths={options.paths ?? []}
        onJumpToThread={options.onJump ?? (() => {})}
      />
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

describe('the unresolved thread jump list', () => {
  const payloadWithThreads = (threads: PrPayload['threads']): PrPayload =>
    prPayload({ threads });

  it('lists every unresolved thread and no resolved ones', () => {
    mount(
      payloadWithThreads([
        reviewThread({ path: 'src/app.ts', line: 4 }),
        reviewThread({ path: 'README.md', line: 9, isResolved: true }),
      ]),
      { paths: ['src/app.ts', 'README.md'] },
    );

    const list = screen.getByRole('list', { name: /unresolved/i });
    expect(list.textContent).toContain('src/app.ts');
    expect(list.textContent).not.toContain('README.md');
  });

  it('lists a thread on a file the diff column has not rendered', () => {
    // The per-file unanchorable section only exists once CodeView has drawn
    // that item, so this list is the only global index. A thread whose file is
    // not on screen — or not in the diff at all — would otherwise be invisible.
    mount(
      payloadWithThreads([reviewThread({ path: 'lib/dropped.ts', line: 3 })]),
      { paths: ['src/app.ts'] },
    );

    const list = screen.getByRole('list', { name: /unresolved/i });
    expect(list.textContent).toContain('lib/dropped.ts');
    expect(list.textContent).toMatch(/not in this diff/i);
  });

  it('asks the column to jump when an entry is pressed', async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    mount(payloadWithThreads([reviewThread({ path: 'src/app.ts', line: 4 })]), {
      paths: ['src/app.ts'],
      onJump,
    });

    await user.click(screen.getByRole('button', { name: /src\/app\.ts/ }));

    expect(onJump).toHaveBeenCalledWith('PRRT_src/app.ts:4', 'src/app.ts');
  });

  it('says so when nothing is outstanding', () => {
    mount(payloadWithThreads([]), { paths: ['src/app.ts'] });

    expect(screen.getByText(/no unresolved comments/i)).toBeDefined();
  });
});
