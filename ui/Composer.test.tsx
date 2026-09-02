/**
 * The comment composer.
 *
 * Three things here are not cosmetic: a range GitHub cannot express has to be
 * explained rather than refused, a draft has to survive a failed post, and a
 * suggestion has to be seeded from the real source lines — an empty suggestion
 * block proposes deleting the lines it was supposed to replace.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore, type KeyValueStore, draftKey } from '@/lib/review/drafts';
import type { CommentAnchor } from '@/lib/review/selection';
import { Composer, type ComposerProps } from './Composer';
import { START_REVIEW } from '@/lib/github/mutations';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { pullRequestNode } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;
const PR_ID = 'PR_kwDOABCD';

const SINGLE: CommentAnchor = { line: 2, side: 'RIGHT' };

const KEY = draftKey({ prId: PR_ID, path: 'src/app.ts', line: 2, side: 'RIGHT' });

const FAILURE = {
  ok: false,
  error: { kind: 'unknown', message: 'the network went away', resetAt: null },
} as const;

const OK = { ok: true, data: { data: {} } } as const;

/**
 * Answer the whole publish path.
 *
 * Posting a single comment is three round trips — open a review, add the
 * thread, submit it — because `addPullRequestReviewThread` has no standalone
 * mode. A blanket `OK` leaves the first one with no review id and nothing else
 * ever runs, so the mock has to answer that one specifically.
 */
function answersPublish(reviewId = 'PRR_transient') {
  requestMock.mockImplementation((msg: { document: string }) =>
    Promise.resolve(
      msg.document === START_REVIEW
        ? {
            ok: true,
            data: {
              data: { addPullRequestReview: { pullRequestReview: { id: reviewId } } },
            },
          }
        : OK,
    ),
  );
}

/** Which call carried ADD_THREAD. The publish path puts START_REVIEW ahead of it. */
const threadCall = (): number =>
  requestMock.mock.calls.findIndex((call) => call[0]?.document !== START_REVIEW);

function mount(
  props: Partial<ComposerProps> = {},
  options: { store?: KeyValueStore } = {},
) {
  const onClose = vi.fn();
  const store = options.store ?? memoryStore();
  const view = render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode()}
      prRef={PR_REF}
      threads={[]}
      drafts={new DraftStore(store)}
    >
      <Composer
        path="src/app.ts"
        anchor={SINGLE}
        rejection={null}
        selectedLines={['const a = 1;']}
        onClose={onClose}
        {...props}
      />
    </ReviewSessionProvider>,
  );
  return { ...view, onClose, store };
}

const box = (): HTMLTextAreaElement =>
  screen.getByRole('textbox', { name: /comment/i }) as HTMLTextAreaElement;

/** The `variables` of the nth `mutate` the page sent. */
const variablesOf = (call: number): Record<string, unknown> =>
  requestMock.mock.calls[call]?.[0]?.variables ?? {};

describe('Composer', () => {
  it('names the line it will comment on', () => {
    mount();

    expect(screen.getByText(/line 2/i)).toBeDefined();
  });

  it('names both ends of a multi-line selection', () => {
    mount({
      anchor: { line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });

    expect(screen.getByText(/lines 5-9/i)).toBeDefined();
  });

  it('sends the start fields for a multi-line comment', async () => {
    answersPublish();
    mount({ anchor: { line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' } });

    await userEvent.type(box(), 'a range comment');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(threadCall()).toBeGreaterThan(-1));
    expect(variablesOf(threadCall())).toMatchObject({
      path: 'src/app.ts',
      line: 9,
      side: 'RIGHT',
      startLine: 5,
      startSide: 'RIGHT',
    });
  });

  it('explains a cross-side selection instead of refusing it', async () => {
    // Pierre can express a drag that starts on the old side and ends on the
    // new one. GitHub has no way to represent that, so the reviewer is told
    // what to do rather than watching a request fail.
    mount({ anchor: null, rejection: 'cross-side' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/one side|both sides/i);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('explains a malformed range instead of posting a line of NaN', () => {
    mount({ anchor: null, rejection: 'invalid-range' });

    expect(screen.getByRole('alert').textContent).toMatch(/could not|selection/i);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('opens with whatever draft was left here last time', async () => {
    mount({}, { store: memoryStore({ [KEY]: 'half a thought' }) });

    await waitFor(() => expect(box().value).toBe('half a thought'));
  });

  it('saves a draft once the reviewer stops typing', async () => {
    vi.useFakeTimers();
    const { store } = mount();
    await act(async () => {});

    fireEvent.change(box(), { target: { value: 'half a thought' } });
    expect(await store.get(KEY)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(await store.get(KEY)).toBe('half a thought');
  });

  it('keeps the draft when the post fails', async () => {
    // The rule the whole draft store exists for: a failed mutation must never
    // discard what someone typed.
    requestMock.mockResolvedValue(FAILURE);
    const { store, onClose } = mount();

    await userEvent.type(box(), 'a comment worth keeping');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(await store.get(KEY)).toBe('a comment worth keeping');
    expect(box().value).toBe('a comment worth keeping');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears the draft only after the post succeeds', async () => {
    answersPublish();
    const { store, onClose } = mount();

    await userEvent.type(box(), 'a comment worth keeping');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await store.get(KEY)).toBeNull();
  });

  it('wraps the selected lines in a suggestion block', async () => {
    mount({ selectedLines: ['const a = 1;', 'const b = 2;'] });

    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));

    expect(box().value).toContain('```suggestion\nconst a = 1;\nconst b = 2;\n```');
  });

  it('refuses to suggest when the source lines are not available', () => {
    // An empty suggestion block is not a harmless placeholder: GitHub reads it
    // as "replace these lines with nothing".
    mount({ selectedLines: [] });

    expect(
      (screen.getByRole('button', { name: /suggest/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('will not post an empty comment', () => {
    mount();

    expect(
      (screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says the comment will join a review that is already open', () => {
    render(
      <ReviewSessionProvider
        pullRequest={pullRequestNode({
          viewerLatestReview: { id: 'PRR_pending', state: 'PENDING' },
        })}
        prRef={PR_REF}
        threads={[]}
        drafts={new DraftStore(memoryStore())}
      >
        <Composer
          path="src/app.ts"
          anchor={SINGLE}
          rejection={null}
          selectedLines={[]}
          onClose={vi.fn()}
        />
      </ReviewSessionProvider>,
    );

    expect(screen.getByText(/pending review/i)).toBeDefined();
  });
});
