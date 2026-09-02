/**
 * The sticky top bar.
 *
 * Everything it shows is already in the payload, so none of it is a placeholder
 * — if the bar renders "#undefined" or an empty branch pair against a realistic
 * node, these tests say so before a real pull request does.
 *
 * It is mounted inside a session because the review control is a real control
 * now: `Start a review` opens the PENDING review the footer later submits.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { START_REVIEW } from '@/lib/github/mutations';
import { DraftStore } from '@/lib/review/drafts';
import { TopBar } from './TopBar';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { prPayload, pullRequestNode } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

const tree = (payload: PrPayload) => (
  <ReviewSessionProvider
    pullRequest={payload.pullRequest}
    prRef={payload.ref}
    threads={payload.threads}
    drafts={new DraftStore(memoryStore())}
  >
    <TopBar
      payload={payload}
      compare={{ active: false, available: false, busy: false, onToggle: () => {} }}
    />
  </ReviewSessionProvider>
);

const mount = (payload: PrPayload = prPayload()) => render(tree(payload));

describe('TopBar', () => {
  it('renders the title and number from the payload', () => {
    mount();

    expect(screen.getByText('Cache the diff on head SHA')).toBeDefined();
    expect(screen.getByText('#42')).toBeDefined();
  });

  it('renders the state badge and the branch pair', () => {
    const { container } = mount();

    expect(screen.getByText('Open')).toBeDefined();
    expect(container.textContent).toContain('main');
    expect(container.textContent).toContain('cache-the-diff');
  });

  it('prefers Draft and Merged over the raw state', () => {
    const { rerender } = mount(
      prPayload({ pullRequest: pullRequestNode({ isDraft: true }) }),
    );
    expect(screen.getByText('Draft')).toBeDefined();

    rerender(
      tree(
        prPayload({
          pullRequest: pullRequestNode({ state: 'MERGED', merged: true }),
        }),
      ),
    );
    expect(screen.getByText('Merged')).toBeDefined();
  });

  it('summarizes the check rollup, including the absence of one', () => {
    const { rerender, container } = mount();
    expect(container.textContent).toMatch(/checks passed/i);

    rerender(tree(prPayload({ checks: { state: 'FAILURE' } })));
    expect(container.textContent).toMatch(/checks failed/i);

    // A head commit with no checks at all is not a pending check.
    rerender(tree(prPayload({ checks: null })));
    expect(container.textContent).toMatch(/no checks/i);
  });

  it('names every reviewer, requested or already reviewed', () => {
    mount();

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

  it('links to the pull request on github.com', () => {
    mount();

    const link = screen.getByRole('link', { name: /open in github/i });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42');
  });
});

describe('starting a review', () => {
  it('opens a PENDING review with START_REVIEW, which omits the event', async () => {
    // Omitting `event` is the whole point: passing one would submit the review
    // on the spot instead of leaving it open for comments to attach to.
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: true,
      data: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } },
    });
    mount();

    await user.click(screen.getByRole('button', { name: /start a review/i }));

    await waitFor(() => {
      expect(requestMock.mock.calls[0]?.[0]?.document).toBe(START_REVIEW);
    });
    expect(requestMock.mock.calls[0]?.[0]?.variables).toEqual({
      pullRequestId: 'PR_kwDOABCD',
    });
  });

  it('says so when GitHub refuses', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'auth', message: 'Bad credentials', resetAt: null },
    });
    mount();

    await user.click(screen.getByRole('button', { name: /start a review/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Bad credentials/);
  });

  it('is disabled while a review is already pending', () => {
    mount(
      prPayload({
        pullRequest: pullRequestNode({
          viewerLatestReview: { id: 'PRR_open', state: 'PENDING' },
        }),
      }),
    );

    const button = screen.getByRole('button', {
      name: /review pending/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/already/i);
  });
});
