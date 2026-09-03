/**
 * The sticky top bar: which pull request this is, and the two controls that
 * have to be reachable from every view.
 *
 * It carried the branch pair, the checks chip and the reviewer avatars as
 * well, and all three have moved to the Overview view — they are facts about
 * the change and they now sit beside the lists that explain them.
 *
 * What stays is what has to: the identity, so no view can leave you unsure
 * which pull request you are in; the pending chip, because forgetting a review
 * was never submitted is the one way to lose a whole review's writing; and
 * `Start a review`, which is the only thing that makes comments queue.
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
    <TopBar payload={payload} />
  </ReviewSessionProvider>
);

const mount = (payload: PrPayload = prPayload()) => render(tree(payload));

describe('TopBar', () => {
  it('renders the title and number from the payload', () => {
    mount();

    expect(screen.getByText('Cache the diff on head SHA')).toBeDefined();
    expect(screen.getByText('#42')).toBeDefined();
  });

  it('renders the state badge', () => {
    mount();

    expect(screen.getByText('Open')).toBeDefined();
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

/**
 * The page-level "nothing has gone out yet" indicator.
 *
 * The footer already says this, but the footer is at the bottom of a diff that
 * can be thousands of lines long. A reviewer working down a large pull request
 * spends almost all of their time with it off screen — and the whole hazard is
 * forgetting that the review has not been submitted.
 */
describe('while a review is pending', () => {
  const pendingPayload = () =>
    prPayload({
      pullRequest: pullRequestNode({
        viewerLatestReview: { id: 'PRR_pending', state: 'PENDING' },
      }),
    });

  it('says the comments are not posted, in the bar that is always on screen', () => {
    mount(pendingPayload());

    expect(screen.getByText(/not posted/i)).toBeTruthy();
  });

  it('explains where to post them', () => {
    mount(pendingPayload());

    expect(screen.getByText(/not posted/i).getAttribute('title')).toMatch(/submit/i);
  });

  it('says nothing of the kind while browsing', () => {
    // Every comment goes out as it is written, so there is nothing outstanding
    // and a permanent banner would only teach the reviewer to ignore it.
    mount();

    expect(screen.queryByText(/not posted/i)).toBeNull();
  });
});
