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
          void session.discardReview();
        }}
      >
        harness discard
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

    expect(footer()?.textContent).toMatch(/nothing queued yet/i);
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
      expect(footer()?.textContent).toMatch(/1 comment not posted yet/i);
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
      expect(footer()?.textContent).toMatch(/1 comment not posted yet/i);
    });

    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
    });
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/GitHub said no/);
    expect(footer()).not.toBeNull();
    expect(footer()?.textContent).toMatch(/1 comment not posted yet/i);
  });
});

describe('a review resumed from GitHub', () => {
  const resumed = {
    node: { viewerLatestReview: { id: 'PRR_resumed', state: 'PENDING' } },
  };

  it('does not claim a confident zero', () => {
    mount(resumed);

    expect(footer()).not.toBeNull();
    expect(footer()?.textContent).not.toMatch(/nothing queued yet/i);
    expect(footer()?.textContent).not.toMatch(/\b0 comments\b/i);
    expect(footer()?.textContent).toMatch(/unknown|already open|do not know/i);
  });

  it('says its count is a floor once this session queues one', async () => {
    const user = userEvent.setup();
    mount(resumed);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /queue comment/i }));

    await waitFor(() => {
      expect(footer()?.textContent).toMatch(/at least 1 comment not posted yet/i);
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

/**
 * Reviewing your own pull request.
 *
 * GitHub allows exactly one verdict on your own work: COMMENT. Both of the
 * others are rejected outright —
 *
 *   Can not approve your own pull request
 *   Can not request changes on your own pull request
 *
 * — and a rejected submit is not a harmless one. The review stays pending with
 * every queued comment still invisible, and the reviewer is left holding a
 * review the page appeared to offer them a way to send.
 *
 * Request changes used to be left live, on the belief that only approval was
 * blocked. It was not tested, and it was wrong.
 */
describe('reviewing your own pull request', () => {
  const own = async (user: ReturnType<typeof userEvent.setup>) => {
    mount({ viewerIsAuthor: true });
    await startReview(user);
  };

  const control = (name: RegExp) =>
    screen.getByRole('button', { name }) as HTMLButtonElement;

  it('disables Approve', async () => {
    await own(userEvent.setup());

    expect(control(/^approve$/i).disabled).toBe(true);
  });

  it('disables Request changes, which GitHub rejects for the same reason', async () => {
    await own(userEvent.setup());

    expect(control(/request changes/i).disabled).toBe(true);
  });

  it('leaves Comment alone, because that one works', async () => {
    // The whole reason for not blocking self-review outright: leaving notes on
    // your own pull request is an ordinary thing to do, and it is allowed.
    await own(userEvent.setup());

    expect(control(/^comment$/i).disabled).toBe(false);
  });

  it('says what is unavailable, and what still is', async () => {
    // A disabled button with no explanation reads as a bug. A disabled button
    // with no way forward reads as a dead end — and there is a way forward.
    await own(userEvent.setup());

    // The note itself, not the footer: the footer's text contains the button
    // labels, so asserting on it would pass whatever the note said.
    const note = screen.getByRole('note').textContent ?? '';
    expect(note).toMatch(/your own pull request/i);
    expect(note).toMatch(/request(ing)? changes/i);
    expect(note).toMatch(/comment/i);
  });

  it('gives each blocked control the reason on hover', async () => {
    await own(userEvent.setup());

    expect(control(/^approve$/i).title).toMatch(/your own pull request/i);
    expect(control(/request changes/i).title).toMatch(/your own pull request/i);
  });

  it('blocks none of it for anybody else', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    for (const name of [/^comment$/i, /^approve$/i, /request changes/i]) {
      expect(control(name).disabled).toBe(false);
    }
    expect(footer()?.textContent).not.toMatch(/your own pull request/i);
  });
});

describe('discarding', () => {
  /**
   * The control is deliberately hidden. `deletePullRequestReview` is the only
   * destructive thing this extension can do — it removes a pending review and
   * every comment queued on it, including ones made in GitHub's own UI that
   * this page never saw, and nothing brings them back.
   *
   * The wiring stays covered here so re-enabling it is a one-line change to
   * SHOW_DISCARD rather than a rebuild. These drive the session directly,
   * which is exactly what the button would do.
   */
  it('offers no discard control in the footer', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    expect(screen.queryByRole('button', { name: /^discard/i })).toBeNull();
    expect(footer()).not.toBeNull();
  });

  it('deletes the review on GitHub when asked', async () => {
    const user = userEvent.setup();
    mount();
    await startReview(user);

    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    await user.click(screen.getByRole('button', { name: /harness discard/i }));

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

    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
    });
    await user.click(screen.getByRole('button', { name: /harness discard/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/GitHub said no/);
    expect(footer()).not.toBeNull();
  });
});
