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

const tree = (payload: PrPayload, movedTo: string | null = null) => (
  <ReviewSessionProvider
    pullRequest={payload.pullRequest}
    prRef={payload.ref}
    threads={payload.threads}
    drafts={new DraftStore(memoryStore())}
  >
    <TopBar
      payload={payload}
      retry={() => {}}
      movedTo={movedTo}
      onDismissMoved={() => {}}
    />
  </ReviewSessionProvider>
);

const mount = (payload: PrPayload = prPayload(), movedTo: string | null = null) =>
  render(tree(payload, movedTo));

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

/**
 * Who is offered a review to open.
 *
 * The button is absent rather than disabled in both cases, which is the
 * opposite of what the footer does with Approve — and deliberately. A disabled
 * Approve sits beside an enabled Comment, so the pair says "that one, not
 * this"; there is no such neighbour here, and a primary button that can never
 * be pressed is chrome that reads as a bug. `NoticeCenter` carries the reason
 * for the permission case, and authorship needs none.
 */
describe('starting a review', () => {
  const startButton = () => screen.queryByRole('button', { name: /start a review/i });

  it('is offered on someone else’s pull request', () => {
    mount();

    expect(startButton()).not.toBeNull();
  });

  it('is not offered on your own', () => {
    // GitHub would accept it, as a COMMENT review. The two verdicts worth
    // opening a review for are both refused on your own work, and a comment
    // written without one posts immediately — which is what an author wants.
    mount(prPayload({ pullRequest: pullRequestNode({ viewerDidAuthor: true }) }));

    expect(startButton()).toBeNull();
  });

  it('is not offered to an account that can only read', () => {
    // Worse than useless there: the review would open, comments would queue on
    // it, and the submit would be refused — leaving every one of them invisible
    // with no way to post them.
    mount(
      prPayload({
        pullRequest: pullRequestNode({ repository: { viewerPermission: 'READ' } }),
      }),
    );

    expect(startButton()).toBeNull();
  });

  it('is offered when the permission field is missing', () => {
    // An older cached payload. Silence is not a refusal.
    mount(
      prPayload({ pullRequest: pullRequestNode({ repository: undefined }) }),
    );

    expect(startButton()).not.toBeNull();
  });

  it('still shows a review already open, whoever opened it', async () => {
    // The one case where the button has to survive the rule. A review resumed
    // from GitHub is submitted from the footer, and hiding the chip that says
    // one exists would leave the reviewer with queued comments and nothing on
    // screen saying so.
    requestMock.mockResolvedValue({
      ok: true,
      data: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_9' } } } },
    });
    const payload = prPayload();
    const { rerender } = mount(payload);

    await userEvent.click(screen.getByRole('button', { name: /start a review/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review pending/i })).toBeDefined();
    });

    rerender(
      tree(prPayload({ pullRequest: pullRequestNode({ viewerDidAuthor: true }) })),
    );

    expect(screen.getByRole('button', { name: /review pending/i })).toBeDefined();
  });
});
