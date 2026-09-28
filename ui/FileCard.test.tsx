/**
 * The name on a card's head row.
 *
 * It used to be a label beside a 20px chevron, and the chevron was the only
 * thing on the row that folded the file — a reviewer reaching for the name,
 * which is the widest thing up there and the thing they were reading, got
 * nothing. The name is now the fold control itself, chevron included, so a
 * pointer, a keyboard and a screen reader all reach the same one.
 *
 * What the name cannot do any more is be dragged over and copied, so the copy
 * button beside it is the other half of the same change.
 *
 * The hit area also runs on past the end of the name to the counts. That is
 * layout, which jsdom does not perform, so it is checked in a real browser in
 * `e2e/review.spec.ts`.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RAW } from '@/lib/compare/modes';
import { DraftStore } from '@/lib/review/drafts';
import type { WhitespaceDiff } from '@/lib/review/whitespace';
import { COPIED_FOR } from './CopyPath';
import { type FileCardProps, FileCard } from './FileCard';
import { memoryStore } from './memoryStore.fixture';
import { type FileFixture, fileFixture, prPayloadWithFiles } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';
import { reviewFiles } from './reviewFiles';

vi.mock('./background', () => ({ request: vi.fn() }));

function mount(
  overrides: Partial<FileFixture> & { path: string },
  props: Partial<Omit<FileCardProps, 'file'>> = {},
) {
  const payload = prPayloadWithFiles([fileFixture(overrides)]);
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
        mode={RAW.id}
        onChangeMode={() => {}}
        whitespace={null}
        held={null}
        shown={false}
        onToggleShown={() => {}}
        {...props}
      />
    </ReviewSessionProvider>,
  );
}

/** A file whose every change was whitespace, drawn without it. */
const EMPTIED: WhitespaceDiff = {
  patch: '',
  hunks: 0,
  dropped: 1,
  partial: false,
  changed: true,
};

describe('folding from the name', () => {
  it('folds the card when the name is pressed, not only the chevron', async () => {
    const user = userEvent.setup();
    const toggled = vi.fn();
    mount({ path: 'src/app.ts' }, { onToggleCollapsed: toggled });

    await user.click(screen.getByText('src/app.ts'));

    expect(toggled).toHaveBeenCalledExactlyOnceWith('src/app.ts');
  });

  it('is one control, and the name is inside it', () => {
    // Not a second, pointer-only target laid over a label: the keyboard and a
    // screen reader reach the thing the pointer does, under the name the
    // chevron has always had.
    mount({ path: 'src/app.ts' });

    const toggle = screen.getByRole('button', { name: 'Collapse src/app.ts' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(toggle).getByText('src/app.ts')).toBeTruthy();
  });

  it('folds a renamed file from either of its names', async () => {
    const user = userEvent.setup();
    const toggled = vi.fn();
    mount(
      { path: 'src/next.ts', oldPath: 'src/prev.ts', isRename: true },
      { onToggleCollapsed: toggled },
    );

    await user.click(screen.getByText('src/prev.ts'));
    await user.click(screen.getByText('src/next.ts'));

    expect(toggled).toHaveBeenCalledTimes(2);
    expect(toggled).toHaveBeenLastCalledWith('src/next.ts');
  });

  it('says both names of a renamed file to a screen reader', () => {
    // The button's label is all a screen reader hears of what is inside it,
    // and the rename was said by a visually hidden "renamed to" in there. A
    // label naming only the new path would quietly drop the old one.
    mount({ path: 'src/next.ts', oldPath: 'src/prev.ts', isRename: true });

    expect(
      screen.getByRole('button', { name: 'Collapse src/prev.ts renamed to src/next.ts' }),
    ).toBeTruthy();
  });

  it('leaves the name plain on a card with nothing under it to fold', async () => {
    // Every change was whitespace, so the card is already only its header. A
    // name that looked pressable there would be the chevron's old lie — that
    // there is more to see — told in a bigger font.
    const user = userEvent.setup();
    const toggled = vi.fn();
    mount(
      { path: 'src/app.ts' },
      { onToggleCollapsed: toggled, whitespace: EMPTIED, held: 'whitespace' },
    );

    expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull();
    await user.click(screen.getByText('src/app.ts'));
    expect(toggled).not.toHaveBeenCalled();
  });
});

/**
 * Copying the path.
 *
 * `userEvent.setup()` stands a working clipboard up on `navigator`, so these
 * read back what was actually written rather than asserting that a function
 * was called.
 */
describe('copying the path', () => {
  const copy = (path: string) => screen.getByRole('button', { name: `Copy ${path}` });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('puts the path on the clipboard', async () => {
    const user = userEvent.setup();
    mount({ path: 'src/components/Thing.tsx' });

    await user.click(copy('src/components/Thing.tsx'));

    await expect(navigator.clipboard.readText()).resolves.toBe('src/components/Thing.tsx');
  });

  it('copies where a renamed file is now, not where it was', async () => {
    const user = userEvent.setup();
    mount({ path: 'src/next.ts', oldPath: 'src/prev.ts', isRename: true });

    await user.click(copy('src/next.ts'));

    await expect(navigator.clipboard.readText()).resolves.toBe('src/next.ts');
  });

  it('does not fold the card it is on', async () => {
    const user = userEvent.setup();
    const toggled = vi.fn();
    mount({ path: 'src/app.ts' }, { onToggleCollapsed: toggled });

    await user.click(copy('src/app.ts'));

    expect(toggled).not.toHaveBeenCalled();
  });

  it('is there on a card that cannot fold, too', () => {
    mount({ path: 'src/app.ts' }, { whitespace: EMPTIED, held: 'whitespace' });

    expect(copy('src/app.ts')).toBeTruthy();
  });

  it('speaks through a live region that was there before it had anything to say', () => {
    // Mounted empty: a region that arrives with its text in it is one some
    // screen readers never announce. And not `role="status"`, for the reason
    // `NoticeCenter` gives — one on every card would have every other query
    // for a status on this page finding dozens.
    const { container } = mount({ path: 'src/app.ts' });

    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('');
    expect(live?.getAttribute('role')).toBeNull();
  });

  it('says it copied, and then goes back to offering to', async () => {
    // A clock that also runs on its own. Testing Library drains each action
    // through a zero-length `setTimeout` it only knows how to advance under
    // Jest, so a clock that moved only when told to would hang the first
    // click; this one gets there in real time and can still be jumped.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const user = userEvent.setup();
    mount({ path: 'src/app.ts' });

    await user.click(copy('src/app.ts'));

    // Looked for by what it says, since the region itself is there from the
    // start.
    const status = await screen.findByText('Copied');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(copy('src/app.ts').getAttribute('data-copy-state')).toBe('copied');

    act(() => {
      vi.advanceTimersByTime(COPIED_FOR);
    });

    expect(status.textContent).toBe('');
    expect(copy('src/app.ts').getAttribute('data-copy-state')).toBe('idle');
  });

  it('says so when the browser will not take it, and keeps saying so', async () => {
    // Refused for want of focus, usually — the devtools had it. A button that
    // showed a tick anyway would send the reviewer off to paste whatever was
    // on the clipboard before.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('Document is not focused.', 'NotAllowedError'),
    );
    mount({ path: 'src/app.ts' });

    await user.click(copy('src/app.ts'));

    const status = await screen.findByText(/refused/i);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(copy('src/app.ts').getAttribute('data-copy-state')).toBe('failed');

    // Not a notice that times out: the reviewer may have looked away, and the
    // clipboard is still not holding what they think it is.
    act(() => {
      vi.advanceTimersByTime(COPIED_FOR * 5);
    });
    expect(status.textContent).toMatch(/refused/i);
  });
});
