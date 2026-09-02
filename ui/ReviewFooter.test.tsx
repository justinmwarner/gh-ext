/**
 * The pending-review footer.
 *
 * Two things here are honesty requirements rather than features. A review
 * resumed from GitHub arrives with no comment count, so the bar must not print
 * a confident zero over work the reviewer cannot see. And a submit that fails
 * must leave the queued comments exactly where they were — discarding them
 * would destroy writing that exists nowhere else.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_REVIEW, START_REVIEW, SUBMIT_REVIEW } from '@/lib/github/mutations';
import { DraftStore } from '@/lib/review/drafts';
import { ReviewFooter } from './ReviewFooter';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { pullRequestNode } from './prPayload.fixture';
import { ReviewSessionProvider, useReviewSession } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;

const STARTED = {
  ok: true,
  data: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_new' } } } },
} as const;

/** Drives the parts of the session the footer cannot reach on its own. */
function Harness() {
  const session = useReviewSession();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void session.startReview();
        }}
      >
        start review
      </button>
      <button
        type="button"
        onClick={() => {
          void session.postThread({
            path: 'src/app.ts',
            body: 'a comment',
            anchor: { line: 2, side: 'RIGHT' },
          });
        }}
      >
        queue comment
      </button>
    </div>
  );
}

function mount(
  options: {
    node?: Parameters<typeof pullRequestNode>[0];
    viewerIsAuthor?: boolean;
  } = {},
) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode(options.node ?? {})}
      prRef={PR_REF}
      threads={[]}
      drafts={new DraftStore(memoryStore())}
    >
      <Harness />
      <ReviewFooter viewerIsAuthor={options.viewerIsAuthor ?? false} />
    </ReviewSessionProvider>,
  );
}

const footer = () => screen.queryByRole('contentinfo');

/** Open a pending review the way the top bar does. */
async function startReview(user: ReturnType<typeof userEvent.setup>) {
  requestMock.mockResolvedValue(STARTED);
  await user.click(screen.getByRole('button', { name: /start review/i }));
  await waitFor(() => {
    expect(footer()).not.toBeNull();
  });
}

const lastCall = () => requestMock.mock.calls.at(-1)?.[0];

describe('ReviewFooter', () => {
  it('is not rendered while browsing', () => {
    mount();
    expect(footer()).toBeNull();
  });

  it('appears once a review is pending and says nothing is queued yet', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    expect(footer()?.textContent).toMatch(/no comments queued/i);
  });

  it('starts the review with START_REVIEW, which omits the event', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    expect(requestMock.mock.calls[0]?.[0]?.document).toBe(START_REVIEW);
    expect(requestMock.mock.calls[0]?.[0]?.variables).toEqual({
      pullRequestId: 'PR_kwDOABCD',
    });
  });

  it('counts the comments queued in this session', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /queue comment/i }));

    await waitFor(() => {
      expect(footer()?.textContent).toMatch(/1 comment queued/i);
    });
  });

  it('disappears when the review is submitted', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => {
      expect(footer()).toBeNull();
    });
  });
});

describe('submitting', () => {
  const cases = [
    { name: /^comment$/i, event: 'COMMENT' },
    { name: /request changes/i, event: 'REQUEST_CHANGES' },
    { name: /^approve$/i, event: 'APPROVE' },
  ] as const;

  for (const { name, event } of cases) {
    it(`sends ${event} for its control`, async () => {
      const user = userEvent.setup();
      mount();
      await startReview(user);

      requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
      await user.click(screen.getByRole('button', { name }));

      await waitFor(() => {
        expect(lastCall()?.document).toBe(SUBMIT_REVIEW);
      });
      expect(lastCall()?.variables).toEqual({
        pullRequestReviewId: 'PRR_new',
        event,
      });
    });
  }

  it('carries the summary when one was written', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.type(screen.getByRole('textbox', { name: /summary/i }), 'Looks good');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(lastCall()?.document).toBe(SUBMIT_REVIEW);
    });
    expect(lastCall()?.variables).toEqual({
      pullRequestReviewId: 'PRR_new',
      event: 'APPROVE',
      body: 'Looks good',
    });
  });

  it('keeps the pending review and says so when the submit fails', async () => {
    // The queued comments exist nowhere else. Clearing the footer here would
    // tell the reviewer their review went out when it did not.
    const user = userEvent.setup();
    mount();
    await startReview(user);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /queue comment/i }));
    await waitFor(() => {
      expect(footer()?.textContent).toMatch(/1 comment queued/i);
    });

    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
    });
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/GitHub said no/);
    expect(footer()).not.toBeNull();
    expect(footer()?.textContent).toMatch(/1 comment queued/i);
  });
});

describe('a review resumed from GitHub', () => {
  const resumed = {
    node: { viewerLatestReview: { id: 'PRR_resumed', state: 'PENDING' } },
  };

  it('does not claim a confident zero', () => {
    mount(resumed);

    expect(footer()).not.toBeNull();
    expect(footer()?.textContent).not.toMatch(/no comments queued/i);
    expect(footer()?.textContent).not.toMatch(/\b0 comments\b/i);
    expect(footer()?.textContent).toMatch(/unknown|already open|do not know/i);
  });

  it('says its count is a floor once this session queues one', async () => {
    const user = userEvent.setup();
    mount(resumed);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /queue comment/i }));

    await waitFor(() => {
      expect(footer()?.textContent).toMatch(/at least 1 comment/i);
    });
  });

  it('submits against the review id GitHub already had', async () => {
    const user = userEvent.setup();
    mount(resumed);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => {
      expect(lastCall()?.document).toBe(SUBMIT_REVIEW);
    });
    expect(lastCall()?.variables).toEqual({
      pullRequestReviewId: 'PRR_resumed',
      event: 'COMMENT',
    });
  });
});

describe('approving your own pull request', () => {
  it('is disabled, with the reason said out loud', async () => {
    // GitHub rejects it outright. Letting the button look live only trades a
    // clear explanation for an opaque 422.
    const user = userEvent.setup();
    mount({ viewerIsAuthor: true });
    await startReview(user);

    const approve = screen.getByRole('button', { name: /^approve$/i });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(footer()?.textContent).toMatch(/your own pull request/i);
  });

  it('leaves Comment and Request changes alone', async () => {
    const user = userEvent.setup();
    mount({ viewerIsAuthor: true });
    await startReview(user);

    expect(
      (screen.getByRole('button', { name: /^comment$/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: /request changes/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe('discarding', () => {
  it('asks before deleting queued comments', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    await user.click(screen.getByRole('button', { name: /^discard/i }));

    expect(requestMock.mock.calls.length).toBe(1);
    expect(footer()?.textContent).toMatch(/cannot be undone|permanently/i);
  });

  it('deletes the review on GitHub once confirmed', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    await user.click(screen.getByRole('button', { name: /^discard/i }));
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /discard the review/i }));

    await waitFor(() => {
      expect(footer()).toBeNull();
    });
    expect(lastCall()?.document).toBe(DELETE_REVIEW);
    expect(lastCall()?.variables).toEqual({ pullRequestReviewId: 'PRR_new' });
  });

  it('keeps the review when the delete fails', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    await user.click(screen.getByRole('button', { name: /^discard/i }));
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
    });
    await user.click(screen.getByRole('button', { name: /discard the review/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/GitHub said no/);
    expect(footer()).not.toBeNull();
  });
});
