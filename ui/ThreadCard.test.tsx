/**
 * One review thread, drawn.
 *
 * The things asserted here are the ones a reviewer would be misled by if they
 * were wrong: the range on a multi-line comment, where an outdated one used to
 * be, whether a control that cannot work looks like it can, and — most of all —
 * that a resolve which failed does not go on looking as if it stuck.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNRESOLVE_THREAD } from '@/lib/github/mutations';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { ThreadCard } from './ThreadCard';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { pullRequestNode, reviewComment, reviewThread } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;

function mount(
  thread: ReviewThread,
  node: Parameters<typeof pullRequestNode>[0] = {},
) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode(node)}
      prRef={PR_REF}
      threads={[thread]}
      drafts={new DraftStore(memoryStore())}
    >
      <ThreadCard threadId={thread.id} />
    </ReviewSessionProvider>,
  );
}

/** A promise this test decides when to settle. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

const FAILURE = {
  ok: false,
  error: { kind: 'unknown', message: 'the network went away', resetAt: null },
} as const;

describe('ThreadCard', () => {
  it('shows the author, the body and when it was written', () => {
    mount(
      reviewThread({
        path: 'src/app.ts',
        comments: {
          totalCount: 1,
          nodes: [
            reviewComment({
              author: { login: 'dana', avatarUrl: '' },
              body: 'This allocates on every call.',
              createdAt: '2026-08-30T09:15:00Z',
            }),
          ],
        },
      }),
    );

    expect(screen.getByText('dana')).toBeDefined();
    expect(screen.getByText('This allocates on every call.')).toBeDefined();
    // The rendered text is the reader's locale's business; the machine-readable
    // instant is this component's.
    expect(screen.getByRole('time').getAttribute('datetime')).toBe(
      '2026-08-30T09:15:00Z',
    );
  });

  it('names the single line a thread sits on', () => {
    mount(reviewThread({ path: 'src/app.ts', line: 12 }));

    expect(screen.getByText('Line 12')).toBeDefined();
  });

  it('shows the range of a multi-line thread', () => {
    // Pierre anchors this thread to line 9 because it carries one line number
    // per annotation. Without the range spelled out, a comment on five lines is
    // indistinguishable from a comment on the last of them.
    mount(
      reviewThread({
        path: 'src/app.ts',
        line: 9,
        startLine: 5,
        startDiffSide: 'RIGHT',
      }),
    );

    expect(screen.getByText('Lines 5-9')).toBeDefined();
  });

  it('says where an outdated thread used to be', () => {
    // `line` is null on an outdated thread, but `originalLine` is not.
    mount(
      reviewThread({
        path: 'src/app.ts',
        line: null,
        startLine: null,
        originalLine: 194,
        isOutdated: true,
      }),
    );

    expect(screen.getByText('was on line 194')).toBeDefined();
    expect(screen.getByText(/outdated/i)).toBeDefined();
  });

  it('collapses a resolved thread to one line', () => {
    const { container } = mount(
      reviewThread({ path: 'src/app.ts', line: 12, isResolved: true }),
    );

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toMatch(/resolved/i);
  });

  it('disables the reply box when the viewer may not reply', () => {
    mount(reviewThread({ path: 'src/app.ts', viewerCanReply: false }));

    const box = screen.getByRole('textbox', { name: /reply/i }) as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Reply' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('disables resolving when the viewer may not resolve', () => {
    // Disabled rather than absent-and-failing: a control that posts a mutation
    // GitHub will refuse is a worse answer than one that says it cannot.
    mount(reviewThread({ path: 'src/app.ts', viewerCanResolve: false }));

    expect(
      (
        screen.getByRole('button', {
          name: 'Resolve conversation',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('disables reopening when the viewer may not unresolve', () => {
    mount(
      reviewThread({
        path: 'src/app.ts',
        isResolved: true,
        viewerCanUnresolve: false,
      }),
    );

    expect(
      (
        screen.getByRole('button', {
          name: 'Unresolve conversation',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('resolves optimistically and keeps it when the mutation succeeds', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          resolveReviewThread: {
            thread: {
              id: 'PRRT_src/app.ts:2',
              isResolved: true,
              viewerCanResolve: false,
              viewerCanUnresolve: true,
            },
          },
        },
      },
    });
    mount(reviewThread({ path: 'src/app.ts' }));

    await userEvent.click(screen.getByRole('button', { name: 'Resolve conversation' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unresolve conversation' })).toBeDefined(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rolls a failed resolve back and says that it failed', async () => {
    // The worst outcome in this file. A resolve that reverts without a word
    // leaves the reviewer believing the thread is handled.
    const gate = deferred<unknown>();
    requestMock.mockReturnValue(gate.promise);
    mount(reviewThread({ path: 'src/app.ts' }));

    await userEvent.click(screen.getByRole('button', { name: 'Resolve conversation' }));

    // Optimistic: it reads as resolved while the mutation is in flight.
    expect(screen.getByRole('button', { name: 'Unresolve conversation' })).toBeDefined();

    gate.settle(FAILURE);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resolve conversation' })).toBeDefined(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/the network went away/);
  });

  it('reopens a resolved thread through the unresolve mutation', async () => {
    // A different document from resolving, chosen by which way the thread is
    // being moved. Sending the wrong one is an error GitHub reports as a 200.
    requestMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          unresolveReviewThread: {
            thread: { id: 'PRRT_src/app.ts:2', isResolved: false },
          },
        },
      },
    });
    mount(reviewThread({ path: 'src/app.ts', isResolved: true }));

    await userEvent.click(
      screen.getByRole('button', { name: 'Unresolve conversation' }),
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock.mock.calls[0]?.[0]?.document).toBe(UNRESOLVE_THREAD);
    expect(
      screen.getByRole('button', { name: 'Resolve conversation' }),
    ).toBeDefined();
  });

  it('posts a reply and shows it once GitHub has it', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          addPullRequestReviewThreadReply: {
            comment: {
              id: 'PRRC_2',
              author: { login: 'kim', avatarUrl: '' },
              body: 'Fixed in the next commit.',
              createdAt: '2026-08-31T10:00:00Z',
              url: 'https://github.com/acme/widgets/pull/42#discussion_r2',
            },
          },
        },
      },
    });
    mount(reviewThread({ path: 'src/app.ts' }));

    await userEvent.type(
      screen.getByRole('textbox', { name: /reply/i }),
      'Fixed in the next commit.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() =>
      expect(screen.getByText('Fixed in the next commit.')).toBeDefined(),
    );
    expect(screen.getByText('kim')).toBeDefined();
  });

  it('keeps what was typed when the reply fails', async () => {
    requestMock.mockResolvedValue(FAILURE);
    mount(reviewThread({ path: 'src/app.ts' }));

    const box = screen.getByRole('textbox', { name: /reply/i }) as HTMLTextAreaElement;
    await userEvent.type(box, 'Fixed in the next commit.');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(box.value).toBe('Fixed in the next commit.');
  });

  it('shows the proposed result of a suggestion, and sends applying it to GitHub', () => {
    // Applying a suggestion has no public endpoint, so the affordance opens the
    // thread where it can be applied rather than pretending to do it here.
    mount(
      reviewThread({
        path: 'src/app.ts',
        comments: {
          totalCount: 1,
          nodes: [
            reviewComment({
              body: 'Try:\n\n```suggestion\nconst a = 1;\n```',
              url: 'https://github.com/acme/widgets/pull/42#discussion_r1',
            }),
          ],
        },
      }),
    );

    expect(screen.getByText('const a = 1;')).toBeDefined();
    const apply = screen.getByRole('link', { name: /apply/i });
    expect(apply.getAttribute('href')).toBe(
      'https://github.com/acme/widgets/pull/42#discussion_r1',
    );
  });

  it('says when a thread has more comments than the payload carried', () => {
    mount(
      reviewThread({
        path: 'src/app.ts',
        comments: { totalCount: 60, nodes: [reviewComment()] },
      }),
    );

    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/59/);
    expect(within(note).getByRole('link')).toBeDefined();
  });
});

/**
 * A comment nobody else can see yet.
 *
 * A comment queued on a pending review is invisible to everyone but its author
 * until the review is submitted. That is a fine thing to want and a terrible
 * thing to not know — the reviewer who wrote it has no reason to think it did
 * not go out, and the thread renders identically either way.
 */
describe('a thread holding an unposted comment', () => {
  const PENDING_NODE = {
    viewerLatestReview: { id: 'PRR_pending', state: 'PENDING' },
  };

  const queueAReply = async () => {
    requestMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          addPullRequestReviewThreadReply: {
            comment: { id: 'PRRC_q', body: 'not yet', author: { login: 'me' } },
          },
        },
      },
    });
    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), 'not yet');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
  };

  it('says so, in words, not just a colour', async () => {
    mount(reviewThread({ path: 'src/app.ts' }), PENDING_NODE);

    await queueAReply();

    await waitFor(() => {
      expect(screen.getByText(/not posted yet/i)).toBeTruthy();
    });
  });

  it('marks the card itself so it is findable down a long diff', async () => {
    const { container } = mount(reviewThread({ path: 'src/app.ts' }), PENDING_NODE);

    await queueAReply();

    await waitFor(() => {
      expect(container.querySelector('.thread-unpublished')).not.toBeNull();
    });
  });

  it('explains what unposted means rather than leaving a bare badge', async () => {
    mount(reviewThread({ path: 'src/app.ts' }), PENDING_NODE);

    await queueAReply();

    const badge = await screen.findByText(/not posted yet/i);
    expect(badge.getAttribute('title')).toMatch(/submit/i);
  });

  it('says nothing on a thread that is already public', () => {
    // The overwhelming majority. A badge here would be noise, and worse, would
    // make the real one mean nothing.
    const { container } = mount(reviewThread({ path: 'src/app.ts' }));

    expect(screen.queryByText(/not posted yet/i)).toBeNull();
    expect(container.querySelector('.thread-unpublished')).toBeNull();
  });
});
