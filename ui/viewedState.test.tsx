/**
 * The per-file viewed checkbox.
 *
 * `viewerViewedState` has three values, not two. `DISMISSED` means the file
 * changed *after* it was marked viewed, which is the most useful of the three
 * during a re-review — drawn as unviewed it loses that the reviewer ever
 * looked, drawn as viewed it claims they have seen the current version.
 *
 * The mutation is GitHub's own viewed state, so a mark made here shows up on
 * github.com. It is optimistic, and a failure puts the box back rather than
 * leaving a tick the server never accepted.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARK_VIEWED, UNMARK_VIEWED } from '@/lib/github/mutations';
import type { FileViewedState } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { RAW } from '@/lib/compare/modes';
import { FileCard } from './FileCard';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { fileFixture, prPayloadWithFiles } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';
import { reviewFiles } from './reviewFiles';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

function mount(viewedState: FileViewedState) {
  const payload = prPayloadWithFiles([
    fileFixture({ path: 'src/app.ts', viewedState }),
  ]);
  const file = reviewFiles(payload)[0];
  if (file === undefined) throw new Error('fixture built no file');

  return render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={[]}
      drafts={new DraftStore(memoryStore())}
    >
      <FileCard
        file={file}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onHeaderRef={() => {}}
        unanchored={[]}
        mode={RAW.id}
        onChangeMode={() => {}}
        blobs={null}
      />
    </ReviewSessionProvider>,
  );
}

const box = () =>
  screen.getByRole('checkbox', { name: /src\/app\.ts/ }) as HTMLInputElement;

describe('rendering all three states', () => {
  it('draws UNVIEWED as an empty box', () => {
    const { container } = mount('UNVIEWED');

    expect(box().checked).toBe(false);
    expect(box().indeterminate).toBe(false);
    expect(container.querySelector('[data-viewed-state="UNVIEWED"]')).not.toBeNull();
  });

  it('draws VIEWED as a ticked box', () => {
    const { container } = mount('VIEWED');

    expect(box().checked).toBe(true);
    expect(box().indeterminate).toBe(false);
    expect(container.querySelector('[data-viewed-state="VIEWED"]')).not.toBeNull();
  });

  it('draws DISMISSED as neither, and says why', () => {
    const { container } = mount('DISMISSED');

    expect(box().checked).toBe(false);
    expect(box().indeterminate).toBe(true);
    expect(container.querySelector('[data-viewed-state="DISMISSED"]')).not.toBeNull();
    expect(container.textContent).toMatch(/changed since/i);
  });

  it('is not read-only any more', () => {
    mount('UNVIEWED');

    expect(box().readOnly).toBe(false);
    expect(box().disabled).toBe(false);
  });
});

describe('marking a file viewed', () => {
  it('sends MARK_VIEWED for the pull request and path', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount('UNVIEWED');

    await user.click(box());

    await waitFor(() => {
      expect(requestMock.mock.calls[0]?.[0]?.document).toBe(MARK_VIEWED);
    });
    expect(requestMock.mock.calls[0]?.[0]?.variables).toEqual({
      pullRequestId: 'PR_kwDOABCD',
      path: 'src/app.ts',
    });
  });

  it('sends UNMARK_VIEWED when the tick is taken back', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount('VIEWED');

    await user.click(box());

    await waitFor(() => {
      expect(requestMock.mock.calls[0]?.[0]?.document).toBe(UNMARK_VIEWED);
    });
  });

  it('marks a DISMISSED file viewed rather than unviewing it', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
    mount('DISMISSED');

    await user.click(box());

    await waitFor(() => {
      expect(requestMock.mock.calls[0]?.[0]?.document).toBe(MARK_VIEWED);
    });
  });

  it('moves the box before GitHub answers', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mount('UNVIEWED');

    await user.click(box());
    expect(box().checked).toBe(true);

    release({ ok: true, data: { data: {} } });
    await waitFor(() => {
      expect(box().checked).toBe(true);
    });
  });
});

describe('when the mutation fails', () => {
  it('puts the box back and says what happened', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'GitHub said no', resetAt: null },
    });
    mount('UNVIEWED');

    await user.click(box());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/GitHub said no/);
    expect(box().checked).toBe(false);
  });

  it('rolls back to DISMISSED, not to unviewed', async () => {
    // Collapsing DISMISSED into UNVIEWED on the way back would throw away the
    // "this changed since you looked" signal the reviewer started with.
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'nope', resetAt: null },
    });
    const { container } = mount('DISMISSED');

    await user.click(box());

    await screen.findByRole('alert');
    expect(box().indeterminate).toBe(true);
    expect(container.querySelector('[data-viewed-state="DISMISSED"]')).not.toBeNull();
  });
});
