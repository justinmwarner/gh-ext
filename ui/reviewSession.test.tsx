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
  DELETE_COMMENT,
  MARK_VIEWED,
  RESOLVE_THREAD,
  START_REVIEW,
  SUBMIT_REVIEW,
  THREAD_PERMISSIONS,
  UPDATE_COMMENT,
} from '@/lib/github/mutations';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { pullRequestNode, reviewComment, reviewThread } from './prPayload.fixture';
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
      <button
        type="button"
        onClick={() => {
          void session.setViewed('src/app.ts', true, 'UNVIEWED');
        }}
      >
        view
      </button>
      <button
        type="button"
        onClick={() => {
          void session.editComment('PRRC_1', 'This allocates once.');
        }}
      >
        edit
      </button>
      <button
        type="button"
        onClick={() => {
          void session.deleteComment('PRRC_1');
        }}
      >
        delete
      </button>
      {/* The comment `queueThread` puts on a new thread, and the one `reply`
          adds to an existing one — the two ways a comment gets queued on a
          pending review, and the two the delete has to account for. */}
      <button
        type="button"
        onClick={() => {
          void session.deleteComment('PRRC_new');
        }}
      >
        delete new
      </button>
      <button
        type="button"
        onClick={() => {
          void session.deleteComment('PRRC_reply');
        }}
      >
        delete reply
      </button>
      <p data-testid="mode">{session.pending.kind}</p>
      <p data-testid="bodies">
        {session.threads
          .flatMap((t) => t.comments.nodes.map((c) => `${c.id}=${c.body}`))
          .join(' | ')}
      </p>
      <p data-testid="counts">
        {session.threads.map((t) => `${t.id}:${t.comments.totalCount}`).join(',')}
      </p>
      <p data-testid="queued">
        {session.pending.kind === 'pending' ? String(session.pending.commentCount) : ''}
      </p>
      <p data-testid="resolving">{[...session.resolveInFlight].join(',')}</p>
      <p data-testid="rejected">{String(session.tokenRejected)}</p>
      <p data-testid="complete">
        {session.pending.kind === 'pending' ? String(session.pending.countIsComplete) : ''}
      </p>
      <p data-testid="threads">{session.threads.map((t) => t.id).join(',')}</p>
      <p data-testid="canresolve">
        {session.threads.map((t) => `${t.id}=${String(t.viewerCanResolve)}`).join(',')}
      </p>
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

/** A promise this test decides when to settle, for asserting on mid-flight. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Which documents were sent, in order. */
const documents = (): string[] =>
  requestMock.mock.calls.map((call) => call[0]?.document as string);

function mount(
  node: Parameters<typeof pullRequestNode>[0] = {},
  threads: readonly ReviewThread[] = [reviewThread({ path: 'src/app.ts', line: 2 })],
) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode(node)}
      prRef={PR_REF}
      threads={threads}
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
      // Four, not three. The fourth asks what may now be done to the thread
      // the third one published — see `THREAD_PERMISSIONS`.
      expect(documents()).toEqual([
        START_REVIEW,
        ADD_THREAD,
        SUBMIT_REVIEW,
        THREAD_PERMISSIONS,
      ]);
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
      expect(documents()).toHaveLength(4);
    });
    expect(screen.getByTestId('mode').textContent).toBe('browse');
  });

  it('asks again what may be done to the thread it just published', async () => {
    // The bug: `addPullRequestReviewThread` describes the thread as it is at
    // that moment — sitting in a review nobody has submitted — and this page
    // kept that answer after submitting the review. The reviewer posted a
    // comment and found Resolve greyed out on a conversation plainly there,
    // until they reloaded.
    answerByDocument({
      [THREAD_PERMISSIONS]: {
        ok: true,
        data: {
          data: {
            nodes: [
              {
                id: 'PRRT_new',
                isResolved: false,
                viewerCanReply: true,
                viewerCanResolve: true,
                viewerCanUnresolve: false,
              },
            ],
          },
        },
      },
    });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    // The thread arrives saying no, because that is what GitHub said about it
    // while it was unpublished, and ends up saying yes.
    await waitFor(() => {
      expect(screen.getByTestId('canresolve').textContent).toContain('PRRT_new=true');
    });
    expect(variablesOf(3)).toEqual({ ids: ['PRRT_new'] });
  });

  it('takes GitHub’s answer rather than assuming the submit earned it', async () => {
    // Submitting a review does not imply being allowed to resolve: read access
    // is enough to review a repository and not enough to resolve on it. An
    // optimistic `true` here would hand that reviewer a button that only 403s.
    answerByDocument({
      [THREAD_PERMISSIONS]: {
        ok: true,
        data: { data: { nodes: [{ id: 'PRRT_new', viewerCanResolve: false }] } },
      },
    });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('threads').textContent).toContain('PRRT_new');
    });
    expect(screen.getByTestId('canresolve').textContent).toContain('PRRT_new=false');
  });

  it('says nothing when the re-read fails, because nothing was lost', async () => {
    // The comment is posted and the review is in. An error about a request the
    // reviewer never made would read as the submit having gone wrong.
    answerByDocument({ [THREAD_PERMISSIONS]: REFUSED });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'post' }));

    await waitFor(() => {
      expect(screen.getByTestId('threads').textContent).toContain('PRRT_new');
    });
    expect(screen.getByTestId('failures').textContent).toBe('');
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

  it('re-reads what may be done to them, now that they are real', async () => {
    // Same bug as the single-comment path, arrived at the long way round: the
    // threads were described while queued on a review nobody could see, and
    // submitting makes them ordinary threads without touching anything here.
    // Without this the reviewer submits a review and cannot resolve any of the
    // conversations in it until they reload.
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'post' }));
    await waitFor(() => {
      expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    });

    answerByDocument({
      [THREAD_PERMISSIONS]: {
        ok: true,
        data: { data: { nodes: [{ id: 'PRRT_new', viewerCanResolve: true }] } },
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(screen.getByTestId('canresolve').textContent).toContain('PRRT_new=true');
    });
    // The ids come from the marks, which the submit clears — so they have to be
    // taken before that happens.
    expect(variablesOf(documents().indexOf(THREAD_PERMISSIONS))).toEqual({
      ids: ['PRRT_new'],
    });
  });

  it('asks nothing when the review held no threads of its own', async () => {
    // A review submitted with only a summary, or one resumed from GitHub whose
    // comments this page never saw. There are no ids to ask about, and a query
    // with an empty list is a round trip for nothing.
    await start();

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('browse');
    });
    expect(documents()).not.toContain(THREAD_PERMISSIONS);
  });

  it('keeps the marks when the submit fails', async () => {
    // The comments are still queued and still unpublished. Clearing the marks
    // here would say they went out.
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'post' }));
    await waitFor(() => {
      expect(screen.getByTestId('unpublished').textContent).toContain('PRRT_new');
    });

    // The re-read has to agree the review is still there, because that is what
    // this scenario is: an ordinary refusal, not a review that has gone.
    answerByDocument({ [SUBMIT_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_transient');
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

describe('a pending review that went out somewhere else', () => {
  /**
   * The reviewer queues comments here, then submits that same review from
   * GitHub's own tab. Everything this page believes about the review is now
   * one version behind, and the id it holds names a review that is no longer
   * PENDING — so GitHub refuses every further use of it.
   */
  const gone = {
    ok: false,
    error: {
      kind: 'unknown',
      message: 'Can not submit a review that is not pending.',
      resetAt: null,
    },
  } as const;

  it('returns to browsing rather than holding a review GitHub has closed', async () => {
    // The re-read finds nothing open, which is the difference between "the
    // network blinked" and "this review is gone".
    answerByDocument({ [SUBMIT_REVIEW]: gone }, 'PRR_transient', null);
    mount({ viewerLatestReview: { id: 'PRR_open', state: 'PENDING' } });
    expect(screen.getByTestId('mode').textContent).toBe('pending');

    await userEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('browse'));
  });

  it('says the review went out, rather than that it is still pending', async () => {
    answerByDocument({ [SUBMIT_REVIEW]: gone }, 'PRR_transient', null);
    mount({ viewerLatestReview: { id: 'PRR_open', state: 'PENDING' } });

    await userEvent.click(screen.getByText('submit'));

    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).not.toMatch(/still pending/i),
    );
  });

  it('stops marking queued threads as unposted once the review has gone', async () => {
    answerByDocument({ [SUBMIT_REVIEW]: gone }, 'PRR_transient', null);
    mount({ viewerLatestReview: { id: 'PRR_open', state: 'PENDING' } });

    await userEvent.click(screen.getByText('post'));
    await waitFor(() => expect(screen.getByTestId('unpublished').textContent).not.toBe(''));

    await userEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(screen.getByTestId('unpublished').textContent).toBe(''));
  });

  it('keeps the review when the re-read could not be made at all', async () => {
    // The dangerous direction. A network blink fails the submit and then fails
    // the re-read too; reading that silence as "gone" would tell the reviewer
    // their queued comments went out while they are still sitting unsent.
    requestMock.mockImplementation((msg: { kind?: string }) =>
      Promise.resolve(msg.kind === 'get-pr' ? REFUSED : gone),
    );
    mount({ viewerLatestReview: { id: 'PRR_open', state: 'PENDING' } });

    await userEvent.click(screen.getByText('submit'));

    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).toMatch(/still pending/i),
    );
    expect(screen.getByTestId('mode').textContent).toBe('pending');
  });

  it('keeps the review when the re-read still finds it open', async () => {
    // A refusal that is not about the review having gone — a network blink, a
    // rate limit — must not throw away comments that are still queued.
    answerByDocument({ [SUBMIT_REVIEW]: REFUSED }, 'PRR_transient', 'PRR_open');
    mount({ viewerLatestReview: { id: 'PRR_open', state: 'PENDING' } });

    await userEvent.click(screen.getByText('submit'));

    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).toMatch(/still pending/i),
    );
    expect(screen.getByTestId('mode').textContent).toBe('pending');
  });
});

describe('two mutations racing on the same thing', () => {
  /**
   * A held key repeats, and a double-click is one event too many. Both entry
   * points for these two toggles are optimistic, so the second call reads the
   * *optimistic* value and sends the opposite mutation — and the rollback then
   * restores a value that was never committed anywhere.
   *
   * The checkbox already refuses this by disabling itself. Nothing else did.
   */
  const never = () => new Promise<never>(() => {});

  it('refuses a second resolve while the first is still in flight', async () => {
    requestMock.mockImplementation((msg: { document?: string }) =>
      msg.document === RESOLVE_THREAD ? never() : Promise.resolve({ ok: true, data: {} }),
    );
    mount();

    await userEvent.click(screen.getByText('resolve'));
    await userEvent.click(screen.getByText('resolve'));

    expect(
      requestMock.mock.calls.filter((call) => call[0]?.document === RESOLVE_THREAD),
    ).toHaveLength(1);
  });

  it('reports which threads are mid-resolve, so the control can refuse too', async () => {
    requestMock.mockImplementation((msg: { document?: string }) =>
      msg.document === RESOLVE_THREAD ? never() : Promise.resolve({ ok: true, data: {} }),
    );
    mount();

    await userEvent.click(screen.getByText('resolve'));

    await waitFor(() =>
      expect(screen.getByTestId('resolving').textContent).toContain('PRRT_src/app.ts:2'),
    );
  });

  it('refuses a second viewed toggle while the first is still in flight', async () => {
    requestMock.mockImplementation((msg: { document?: string }) =>
      msg.document === MARK_VIEWED ? never() : Promise.resolve({ ok: true, data: {} }),
    );
    mount();

    await userEvent.click(screen.getByText('view'));
    await userEvent.click(screen.getByText('view'));

    expect(requestMock.mock.calls.filter((call) => call[0]?.document !== undefined)).toHaveLength(
      1,
    );
  });
});

describe('a token that stops working while the page is open', () => {
  /**
   * Fine-grained tokens expire, and the options page recommends the shortest
   * expiry you can live with. When one lapses mid-review every mutation starts
   * failing with the same sentence in whichever control was pressed — and
   * nothing on the page says the remedy is two menus away, or that the page
   * would tell them if they reloaded.
   */
  const rejected = {
    ok: false,
    error: { kind: 'auth', message: 'GitHub rejected the token', resetAt: null },
  } as const;

  it('reports the token as rejected, not just this one control as broken', async () => {
    requestMock.mockResolvedValue(rejected);
    mount();

    await userEvent.click(screen.getByText('resolve'));

    await waitFor(() => expect(screen.getByTestId('rejected').textContent).toBe('true'));
  });

  it('says nothing of the sort for an ordinary refusal', async () => {
    // A rate limit or a permission problem on one thread is not a reason to
    // tell someone their token has stopped working.
    requestMock.mockResolvedValue(REFUSED);
    mount();

    await userEvent.click(screen.getByText('resolve'));

    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/),
    );
    expect(screen.getByTestId('rejected').textContent).toBe('false');
  });
});

describe('starting a review twice', () => {
  /**
   * The button disables on `pending`, which only flips after the mutation
   * returns, and the session's own guard reads the same state — so a
   * double-click issues two `addPullRequestReview` calls. The loser costs a
   * full re-read of the pull request to learn what the winner already knew,
   * and if GitHub's one-pending-review check is not transactional both can
   * succeed, orphaning a review this page has no id for.
   */
  it('sends one request however fast the button is pressed', async () => {
    const never = () => new Promise<never>(() => {});
    requestMock.mockImplementation((msg: { document?: string }) =>
      msg.document === START_REVIEW ? never() : Promise.resolve({ ok: true, data: {} }),
    );
    mount();

    await userEvent.click(screen.getByText('start'));
    await userEvent.click(screen.getByText('start'));

    expect(
      requestMock.mock.calls.filter((call) => call[0]?.document === START_REVIEW),
    ).toHaveLength(1);
  });

  it('lets a second review be started once the first attempt has finished', async () => {
    // The guard is for concurrency, not a latch. A refused open must not stop
    // the reviewer trying again.
    answerByDocument({ [START_REVIEW]: REFUSED });
    mount();

    await userEvent.click(screen.getByText('start'));
    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/),
    );
    requestMock.mockClear();

    await userEvent.click(screen.getByText('start'));

    await waitFor(() =>
      expect(
        requestMock.mock.calls.filter((call) => call[0]?.document === START_REVIEW),
      ).toHaveLength(1),
    );
  });
});

/**
 * Fixing and unfixing what has already been written.
 *
 * The failure worth guarding against here is not a wrong body on screen — it is
 * a body wrong on GitHub with the page showing the corrected one, or a comment
 * gone from the page and still sitting on the pull request. Both read as "it
 * worked", and the reviewer only finds out from someone else.
 */
describe('editing a comment', () => {
  const EDITED = {
    ok: true,
    data: {
      data: {
        updatePullRequestReviewComment: {
          pullRequestReviewComment: {
            id: 'PRRC_1',
            body: 'This allocates once.',
            author: { login: 'dana', avatarUrl: '' },
            createdAt: '2026-08-30T09:15:00Z',
            url: 'https://github.com/acme/widgets/pull/42#discussion_r1',
            viewerCanUpdate: true,
            viewerCanDelete: true,
          },
        },
      },
    },
  };

  it('names the comment by its own id and sends the finished body', async () => {
    // Not the thread id, and not a delta. `updatePullRequestReviewComment`
    // takes `pullRequestReviewCommentId` and a `String!` that replaces the
    // body outright.
    requestMock.mockResolvedValue(EDITED);
    mount();

    await userEvent.click(screen.getByText('edit'));

    await waitFor(() => expect(documents()).toEqual([UPDATE_COMMENT]));
    expect(variablesOf(0)).toEqual({
      pullRequestReviewCommentId: 'PRRC_1',
      body: 'This allocates once.',
    });
  });

  it('shows the new words only once GitHub has them', async () => {
    const gate = deferred<unknown>();
    requestMock.mockReturnValue(gate.promise);
    mount();

    await userEvent.click(screen.getByText('edit'));

    // Deliberately not optimistic. A body shown as saved and then reverted is
    // the reviewer believing their correction went out when it did not.
    expect(screen.getByTestId('bodies').textContent).toContain(
      'This allocates on every call.',
    );

    gate.settle(EDITED);

    await waitFor(() =>
      expect(screen.getByTestId('bodies').textContent).toBe(
        'PRRC_1=This allocates once.',
      ),
    );
  });

  it('keeps the words that are actually on GitHub when the edit is refused', async () => {
    requestMock.mockResolvedValue(REFUSED);
    mount();

    await userEvent.click(screen.getByText('edit'));

    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/),
    );
    expect(screen.getByTestId('bodies').textContent).toBe(
      'PRRC_1=This allocates on every call.',
    );
  });

  it('edits a comment queued on a pending review without naming the review', async () => {
    // The case that hurts most, and the one a review id would break: the
    // comment already knows which review holds it, and passing one is only a
    // way to pass the wrong one.
    requestMock.mockResolvedValue(EDITED);
    mount({ viewerLatestReview: { id: 'PRR_pending', state: 'PENDING' } });

    await userEvent.click(screen.getByText('edit'));

    await waitFor(() => expect(documents()).toEqual([UPDATE_COMMENT]));
    expect('pullRequestReviewId' in variablesOf(0)).toBe(false);
    expect(screen.getByTestId('mode').textContent).toBe('pending');
  });
});

describe('deleting a comment', () => {
  const DELETED = {
    ok: true,
    data: {
      data: {
        deletePullRequestReviewComment: {
          pullRequestReview: { id: 'PRR_1', state: 'PENDING' },
        },
      },
    },
  };

  /** Two comments on one thread, so deleting one is not deleting the thread. */
  const twoComments = [
    reviewThread({
      path: 'src/app.ts',
      line: 2,
      comments: {
        totalCount: 2,
        nodes: [
          reviewComment({ id: 'PRRC_1', body: 'This allocates on every call.' }),
          reviewComment({ id: 'PRRC_2', body: 'Fixed in the next commit.' }),
        ],
      },
    }),
  ];

  it('names the comment by `id`, which is not what the edit beside it takes', async () => {
    requestMock.mockResolvedValue(DELETED);
    mount({}, twoComments);

    await userEvent.click(screen.getByText('delete'));

    await waitFor(() => expect(documents()).toEqual([DELETE_COMMENT]));
    expect(variablesOf(0)).toEqual({ id: 'PRRC_1' });
  });

  it('takes the comment off the thread and off the count', async () => {
    requestMock.mockResolvedValue(DELETED);
    mount({}, twoComments);

    await userEvent.click(screen.getByText('delete'));

    await waitFor(() =>
      expect(screen.getByTestId('bodies').textContent).toBe(
        'PRRC_2=Fixed in the next commit.',
      ),
    );
    // Left alone, `totalCount` would go on claiming a comment that is gone —
    // and the thread would offer to read it on GitHub, where it is not either.
    expect(screen.getByTestId('counts').textContent).toBe('PRRT_src/app.ts:2:1');
  });

  it('drops the whole thread when its last comment is deleted', async () => {
    // GitHub deletes a review thread along with its final comment. An empty
    // thread left on screen is an annotation with nothing in it, and every
    // control on it fails.
    requestMock.mockResolvedValue(DELETED);
    mount();

    await userEvent.click(screen.getByText('delete'));

    await waitFor(() => expect(screen.getByTestId('threads').textContent).toBe(''));
  });

  it('leaves the comment exactly where it was when the delete is refused', async () => {
    requestMock.mockResolvedValue(REFUSED);
    mount({}, twoComments);

    await userEvent.click(screen.getByText('delete'));

    await waitFor(() =>
      expect(screen.getByTestId('failures').textContent).toMatch(/GitHub said no/),
    );
    expect(screen.getByTestId('bodies').textContent).toContain('PRRC_1=');
    expect(screen.getByTestId('counts').textContent).toBe('PRRT_src/app.ts:2:2');
  });

  /** A new thread carrying the comment that was queued on it. */
  const QUEUED_THREAD = {
    ok: true,
    data: {
      data: {
        addPullRequestReviewThread: {
          thread: {
            id: 'PRRT_new',
            path: 'src/app.ts',
            comments: {
              totalCount: 1,
              nodes: [{ id: 'PRRC_new', body: 'a comment', author: { login: 'me' } }],
            },
          },
        },
      },
    },
  };

  /** A reply queued onto the thread that was already there. */
  const QUEUED_REPLY = {
    ok: true,
    data: {
      data: {
        addPullRequestReviewThreadReply: {
          comment: { id: 'PRRC_reply', body: 'a reply', author: { login: 'me' } },
        },
      },
    },
  };

  it('uncounts a deleted comment from the pending review', async () => {
    // Otherwise the footer goes on offering to submit "1 comment not posted
    // yet" over a review that now holds nothing.
    answerByDocument({
      [ADD_THREAD]: QUEUED_THREAD,
      [DELETE_COMMENT]: DELETED,
    });
    mount();

    await userEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('pending'));
    await userEvent.click(screen.getByText('post'));
    await waitFor(() => expect(screen.getByTestId('queued').textContent).toBe('1'));

    await userEvent.click(screen.getByText('delete new'));

    await waitFor(() => expect(screen.getByTestId('queued').textContent).toBe('0'));
  });

  it('leaves the count alone when the comment deleted was a published one', async () => {
    // The count is of comments queued on the pending review. A published
    // comment on some other thread was never one of them, and subtracting it
    // would understate what is still waiting to go out.
    answerByDocument({
      [ADD_THREAD]: QUEUED_THREAD,
      [DELETE_COMMENT]: DELETED,
    });
    mount();

    await userEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('pending'));
    await userEvent.click(screen.getByText('post'));
    await waitFor(() => expect(screen.getByTestId('queued').textContent).toBe('1'));

    await userEvent.click(screen.getByText('delete'));

    await waitFor(() => expect(screen.getByTestId('threads').textContent).toBe('PRRT_new'));
    expect(screen.getByTestId('queued').textContent).toBe('1');
  });

  it('does not uncount a comment that was published by a submit in between', async () => {
    // The queued-comment record has to be forgotten when the review it
    // described goes out. Kept, deleting one of those now-public comments
    // would subtract from whatever review the reviewer opens next — a footer
    // counting down while nothing has been unqueued.
    //
    // A counter rather than a fixed payload, because the whole point is that
    // the two reviews hold *different* comments.
    let threads = 0;
    answerByDocument({ [DELETE_COMMENT]: DELETED });
    const byDocument = requestMock.getMockImplementation();
    requestMock.mockImplementation((msg: { kind?: string; document: string }) => {
      if (msg.document !== ADD_THREAD) return byDocument?.(msg);
      threads += 1;
      return Promise.resolve({
        ok: true,
        data: {
          data: {
            addPullRequestReviewThread: {
              thread: {
                id: `PRRT_${threads}`,
                path: 'src/app.ts',
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      id: threads === 1 ? 'PRRC_new' : 'PRRC_later',
                      body: 'a comment',
                      author: { login: 'me' },
                    },
                  ],
                },
              },
            },
          },
        },
      });
    });
    mount();

    await userEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('pending'));
    await userEvent.click(screen.getByText('post'));
    await waitFor(() => expect(screen.getByTestId('queued').textContent).toBe('1'));
    await userEvent.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('browse'));

    // A second review, holding a different comment. PRRC_new is on the first
    // one, which is now on the pull request for everyone to read.
    await userEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('pending'));
    await userEvent.click(screen.getByText('post'));
    await waitFor(() => expect(screen.getByTestId('queued').textContent).toBe('1'));

    await userEvent.click(screen.getByText('delete new'));

    await waitFor(() =>
      expect(requestMock.mock.calls.at(-1)?.[0]?.document).toBe(DELETE_COMMENT),
    );
    expect(screen.getByTestId('queued').textContent).toBe('1');
  });

  it('stops saying "not posted yet" once the queued reply is gone', async () => {
    // The badge is per thread and the queue is per comment. This thread keeps
    // its published comment, so it stays on screen — and going on calling it
    // unposted would be the badge meaning nothing.
    answerByDocument({
      [ADD_REPLY]: QUEUED_REPLY,
      [DELETE_COMMENT]: DELETED,
    });
    mount();

    await userEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('pending'));
    await userEvent.click(screen.getByText('reply'));
    await waitFor(() =>
      expect(screen.getByTestId('unpublished').textContent).toBe('PRRT_src/app.ts:2'),
    );

    await userEvent.click(screen.getByText('delete reply'));

    await waitFor(() => expect(screen.getByTestId('unpublished').textContent).toBe(''));
    expect(screen.getByTestId('threads').textContent).toBe('PRRT_src/app.ts:2');
  });
});
