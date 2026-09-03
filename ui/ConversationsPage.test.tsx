/**
 * The Conversations page.
 *
 * This list is the **only** global index of review threads in the application.
 * The per-file unanchorable section is drawn by `CodeView`'s custom header, so
 * it exists only for files the column has actually rendered — and `files` is
 * capped while `reviewThreads` is followed separately. A thread this page drops
 * is a thread the reviewer is never told about.
 *
 * So the two things worth testing hardest are both about not losing one: a
 * resolved thread is folded away rather than filtered out, and a thread on a
 * file the column never received is listed and labelled rather than skipped.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { ConversationsPage } from './ConversationsPage';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { prPayload, reviewThread } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

beforeEach(() => {
  (request as unknown as Mock).mockReset();
});

function mount(
  threads: ReviewThread[],
  options: { paths?: readonly string[]; onJump?: (id: string, path: string) => void } = {},
) {
  const payload = prPayload({ threads });
  return render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
      drafts={new DraftStore(memoryStore())}
    >
      <ConversationsPage
        paths={options.paths ?? ['src/app.ts']}
        onJumpToThread={options.onJump ?? (() => {})}
      />
    </ReviewSessionProvider>,
  );
}

describe('ConversationsPage', () => {
  it('gathers each file’s threads under its path', () => {
    mount(
      [
        reviewThread({ path: 'src/app.ts', line: 2 }),
        reviewThread({ path: 'README.md', line: 1 }),
      ],
      { paths: ['README.md', 'src/app.ts'] },
    );

    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'README.md',
      'src/app.ts',
    ]);
  });

  it('folds resolved threads away instead of dropping them', () => {
    mount([
      reviewThread({ path: 'src/app.ts', line: 2 }),
      reviewThread({ path: 'src/app.ts', line: 9, isResolved: true }),
    ]);

    const folded = screen.getByText(/1 resolved/i);
    expect(folded.closest('details')).not.toBeNull();
  });

  it('still lists a file whose threads have all been resolved', () => {
    // Nothing outstanding is not the same as nothing to read. This is the only
    // place a resolved thread on an unrendered file can be reached from.
    mount([reviewThread({ path: 'src/app.ts', line: 2, isResolved: true })]);

    expect(screen.getByRole('heading', { name: 'src/app.ts' })).toBeDefined();
    expect(screen.getByText(/1 resolved/i)).toBeDefined();
  });

  it('says when the column has no card to jump to', () => {
    mount([reviewThread({ path: 'lib/dropped.ts', line: 3 })], {
      paths: ['src/app.ts'],
    });

    expect(screen.getByText(/not in this diff/i)).toBeDefined();
  });

  it('asks the column to jump when an entry is pressed', async () => {
    const onJump = vi.fn();
    mount([reviewThread({ path: 'src/app.ts', line: 2 })], { onJump });

    await userEvent.click(screen.getByRole('button', { name: /line 2/i }));

    expect(onJump).toHaveBeenCalledWith('PRRT_src/app.ts:2', 'src/app.ts');
  });

  it('carries enough of the comment to recognize it by', () => {
    mount([reviewThread({ path: 'src/app.ts', line: 2 })]);

    expect(screen.getByRole('button', { name: /this allocates/i })).toBeDefined();
  });

  it('reaches a resolved thread once its disclosure is opened', async () => {
    const onJump = vi.fn();
    mount([reviewThread({ path: 'src/app.ts', line: 9, isResolved: true })], { onJump });

    await userEvent.click(screen.getByText(/1 resolved/i));
    const folded = screen.getByRole('group');
    await userEvent.click(within(folded).getByRole('button', { name: /line 9/i }));

    expect(onJump).toHaveBeenCalledWith('PRRT_src/app.ts:9', 'src/app.ts');
  });

  it('says so when nobody has commented at all', () => {
    mount([]);

    expect(screen.getByText(/no comments/i)).toBeDefined();
  });
});
