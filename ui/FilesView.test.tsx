/**
 * The Files view: the tree and the diff, side by side.
 *
 * Which commits are on screen is not decided here — `ScopeBar` owns that, on
 * the row directly above this one, because the answer changes what `files`
 * contains and so what the Conversations view calls "not in this diff".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARK_VIEWED } from '@/lib/github/mutations';
import { BOTH_SIDES } from '@/lib/review/diffScope';
import type { FileViewedState, ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { FilesView } from './FilesView';
import { request } from './background';
import { NO_FILE } from './currentFile';
import { memoryStore } from './memoryStore.fixture';
import { fileFixture, prPayloadWithFiles, reviewThread } from './prPayload.fixture';
import { reviewFiles } from './reviewFiles';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

beforeEach(() => {
  (request as unknown as Mock).mockReset();
});

function mount(
  options: {
    threads?: ReviewThread[];
    viewedState?: FileViewedState;
    extraFiles?: Parameters<typeof prPayloadWithFiles>[0];
  } = {},
) {
  const payload = {
    ...prPayloadWithFiles([
      fileFixture({ path: 'src/app.ts', viewedState: options.viewedState ?? 'UNVIEWED' }),
      ...(options.extraFiles ?? []),
    ]),
    threads: options.threads ?? [],
  };
  return render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
      drafts={new DraftStore(memoryStore())}
    >
      <FilesView
        payload={payload}
        files={reviewFiles(payload)}
        current={NO_FILE}
        onSelectFromTree={vi.fn()}
        onSelectFromScroll={vi.fn()}
        jump={null}
        blobs={null}
        diff={{ source: 'unified', truncated: false }}
        sides={BOTH_SIDES}
      />
    </ReviewSessionProvider>,
  );
}

describe('FilesView', () => {
  it('puts the tree and the diff side by side', () => {
    const { container } = mount();

    expect(screen.getByRole('navigation', { name: /changed files/i })).toBeDefined();
    expect(container.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
  });

  it('gives the tree a resize handle the keyboard can reach', () => {
    mount();

    const separator = screen.getByRole('separator', { name: /sidebar/i });
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('tabindex')).toBe('0');
  });

  it('marks a file in the tree that has an open conversation', () => {
    const { container } = mount({
      threads: [reviewThread({ path: 'src/app.ts', line: 2 })],
    });

    expect(
      container
        .querySelector('[data-path="src/app.ts"] .tree-comment')
        ?.getAttribute('data-tone'),
    ).toBe('open');
  });

  it('marks a file whose conversations are all settled differently', () => {
    const { container } = mount({
      threads: [reviewThread({ path: 'src/app.ts', line: 2, isResolved: true })],
    });

    expect(
      container
        .querySelector('[data-path="src/app.ts"] .tree-comment')
        ?.getAttribute('data-tone'),
    ).toBe('resolved');
  });
});

describe('ticking a file off from the tree', () => {
  const box = (container: HTMLElement, path: string) =>
    container.querySelector(`[data-path="${path}"] [data-check]`);

  it('shows the state the payload arrived with', () => {
    const { container } = mount({ viewedState: 'VIEWED' });

    expect(box(container, 'src/app.ts')?.getAttribute('data-check')).toBe('checked');
  });

  it('marks the file viewed on GitHub when the box is clicked', async () => {
    (request as unknown as Mock).mockResolvedValue({ ok: true, data: { data: {} } });
    const { container } = mount();

    await userEvent.click(box(container, 'src/app.ts') as Element);

    // The real mutation, not a local flag: a tick here shows up on github.com.
    expect((request as unknown as Mock).mock.calls[0]?.[0]?.document).toBe(MARK_VIEWED);
    expect(box(container, 'src/app.ts')?.getAttribute('data-check')).toBe('checked');
  });

  it('puts the box back when GitHub refuses', async () => {
    // Optimistic, with a real rollback. A tick that stays after the mutation
    // failed is a file the reviewer believes they have signed off.
    (request as unknown as Mock).mockResolvedValue({ ok: false, error: 'nope' });
    const { container } = mount();

    await userEvent.click(box(container, 'src/app.ts') as Element);

    expect(box(container, 'src/app.ts')?.getAttribute('data-check')).toBe('unchecked');
  });

  it('marks every file in a folder from the folder’s own box', async () => {
    // The whole point of a folder checkbox, and it is one mutation per file:
    // `markFileAsViewed` has no bulk form.
    (request as unknown as Mock).mockResolvedValue({ ok: true, data: { data: {} } });
    const { container } = mount({
      extraFiles: [fileFixture({ path: 'src/beta.ts' })],
    });

    await userEvent.click(box(container, 'src/') as Element);

    const paths = (request as unknown as Mock).mock.calls.map(
      (call) => call[0]?.variables?.path,
    );
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src/beta.ts');
  });
});
