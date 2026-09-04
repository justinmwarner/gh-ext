/**
 * The Files view: the tree, the diff, and the one control that only means
 * anything next to them.
 *
 * "Since my last review" used to live in the top bar, where it sat beside the
 * pull request's title as though it described the pull request. It describes
 * what the column is showing, so it belongs to the column.
 */

import { act, render, screen } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARK_VIEWED } from '@/lib/github/mutations';
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

const COMPARE = { active: false, available: true, busy: false, onToggle: () => {} };

function mount(
  options: {
    threads?: ReviewThread[];
    compare?: Partial<typeof COMPARE>;
    compareError?: string | null;
    viewedState?: FileViewedState;
  } = {},
) {
  const payload = {
    ...prPayloadWithFiles([
      fileFixture({ path: 'src/app.ts', viewedState: options.viewedState ?? 'UNVIEWED' }),
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
        compare={{ ...COMPARE, ...options.compare }}
        compareError={options.compareError ?? null}
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

  it('says how much changed, in the bar above the diff', () => {
    // The bar held one button and a border. This is the only place the page
    // says how big the change is at all.
    mount();

    const bar = document.querySelector('.filesview-bar');
    expect(bar?.textContent).toContain('1 file changed');
  });

  it('counts what is on screen rather than the whole pull request', () => {
    // While the comparison is showing, `files` is the narrowed list — so this
    // has to describe that, or it contradicts the column beneath it.
    const { container } = mount();

    const counts = container.querySelector('.filesview-counts');
    expect(counts?.textContent).toContain('+1');
    expect(counts?.textContent).toContain('1');
  });

  it('offers the comparison against the reviewer’s own last review', () => {
    mount();

    expect(
      screen.getByRole('button', { name: /since my last review/i }),
    ).toBeDefined();
  });

  it('disables the comparison rather than hiding it for a first-time reviewer', () => {
    // A control that appears and disappears with the pull request is one the
    // reviewer has to rediscover.
    mount({ compare: { available: false } });

    const toggle = screen.getByRole('button', { name: /since my last review/i });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute('title')).toMatch(/not reviewed/i);
  });

  it('says when the comparison could not be loaded, and what is showing instead', () => {
    // An empty column would read as "nothing changed", so the fallback is the
    // whole diff and the reason is on screen.
    mount({ compareError: 'GitHub said no.' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('GitHub said no.');
    expect(alert.textContent).toMatch(/whole pull request/i);
  });

  it('marks a file in the tree that has an open conversation', () => {
    const { container } = mount({
      threads: [reviewThread({ path: 'src/app.ts', line: 2 })],
    });

    const shadow =
      container.querySelector('file-tree-container')?.shadowRoot?.textContent ?? '';
    expect(shadow).toContain('●');
  });

  it('marks a file whose conversations are all settled differently', () => {
    const { container } = mount({
      threads: [reviewThread({ path: 'src/app.ts', line: 2, isResolved: true })],
    });

    const shadow =
      container.querySelector('file-tree-container')?.shadowRoot?.textContent ?? '';
    expect(shadow).toContain('○');
    expect(shadow).not.toContain('●');
  });
});

describe('ticking a file off from the tree', () => {
  const shadow = (container: HTMLElement) =>
    container.querySelector('file-tree-container')?.shadowRoot ?? null;

  const box = (container: HTMLElement, glyph: string) =>
    [
      ...(shadow(container)?.querySelectorAll(
        '[data-item-section="decoration"] span span',
      ) ?? []),
    ].find((element) => element.textContent === glyph);

  it('shows the state the payload arrived with', () => {
    const { container } = mount({ viewedState: 'VIEWED' });

    expect(shadow(container)?.textContent).toContain('☑');
  });

  it('marks the file viewed on GitHub when the box is clicked', async () => {
    (request as unknown as Mock).mockResolvedValue({ ok: true, data: { data: {} } });
    const { container } = mount();

    await act(async () => {
      box(container, '☐')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }),
      );
    });

    // The real mutation, not a local flag: a tick here shows up on github.com.
    expect((request as unknown as Mock).mock.calls[0]?.[0]?.document).toBe(MARK_VIEWED);
    expect(shadow(container)?.textContent).toContain('☑');
  });

  it('puts the box back when GitHub refuses', async () => {
    // Optimistic, with a real rollback. A tick that stays after the mutation
    // failed is a file the reviewer believes they have signed off.
    (request as unknown as Mock).mockResolvedValue({ ok: false, error: 'nope' });
    const { container } = mount();

    await act(async () => {
      box(container, '☐')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(shadow(container)?.textContent).toContain('☐');
    expect(shadow(container)?.textContent).not.toContain('☑');
  });
});
