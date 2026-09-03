/**
 * The left rail.
 *
 * Three regions now rather than two: a tab strip, whichever page it selects,
 * and the file tree underneath. The tree stays put whichever page is showing —
 * it is how the reviewer moves through the diff, and losing it to read a
 * comment means losing your place in the review.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { SideRail } from './SideRail';
import { request } from './background';
import { NO_FILE } from './currentFile';
import { memoryStore } from './memoryStore.fixture';
import { prPayload, reviewThread } from './prPayload.fixture';
import type { ReviewFile } from './reviewFiles';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

beforeEach(() => {
  (request as unknown as Mock).mockReset();
});

const file = (path: string): ReviewFile => ({
  path,
  oldPath: path,
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch: '',
  additions: 12,
  deletions: 3,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
});

function mount(threads: ReviewThread[] = [], files: ReviewFile[] = [file('src/app.ts')]) {
  const payload = prPayload({ threads });
  const onJumpToThread = vi.fn();
  const view = render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
      drafts={new DraftStore(memoryStore())}
    >
      <SideRail
        width={300}
        payload={payload}
        files={files}
        current={NO_FILE}
        onSelect={vi.fn()}
        onJumpToThread={onJumpToThread}
      />
    </ReviewSessionProvider>,
  );
  return { ...view, onJumpToThread };
}

const shadowText = (container: HTMLElement): string =>
  container.querySelector('file-tree-container')?.shadowRoot?.textContent ?? '';

describe('SideRail', () => {
  it('opens on the Overview', () => {
    mount();

    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Overview');
    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Description' }),
    ).toBeDefined();
  });

  it('swaps the page when another tab is chosen', async () => {
    mount([reviewThread({ path: 'src/app.ts', line: 2 })]);

    await userEvent.click(screen.getByRole('tab', { name: 'Conversations' }));

    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'src/app.ts' }),
    ).toBeDefined();
  });

  it('shows exactly one page at a time', () => {
    mount();

    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('keeps the file tree on screen whichever page is showing', async () => {
    const { container } = mount();

    await userEvent.click(screen.getByRole('tab', { name: 'Conversations' }));

    const tree = screen.getByRole('navigation', { name: /changed files/i });
    expect(container.contains(tree)).toBe(true);
  });

  it('gives the panel its own resize handle the keyboard can reach', () => {
    // Horizontal, because it separates two regions stacked vertically. The
    // rail's own handle is the vertical one, and it lives outside this rail.
    mount();

    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal');
    expect(separator.getAttribute('tabindex')).toBe('0');
  });

  it('marks a file in the tree that has an open conversation', () => {
    const { container } = mount([reviewThread({ path: 'src/app.ts', line: 2 })]);

    expect(shadowText(container)).toContain('●');
  });

  it('marks a file whose conversations are all settled differently', () => {
    const { container } = mount([
      reviewThread({ path: 'src/app.ts', line: 2, isResolved: true }),
    ]);

    expect(shadowText(container)).toContain('○');
    expect(shadowText(container)).not.toContain('●');
  });

  it('leaves a file nobody has commented on unmarked', () => {
    const { container } = mount([]);

    expect(shadowText(container)).not.toContain('●');
    expect(shadowText(container)).not.toContain('○');
  });

  it('passes a thread jump up from the Conversations page', async () => {
    const { onJumpToThread } = mount([reviewThread({ path: 'src/app.ts', line: 2 })]);

    await userEvent.click(screen.getByRole('tab', { name: 'Conversations' }));
    await userEvent.click(screen.getByRole('button', { name: /line 2/i }));

    expect(onJumpToThread).toHaveBeenCalledWith('PRRT_src/app.ts:2', 'src/app.ts');
  });
});
