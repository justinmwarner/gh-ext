/**
 * The main column: stacked per-file diff cards.
 *
 * `@pierre/diffs` renders the code itself into a shadow root, but the card
 * header is ours — React nodes in ordinary light DOM, projected into the shadow
 * row through a slot. So everything asserted here is the part we wrote: the
 * path, the counts, the viewed checkbox, the collapse toggle, and the sentence
 * a file gets when it has no diff to show.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CODE_VIEW_SAFE_PROPS, DiffColumn } from './DiffColumn';
import { NO_FILE } from './currentFile';
import type { ReviewFile } from './reviewFiles';

const patchOf = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,1 @@',
    '-before',
    '+after',
  ].join('\n');

const file = (overrides: Partial<ReviewFile> & { path: string }): ReviewFile => ({
  oldPath: overrides.path,
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch: patchOf(overrides.path),
  additions: 12,
  deletions: 3,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
  ...overrides,
});

const UNIFIED = { source: 'unified', truncated: false } as const;

function mount(files: readonly ReviewFile[], props: Record<string, unknown> = {}) {
  const onScrollTo = vi.fn<(path: string) => void>();
  const view = render(
    <DiffColumn
      files={files}
      diff={UNIFIED}
      current={NO_FILE}
      onScrollTo={onScrollTo}
      {...props}
    />,
  );
  return { ...view, onScrollTo };
}

/** The card for one path, found by the header we render into the light DOM. */
const card = (path: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-file-card="${path}"]`);
  if (found == null) throw new Error(`no card rendered for ${path}`);
  return found;
};

describe('CODE_VIEW_SAFE_PROPS', () => {
  // Two of these three are absences. A comment cannot enforce an absence and a
  // reviewer reading a diff cannot see one, so they are pinned here instead.

  it('runs the highlighter on this thread', () => {
    // §16.4: grammars resolve on the main thread regardless, Vite hands dev
    // workers a localhost URL that is cross-origin from a chrome-extension://
    // page, and Chrome 148+ crashes the render process rather than throwing.
    expect(CODE_VIEW_SAFE_PROPS.disableWorkerPool).toBe(true);
  });

  it('never names a highlighter, leaving the WebAssembly-free default', () => {
    // `shiki-wasm` works all through development and dies silently in a shipped
    // extension, because WXT emits no CSP key in production builds.
    expect('preferredHighlighter' in CODE_VIEW_SAFE_PROPS.options).toBe(false);
  });

  it('never turns off line numbers', () => {
    // Line selection is only reachable through the number gutter. Without it,
    // there is no way to leave a comment at all.
    expect('disableLineNumbers' in CODE_VIEW_SAFE_PROPS.options).toBe(false);
  });
});

describe('DiffColumn', () => {
  it('gives each changed file a card headed by its path', () => {
    mount([file({ path: 'src/app.ts' })]);

    expect(within(card('src/app.ts')).getByText('src/app.ts')).toBeDefined();
  });

  it('shows the added and removed counts', () => {
    mount([file({ path: 'src/app.ts', additions: 12, deletions: 3 })]);

    const header = card('src/app.ts');
    expect(within(header).getByText('+12')).toBeDefined();
    expect(within(header).getByText('−3')).toBeDefined();
  });

  it('names both paths for a rename', () => {
    mount([
      file({ path: 'src/new.ts', oldPath: 'src/old.ts', isRename: true }),
    ]);

    const header = card('src/new.ts');
    expect(header.textContent).toContain('src/old.ts');
    expect(header.textContent).toContain('src/new.ts');
  });

  it('says a binary file is binary rather than leaving a blank card', () => {
    mount([file({ path: 'logo.png', isBinary: true, patch: '' })]);

    expect(within(card('logo.png')).getByRole('note').textContent).toMatch(/binary/i);
  });

  it('says when GitHub withheld the patch', () => {
    mount([file({ path: 'huge.sql', patch: '', patchOmitted: true })]);

    expect(within(card('huge.sql')).getByRole('note').textContent).toMatch(/github/i);
  });

  it('says when a rename moved a file without changing it', () => {
    mount([
      file({
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        isRename: true,
        patch: 'diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\n',
      }),
    ]);

    const note = within(card('src/new.ts')).getByRole('note');
    expect(note.textContent).toContain('src/old.ts');
    expect(note.textContent).toContain('src/new.ts');
  });

  it('leaves a file that has a diff without a note', () => {
    mount([file({ path: 'src/app.ts' })]);

    expect(within(card('src/app.ts')).queryByRole('note')).toBeNull();
  });

  it('gives the three viewed states three distinct appearances', () => {
    // DISMISSED means the file changed after the reviewer marked it viewed. It
    // is not "unviewed" — the reviewer did look — and reading as unviewed would
    // lose the fact that what they saw is now out of date.
    mount([
      file({ path: 'a.ts', viewedState: 'UNVIEWED' }),
      file({ path: 'b.ts', viewedState: 'VIEWED' }),
      file({ path: 'c.ts', viewedState: 'DISMISSED' }),
    ]);

    const box = (path: string): HTMLInputElement =>
      within(card(path)).getByRole('checkbox') as HTMLInputElement;

    expect(box('a.ts').checked).toBe(false);
    expect(box('a.ts').indeterminate).toBe(false);

    expect(box('b.ts').checked).toBe(true);
    expect(box('b.ts').indeterminate).toBe(false);

    expect(box('c.ts').checked).toBe(false);
    expect(box('c.ts').indeterminate).toBe(true);
    expect(card('c.ts').textContent).toMatch(/changed since/i);
  });

  it('names each viewed checkbox after its own file', () => {
    mount([file({ path: 'a.ts' }), file({ path: 'b.ts' })]);

    expect(screen.getByRole('checkbox', { name: /a\.ts/ })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: /b\.ts/ })).toBeDefined();
  });

  it('does not move the viewed state, because nothing writes it yet', () => {
    mount([file({ path: 'a.ts', viewedState: 'UNVIEWED' })]);

    const box = within(card('a.ts')).getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(box);

    expect(box.checked).toBe(false);
  });

  it('collapses and re-expands a file from its header', () => {
    mount([file({ path: 'src/app.ts' })]);

    const toggle = within(card('src/app.ts')).getByRole('button', {
      name: /collapse/i,
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      fireEvent.click(toggle);
    });

    const collapsed = within(card('src/app.ts')).getByRole('button', {
      name: /expand/i,
    });
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
  });

  it('offers no collapse toggle for a file with nothing to collapse', () => {
    mount([file({ path: 'logo.png', isBinary: true, patch: '' })]);

    expect(within(card('logo.png')).queryByRole('button')).toBeNull();
  });

  it('warns when the file list came from the files endpoint', () => {
    mount([file({ path: 'src/app.ts' })], {
      diff: { source: 'files-api', truncated: true },
    });

    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/files endpoint|unified diff/i);
    expect(notice.textContent).toMatch(/truncat/i);
  });

  it('says so when nothing changed', () => {
    mount([]);

    expect(screen.getByRole('main').textContent).toMatch(/no changed files/i);
  });

  it('reports the file at the top of the column when it scrolls', () => {
    const { onScrollTo, container } = mount([
      file({ path: 'a.ts' }),
      file({ path: 'b.ts' }),
    ]);
    const scroller = container.querySelector('.diff-view');
    if (scroller === null) throw new Error('no scroll region rendered');

    act(() => {
      fireEvent.scroll(scroller);
    });

    // jsdom measures everything as zero-sized, so *which* file it reports is
    // not meaningful here — `topmostFile` is tested against real numbers on its
    // own. What this pins is that the channel exists and is connected.
    expect(onScrollTo).toHaveBeenCalled();
  });

  it('reports a scroll only when it lands on a different file', () => {
    // Scroll fires at frame rate. The reducer would absorb the repeats, but
    // only after React had rendered the whole shell again to find that out.
    const { onScrollTo, container } = mount([
      file({ path: 'a.ts' }),
      file({ path: 'b.ts' }),
    ]);
    const scroller = container.querySelector('.diff-view');
    if (scroller === null) throw new Error('no scroll region rendered');

    act(() => {
      fireEvent.scroll(scroller);
      fireEvent.scroll(scroller);
      fireEvent.scroll(scroller);
    });

    expect(onScrollTo).toHaveBeenCalledTimes(1);
  });

  it('says nothing on its own when the scroll is what moved', () => {
    // The other half of the loop guard: being told a card reached the top must
    // not make the column report that card back again.
    const { onScrollTo } = mount([file({ path: 'a.ts' }), file({ path: 'b.ts' })], {
      current: { path: 'b.ts', origin: 'scroll' },
    });

    expect(onScrollTo).not.toHaveBeenCalled();
  });

  it('says nothing on its own when the tree is what moved', () => {
    const { onScrollTo } = mount([file({ path: 'a.ts' }), file({ path: 'b.ts' })], {
      current: { path: 'b.ts', origin: 'tree' },
    });

    expect(onScrollTo).not.toHaveBeenCalled();
  });
});
