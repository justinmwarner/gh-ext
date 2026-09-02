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
import {
  ADD_REPLY,
  ADD_THREAD,
  RESOLVE_THREAD,
  START_REVIEW,
  SUBMIT_REVIEW,
} from '@/lib/github/mutations';
import { DraftStore } from '@/lib/review/drafts';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { pullRequestNode, reviewThread } from './prPayload.fixture';
import {
  ReviewSessionProvider,
  initialPendingReview,
  openReviewId,
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
      <button
        type="button"
        onClick={() => {
          void session.startReview();
        }}
      >
        start
      </button>
      <button
        type="button"
        onClick={() => {
          void session.submitReview('COMMENT', '');
        }}
      >
        submit
      </button>
      <button
        type="button"
        onClick={() => {
          void session.reply('PRRT_src/app.ts:2', 'a reply');
        }}
      >
        reply
      </button>
      <p data-testid="mode">{session.pending.kind}</p>
      <p data-testid="complete">
        {session.pending.kind === 'pending' ? String(session.pending.countIsComplete) : ''}
      </p>
      <p data-testid="threads">{session.threads.map((t) => t.id).join(',')}</p>
      <p data-testid="unpublished">{[...session.unpublished].join(',')}</p>
      <p data-testid="failures">{[...session.failures.values()].join(' | ')}</p>
    </div>
  );
}

/**
 * Answer each mutation by which document it carries.
 *
 * The publish path is three round trips, and asserting on it needs the review
 * id from the first to come back so the second can be checked against it.
 */
function answerByDocument(
  overrides: Partial<Record<string, unknown>> = {},
  reviewId = 'PRR_transient',
  /** What a re-read of the pull request says the viewer already has open. */
  alreadyOpen: string | null = null,
) {
  requestMock.mockImplementation((msg: { kind?: string; document: string }) => {
    if (msg.kind === 'get-pr') {
      return Promise.resolve({
        ok: true,
        data: {
          pullRequest: {
            viewerPendingReview: alreadyOpen === null ? null : { id: alreadyOpen },
          },
        },
      });
    }
    if (msg.document in overrides) return Promise.resolve(overrides[msg.document]);
    if (msg.document === START_REVIEW) {
      return Promise.resolve({
        ok: true,
        data: { data: { addPullRequestReview: { pullRequestReview: { id: reviewId } } } },
      });
    }
    if (msg.document === ADD_THREAD) {
      return Promise.resolve({
        ok: true,
        data: {
          data: {
            addPullRequestReviewThread: {
              thread: { id: 'PRRT_new', path: 'src/app.ts', comments: { nodes: [] } },
            },
          },
        },
      });
    }
    return Promise.resolve({ ok: true, data: { data: {} } });
  });
}

const REFUSED = {
  ok: false,
  error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
} as const;

/** Which documents were sent, in order. */
const documents = (): string[] =>
  requestMock.mock.calls.map((call) => call[0]?.document as string);

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

  /**
   * `viewerLatestReview` is "the latest review *given* from the viewer", and a
   * PENDING review has not been given to anyone — so it is not established that
   * it reports one. The worker asks a second way and puts the answer here, and
   * this is the field that decides.
   */
  it('resumes the review the worker looked up', () => {
    const node = pullRequestNode({ viewerPendingReview: { id: 'PRR_found' } });

    expect(initialPendingReview(node)).toMatchObject({
      kind: 'pending',
      reviewId: 'PRR_found',
      countIsComplete: false,
    });
  });

  it('prefers the looked-up review over a submitted latest one', () => {
    // Both fields populated, meaning different things: an approval from last
    // week, and a review open right now. Comments belong on the open one.
    const node = pullRequestNode({
      viewerLatestReview: { id: 'PRR_done', state: 'APPROVED' },
      viewerPendingReview: { id: 'PRR_open' },
    });

    expect(initialPendingReview(node)).toMatchObject({ reviewId: 'PRR_open' });
  });

  it('stays in Browse when the lookup found nothing', () => {
    const node = pullRequestNode({ viewerPendingReview: null });

    expect(initialPendingReview(node)).toEqual({ kind: 'browse' });
  });

  it('returns null rather than throwing on a node that is not there', () => {
    // `findOpenReview` reads this off a re-read of the pull request, on a path
    // that has already failed once. A throw here escapes `postThread`, which
    // leaves the composer stuck on "Posting…" with no way back.
    for (const junk of [undefined, null, 'nope', 42]) {
      expect(openReviewId(junk as never)).toBeNull();
    }
  });
});

describe('postThread', () => {
  it('publishes the comment instead of leaving a review open behind it', async () => {
    // `addPullRequestReviewThread` has no standalone mode. Passing
    // `pullRequestId` does not post a comment — it opens a PENDING review to
    // hold one, which is how a reviewer who never asked for a review ended up
    // with their comments queued invisibly inside one.
    answerByDocument();
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(documents()).toEqual([START_REVIEW, ADD_THREAD, SUBMIT_REVIEW]);
    });
    expect(variablesOf(1)['pullRequestReviewId']).toBe('PRR_transient');
    expect('pullRequestId' in variablesOf(1)).toBe(false);
    expect(variablesOf(2)).toEqual({
      pullRequestReviewId: 'PRR_transient',
      event: 'COMMENT',
    });
  });

  it('is still in Browse afterwards, with nothing queued', async () => {
    // The review it opened is an implementation detail of publishing. Leaving
    // the page in Pending would offer a submit for a review that is already in.
    answerByDocument();
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(documents()).toHaveLength(3);
    });
    expect(screen.getByTestId('mode').textContent).toBe('browse');
  });

  it('does not mark a published comment as unposted', async () => {
    answerByDocument();
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('threads').textContent).toContain('PRRT_new');
    });
    expect(screen.getByTestId('unpublished').textContent).toBe('');
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
    answerByDocument({
      [ADD_THREAD]: {
        ok: true,
        data: { data: { addPullRequestReviewThread: { thread: created } } },
      },
    });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() =>
      expect(screen.getByTestId('threads').textContent).toContain('PRRT_new'),
    );
  });

  it('names the pull request so the worker can drop its stale cache', async () => {
    answerByDocument();
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

/**
 * Publishing a single comment is three round trips, and each one can fail
 * differently. What must never happen is the reviewer believing a comment went
 * out when it did not, or believing it was lost when it exists.
 */
describe('a single comment that only partly went out', () => {
  it('reports a refused review without pretending the comment exists', async () => {
    answerByDocument({ [START_REVIEW]: REFUSED });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/);
    });
    // It looked for a review to join first — that is the recovery — and found
    // none, so the original refusal stands and no comment was written anywhere.
    expect(requestMock.mock.calls.some((call) => call[0]?.kind === 'get-pr')).toBe(true);
    expect(documents().filter(Boolean)).toEqual([START_REVIEW]);
    expect(screen.getByTestId('threads').textContent).not.toContain('PRRT_new');
  });

  it('surfaces the empty review it opened when the comment will not attach', async () => {
    // A review was created and the comment did not land in it. Staying in
    // Browse would leave that review open on GitHub with nothing on this page
    // admitting it exists — which is the original bug, one layer down.
    answerByDocument({ [ADD_THREAD]: REFUSED });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });
    expect(screen.getByTestId('failures').textContent).toMatch(/still open|submit|discard/i);
  });

  it('keeps a comment that was saved but not published, and says so', async () => {
    // The comment is real: it is queued on a review GitHub would not submit.
    // Discarding it here, or reopening the composer to be retyped, would either
    // lose the writing or duplicate it.
    answerByDocument({ [SUBMIT_REVIEW]: REFUSED });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });
    expect(screen.getByTestId('threads').textContent).toContain('PRRT_new');
    expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    expect(screen.getByTestId('failures').textContent).toMatch(/has not been posted/i);
  });
});

describe('comments queued on a review the reviewer opened', () => {
  const start = async () => {
    answerByDocument();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });
  };

  it('attaches to that review and does not publish it', async () => {
    await start();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(documents()).toEqual([START_REVIEW, ADD_THREAD]);
    });
    expect(variablesOf(1)['pullRequestReviewId']).toBe('PRR_transient');
  });

  it('marks the comment as not posted yet', async () => {
    await start();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    });
  });

  it('clears the marks once the review is submitted', async () => {
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'post' }));
    await waitFor(() => {
      expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    });

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('browse');
    });
    expect(screen.getByTestId('unpublished').textContent).toBe('');
  });

  it('keeps the marks when the submit fails', async () => {
    // The comments are still queued and still unpublished. Clearing the marks
    // here would say they went out.
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'post' }));
    await waitFor(() => {
      expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    });

    answerByDocument({ [SUBMIT_REVIEW]: REFUSED });
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/);
    });
    expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
  });
});

describe('replies', () => {
  it('joins the pending review rather than going out ahead of it', async () => {
    // Without `pullRequestReviewId` a reply publishes immediately while the
    // line comments beside it sit queued, so the reviewer submits their review
    // and finds their replies left some time earlier.
    answerByDocument();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });

    await userEvent.click(screen.getByRole('button', { name: 'reply' }));

    await waitFor(() => {
      expect(documents()).toEqual([START_REVIEW, ADD_REPLY]);
    });
    expect(variablesOf(1)['pullRequestReviewId']).toBe('PRR_transient');
  });

  it('posts immediately while browsing', async () => {
    answerByDocument();
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'reply' }));

    await waitFor(() => {
      expect(documents()).toEqual([ADD_REPLY]);
    });
    expect('pullRequestReviewId' in variablesOf(0)).toBe(false);
  });
});

/**
 * A review that is already open.
 *
 * GitHub allows one PENDING review per pull request and answers a second with
 * "User can only have one pending review per pull request". Both ways this page
 * writes a comment begin by opening one, so a reviewer holding an open review —
 * started in another tab, in GitHub's own UI, or left behind by an earlier
 * build — could do neither. Joining it is the only sensible move: it is their
 * review, and its comments are the ones they are adding to.
 *
 * The recovery does not read GitHub's wording. It asks whether a review is
 * open, and a review being open is the answer whatever the refusal said — so a
 * reworded message cannot strand the reviewer again.
 */
describe('joining a review GitHub already had open', () => {
  it('joins it instead of reporting the refusal', async () => {
    answerByDocument({ [START_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_already');
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'start' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });
    expect(screen.getByTestId('failures').textContent).toBe('');
  });

  it('does not claim to know what is already on it', async () => {
    // A joined review may hold comments made elsewhere. Reporting a complete
    // count of zero would invite submitting what looks like an empty review.
    answerByDocument({ [START_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_already');
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'start' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });
    expect(screen.getByTestId('complete').textContent).toBe('false');
  });

  it('reports the original refusal when no review is open after all', async () => {
    // Then the refusal was about something else, and inventing a review to
    // join would replace a real explanation with a wrong one.
    answerByDocument({ [START_REVIEW]: REFUSED }, 'PRR_transient', null);
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'start' }));

    await waitFor(() => {
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/);
    });
    expect(screen.getByTestId('mode').textContent).toBe('browse');
  });

  it('queues a comment onto it rather than posting it', async () => {
    // Publishing this one comment would mean submitting the reviewer's whole
    // review, including comments this page has never seen. That is not ours to
    // do, so the comment joins the review and the page says so.
    answerByDocument({ [START_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_already');
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('pending');
    });
    expect(documents()).not.toContain(SUBMIT_REVIEW);
    const added = requestMock.mock.calls.find((call) => call[0]?.document === ADD_THREAD);
    expect(added?.[0]?.variables?.['pullRequestReviewId']).toBe('PRR_already');
  });

  it('says the comment was added to the review rather than posted', async () => {
    answerByDocument({ [START_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_already');
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('failures').textContent).toMatch(
        /already had a review open/i,
      );
    });
  });

  it('marks that comment as not posted yet', async () => {
    answerByDocument({ [START_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_already');
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    });
  });
});
