/**
 * The state every review surface shares: the threads, the pending review, and
 * the two mutations that change them.
 *
 * The worker is mocked at `./background`, so nothing here touches `chrome.*`
 * and a failure always means the page decided something wrong rather than that
 * an extension API was missing.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_THREAD, RESOLVE_THREAD } from '@/lib/github/mutations';
import { DraftStore } from '@/lib/review/drafts';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { pullRequestNode, reviewThread } from './prPayload.fixture';
import {
  ReviewSessionProvider,
  initialPendingReview,
  useReviewSession,
} from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;

const ANCHOR = { line: 2, side: 'RIGHT' } as const;

/** Drives the session directly, so the plumbing is what is under test. */
function Harness() {
  const session = useReviewSession();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void session.postThread({
            path: 'src/app.ts',
            body: 'a comment',
            anchor: ANCHOR,
          });
        }}
      >
        post
      </button>
      <button
        type="button"
        onClick={() => {
          void session.setResolved('PRRT_src/app.ts:2', true);
        }}
      >
        resolve
      </button>
      <p data-testid="mode">{session.pending.kind}</p>
      <p data-testid="threads">{session.threads.map((t) => t.id).join(',')}</p>
    </div>
  );
}

function mount(node: Parameters<typeof pullRequestNode>[0] = {}) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode(node)}
      prRef={PR_REF}
      threads={[reviewThread({ path: 'src/app.ts', line: 2 })]}
      drafts={new DraftStore(memoryStore())}
    >
      <Harness />
    </ReviewSessionProvider>,
  );
}

/** The `variables` of the nth `mutate` the page sent. */
const variablesOf = (call: number): Record<string, unknown> =>
  requestMock.mock.calls[call]?.[0]?.variables ?? {};

describe('initialPendingReview', () => {
  it('starts in Browse when the viewer has no review open', () => {
    expect(initialPendingReview(pullRequestNode())).toEqual({ kind: 'browse' });
  });

  it('resumes a PENDING review the viewer started in GitHub itself', () => {
    // Without this the first comment posts standalone against the pull request
    // and is orphaned by the open review — the reviewer submits and it is not
    // there.
    const node = pullRequestNode({
      viewerLatestReview: { id: 'PRR_pending', state: 'PENDING' },
    });

    expect(initialPendingReview(node)).toEqual({
      kind: 'pending',
      reviewId: 'PRR_pending',
      commentCount: 0,
      // The query carries no comment count for a review that was already open,
      // so the zero above counts this session only and must not be presented
      // as the whole truth.
      countIsComplete: false,
    });
  });

  it('stays in Browse for a review the viewer already submitted', () => {
    const node = pullRequestNode({
      viewerLatestReview: { id: 'PRR_done', state: 'APPROVED' },
    });

    expect(initialPendingReview(node)).toEqual({ kind: 'browse' });
  });

  it('stays in Browse when a PENDING review arrives without an id', () => {
    const node = pullRequestNode({ viewerLatestReview: { state: 'PENDING' } });

    expect(initialPendingReview(node)).toEqual({ kind: 'browse' });
  });
});

describe('postThread', () => {
  it('targets the pull request when no review is open', async () => {
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock.mock.calls[0]?.[0]?.document).toBe(ADD_THREAD);
    expect(variablesOf(0)['pullRequestId']).toBe('PR_kwDOABCD');
    expect('pullRequestReviewId' in variablesOf(0)).toBe(false);
  });

  it('targets the resumed review, not the pull request', async () => {
    // The two are mutually exclusive on the mutation input. Sending both, or
    // the wrong one, is exactly what the state machine exists to prevent.
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount({ viewerLatestReview: { id: 'PRR_pending', state: 'PENDING' } });

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(variablesOf(0)['pullRequestReviewId']).toBe('PRR_pending');
    expect('pullRequestId' in variablesOf(0)).toBe(false);
  });

  it('sends no start fields for a single-line comment', () => {
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount();

    return userEvent
      .click(screen.getByRole('button', { name: 'post' }))
      .then(() => waitFor(() => expect(requestMock).toHaveBeenCalled()))
      .then(() => {
        expect('startLine' in variablesOf(0)).toBe(false);
        expect('startSide' in variablesOf(0)).toBe(false);
      });
  });

  it('adds the thread GitHub returned so the reviewer sees it at once', async () => {
    const created = reviewThread({ path: 'src/app.ts', line: 3, id: 'PRRT_new' });
    requestMock.mockResolvedValue({
      ok: true,
      data: { data: { addPullRequestReviewThread: { thread: created } } },
    });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() =>
      expect(screen.getByTestId('threads').textContent).toContain('PRRT_new'),
    );
  });

  it('names the pull request so the worker can drop its stale cache', async () => {
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock.mock.calls[0]?.[0]?.pr).toEqual(PR_REF);
  });
});

describe('setResolved', () => {
  it('sends the resolve mutation for the thread', async () => {
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'resolve' }));

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock.mock.calls[0]?.[0]?.document).toBe(RESOLVE_THREAD);
    expect(variablesOf(0)['threadId']).toBe('PRRT_src/app.ts:2');
  });
});
