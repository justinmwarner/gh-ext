/**
 * The card standing in for a comment GitHub has not answered for yet.
 *
 * Two things here are load-bearing. While the post is in flight the card is
 * the comment, so the words have to be on it. Once the post has failed the
 * card is the *only* copy of the comment anywhere — not on GitHub, and the
 * composer that held it has closed — so it has to say why, keep the words, and
 * ask before throwing them away.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { START_REVIEW } from '@/lib/github/mutations';
import { DraftStore } from '@/lib/review/drafts';
import { PostingCard } from './PostingCard';
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

const REFUSED = {
  ok: false,
  error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
} as const;

/**
 * Posts one comment through the real session, then draws whatever entry it
 * left behind.
 *
 * Through the session rather than against a hand-made entry, because the id
 * is the session's and the card looks it up — a fixture would be testing a
 * lookup that cannot fail.
 */
function Harness({ body = 'This allocates once per row.' }: { body?: string }) {
  const session = useReviewSession();
  const entry = session.posting[0];

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void session.postThread({
            path: 'src/app.ts',
            body,
            anchor: { subject: 'line', line: 12, side: 'RIGHT' },
          });
        }}
      >
        post
      </button>
      {entry !== undefined && <PostingCard postId={entry.id} />}
    </div>
  );
}

function mount(props: { body?: string } = {}) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode()}
      prRef={PR_REF}
      threads={[]}
      drafts={new DraftStore(memoryStore())}
    >
      <Harness {...props} />
    </ReviewSessionProvider>,
  );
}

const post = () => userEvent.click(screen.getByRole('button', { name: 'post' }));

/** Post once and let it be refused, leaving the failed card on screen. */
async function failing() {
  requestMock.mockResolvedValue(REFUSED);
  mount();
  await post();
  await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
}

describe('while the comment is in flight', () => {
  it('shows the words, so the reviewer is looking at their comment', async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    mount();

    await post();

    expect(screen.getByText('This allocates once per row.')).toBeDefined();
  });

  it('says where it goes, in the same words a real thread uses', async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    mount();

    await post();

    expect(screen.getByText(/line 12/i)).toBeDefined();
  });

  it('offers nothing to press, because there is nothing to decide yet', async () => {
    // Retry would post it twice and Discard would hide a comment GitHub may
    // be about to accept. Both are withheld until there is an answer.
    requestMock.mockReturnValue(new Promise(() => {}));
    mount();

    await post();

    expect(screen.queryByRole('button', { name: /post again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('once the post has failed', () => {
  it('raises an alert saying why, on the line the comment was written on', async () => {
    await failing();

    expect(screen.getByRole('alert').textContent).toMatch(/GitHub said no/);
  });

  it('still holds the words', async () => {
    await failing();

    expect(screen.getByText('This allocates once per row.')).toBeDefined();
  });

  it('sends it again when asked', async () => {
    await failing();
    const before = requestMock.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /post again/i }));

    // A whole second attempt, from the top: the refused one never got as far
    // as opening a review, so there is nothing to resume.
    const sent = requestMock.mock.calls
      .slice(before)
      .map((call) => call[0]?.document as string | undefined);
    expect(sent).toContain(START_REVIEW);
  });

  it('asks before throwing the comment away', async () => {
    // The only control in the application that destroys the reviewer's own
    // writing, and nothing keeps a copy once it has.
    await failing();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.getByRole('group', { name: /discard/i })).toBeDefined();
    expect(screen.getByText('This allocates once per row.')).toBeDefined();
  });

  it('keeps it when the confirmation is declined', async () => {
    await failing();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(screen.getByRole('button', { name: /keep it/i }));

    expect(screen.getByText('This allocates once per row.')).toBeDefined();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('drops the card once the confirmation is given', async () => {
    await failing();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(screen.getByRole('button', { name: /discard comment/i }));

    expect(screen.queryByText('This allocates once per row.')).toBeNull();
  });
});

describe('a suggestion written into a comment', () => {
  it('reads as the proposed replacement before it is posted, not as a fence', async () => {
    // It reads that way after it lands, and the card is meant to be
    // indistinguishable from the thread that replaces it.
    requestMock.mockReturnValue(new Promise(() => {}));
    mount({ body: 'Try this:\n\n```suggestion\nconst a = 1;\n```' });

    await post();

    expect(screen.getByText(/suggested change/i)).toBeDefined();
    expect(screen.getByText('const a = 1;')).toBeDefined();
  });
});
