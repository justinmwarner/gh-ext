/**
 * The main column: stacked per-file diff cards, with the review on top of them.
 *
 * `@pierre/diffs` renders the code itself into a shadow root, but the card
 * header and every annotation are ours — React nodes in ordinary light DOM,
 * projected into the shadow rows through slots. So most of what is asserted
 * here is the part we wrote.
 *
 * The exception, and the most important test in this file, is the one that
 * pins Pierre's own behaviour: an annotation on a line the renderer did not
 * draw produces a light-DOM node with **no slot to go into**, and the browser
 * shows nothing at all. No error, no warning. That is the entire reason the
 * cross-check and the per-file section exist, and if it ever stopped being true
 * the demotion would be dead weight rather than a safeguard.
 */

import { type CodeViewItem, parsePatchFiles } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { CODE_VIEW_SAFE_PROPS, DiffColumn } from './DiffColumn';
import { request } from './background';
import { fileDiffFor, fileDiffSignature } from './diffItems';
import { NO_FILE } from './currentFile';
import { memoryStore } from './memoryStore.fixture';
import {
  annotationIsVisible,
  annotationNode,
  clickGutterUtility,
  clickHunkExpander,
  diffHasRendered,
  dragGutterUtility,
  hunkExpander,
} from './pierreDom.fixture';
import { pullRequestNode, reviewThread } from './prPayload.fixture';
import type { ReviewFile } from './reviewFiles';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
});

const patchOf = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,1 @@',
    '-before',
    '+after',
  ].join('\n');

/**
 * Two hunks with a gap between them, so lines 4–19 exist in the file and are
 * not rendered. That gap is where a comment goes missing.
 */
const gappedPatch = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,3 @@',
    ' one',
    '-before',
    '+after',
    ' three',
    '@@ -20,3 +20,3 @@',
    ' twenty',
    '-old',
    '+new',
    ' twentytwo',
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

const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;

function mount(
  files: readonly ReviewFile[],
  props: Record<string, unknown> = {},
  threads: readonly ReviewThread[] = [],
) {
  const onScrollTo = vi.fn<(path: string) => void>();
  const view = render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode()}
      prRef={PR_REF}
      threads={threads}
      drafts={new DraftStore(memoryStore())}
    >
      <DiffColumn
        files={files}
        diff={UNIFIED}
        current={NO_FILE}
        onScrollTo={onScrollTo}
        {...props}
      />
    </ReviewSessionProvider>,
  );
  return { ...view, onScrollTo };
}

/** The card for one path, found by the header we render into the light DOM. */
const card = (path: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-file-card="${path}"]`);
  if (found == null) throw new Error(`no card rendered for ${path}`);
  return found;
};

const section = (path: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-unanchored="${path}"]`);
  if (found == null) throw new Error(`no unanchored section rendered for ${path}`);
  return found;
};

const untilDrawn = (path: string) =>
  waitFor(() => {
    expect(diffHasRendered(path)).toBe(true);
  });

describe('CODE_VIEW_SAFE_PROPS', () => {
  // Two of these are absences. A comment cannot enforce an absence and a
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

  it('shows the gutter "+" that starts a comment', () => {
    expect(CODE_VIEW_SAFE_PROPS.options.enableGutterUtility).toBe(true);
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
    mount([file({ path: 'src/new.ts', oldPath: 'src/old.ts', isRename: true })]);

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

  it('moves the viewed state optimistically, now that it writes it', () => {
    // The mutation itself, and the rollback when it fails, are covered in
    // ui/viewedState.test.tsx. This only pins that the box is live here.
    mount([file({ path: 'a.ts', viewedState: 'UNVIEWED' })]);

    const box = within(card('a.ts')).getByRole('checkbox') as HTMLInputElement;
    expect(box.readOnly).toBe(false);

    act(() => {
      fireEvent.click(box);
    });

    expect(box.checked).toBe(true);
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

describe('what Pierre does with an annotation it cannot place', () => {
  it('emits the node and then shows nothing, with no error at all', async () => {
    // Not a test of this codebase. It pins the library behaviour that every
    // decision in `layoutThreads` rests on: React writes a light-DOM node for
    // every annotation, but the shadow row only exists for lines that were
    // rendered, so an annotation in collapsed context is silently unassigned
    // and invisible. If this ever stops being true, the demotion below is
    // unnecessary — and if it stays true and the demotion is removed, review
    // comments disappear without trace.
    const parsed = parsePatchFiles(gappedPatch('a.ts'))[0]?.files[0];
    if (parsed === undefined) throw new Error('the fixture patch did not parse');

    const items: CodeViewItem<{ id: string }>[] = [
      {
        id: 'a.ts',
        type: 'diff',
        fileDiff: parsed,
        annotations: [
          { side: 'additions', lineNumber: 2, metadata: { id: 'in-hunk' } },
          { side: 'additions', lineNumber: 10, metadata: { id: 'out-of-hunk' } },
        ],
        version: 1,
      },
    ];

    const { container } = render(
      <CodeView<{ id: string }>
        items={items}
        disableWorkerPool
        renderAnnotation={(annotation) => (
          <span data-testid={annotation.metadata?.id}>seen</span>
        )}
        options={{ diffStyle: 'unified' }}
      />,
    );

    const slotOf = (id: string) =>
      screen.queryByTestId(id)?.closest<HTMLElement>('[slot]')?.assignedSlot ?? null;

    // The in-hunk annotation is drawn once Pierre has built its rows.
    await waitFor(() => {
      expect(slotOf('in-hunk')).not.toBeNull();
    });
    // Present in the DOM, assigned to nothing, drawn nowhere.
    expect(slotOf('out-of-hunk')).toBeNull();
    expect(container.querySelector('[slot="annotation-additions-10"]')).not.toBeNull();
  });
});

describe('review threads in the column', () => {
  it('renders an anchored thread as an annotation Pierre actually shows', async () => {
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [reviewThread({ path: 'src/app.ts', line: 2 })],
    );

    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(true);
    });

    const node = annotationNode('src/app.ts', 'additions', 2);
    if (node === null) throw new Error('unreachable');
    expect(within(node).getByText('This allocates on every call.')).toBeDefined();
  });

  it('lists a thread whose line exists in the file but not in any hunk', async () => {
    // The highest-stakes behaviour in this task. `partitionThreads` calls this
    // thread anchored — it has a line — and Pierre would draw nothing for it.
    // Listed here, or lost.
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [reviewThread({ path: 'src/app.ts', line: 10 })],
    );

    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });

    expect(annotationNode('src/app.ts', 'additions', 10)).toBeNull();
    expect(
      within(section('src/app.ts')).getByText('This allocates on every call.'),
    ).toBeDefined();
    // And it is genuinely on screen: the card it lives in is slotted into the
    // shadow header, not stranded in the light DOM the way the annotation
    // would have been.
    await waitFor(() => {
      expect(
        section('src/app.ts').closest<HTMLElement>('[slot]')?.assignedSlot,
      ).not.toBeNull();
    });
    expect(section('src/app.ts').textContent).toMatch(/not shown in the diff/i);
    expect(
      section('src/app.ts').querySelector('[data-listed-reason="out-of-hunk"]'),
    ).not.toBeNull();
  });

  it('lists an outdated thread, with where it used to be', async () => {
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [
        reviewThread({
          path: 'src/app.ts',
          line: null,
          startLine: null,
          originalLine: 194,
          isOutdated: true,
        }),
      ],
    );

    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });
    expect(within(section('src/app.ts')).getByText('was on line 194')).toBeDefined();
    expect(
      section('src/app.ts').querySelector('[data-listed-reason="outdated"]'),
    ).not.toBeNull();
  });

  it('lists a file-level thread, which has no line to anchor to', async () => {
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [reviewThread({ path: 'src/app.ts', subjectType: 'FILE' })],
    );

    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });
    expect(within(section('src/app.ts')).getByText('Whole file')).toBeDefined();
    expect(
      section('src/app.ts').querySelector('[data-listed-reason="file-level"]'),
    ).not.toBeNull();
  });

  it('lists threads on a file that has no diff to draw them on', async () => {
    // A withheld patch has no hunks at all, so every thread on it is out of
    // range. A blank card with no comments would be a lie.
    mount([file({ path: 'huge.sql', patch: '', patchOmitted: true })], {}, [
      reviewThread({ path: 'huge.sql', line: 4 }),
    ]);

    await waitFor(() => {
      expect(section('huge.sql')).toBeDefined();
    });
    expect(
      within(section('huge.sql')).getByText('This allocates on every call.'),
    ).toBeDefined();
  });

  it('keeps the section closed until it is asked for', async () => {
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [reviewThread({ path: 'src/app.ts', line: 10 })],
    );

    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });
    expect((section('src/app.ts') as HTMLDetailsElement).open).toBe(false);
    expect(section('src/app.ts').textContent).toMatch(/1 comment/i);
  });

  it('shows no section at all when every thread is anchored', async () => {
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [reviewThread({ path: 'src/app.ts', line: 2 })],
    );

    await untilDrawn('src/app.ts');
    expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();
  });
});

describe('what CodeView does with a new patch for an item it already has', () => {
  it('keeps the code it first rendered, which is why the viewer is remounted', async () => {
    // Not a test of this codebase. `CodeView` reconciles controlled items by
    // id and reuses the record, and reusing it keeps the rows it already drew
    // even though the item now carries a different `fileDiff` and a bumped
    // `version`. Verified against @pierre/diffs 1.3.6.
    //
    // "Changes since my last review" replaces the patch for paths the column
    // already has cards for, so if this were not true the reviewer would be
    // shown the *old* diff under the new file list — silently. `DiffColumn`
    // remounts the viewer under `diffGeneration` because of it. If this ever
    // starts passing a new patch through, the remount is dead weight; while it
    // holds, removing the remount shows the wrong code.
    const rowsOf = (root: ShadowRoot): string[] =>
      [...root.querySelectorAll('[data-column-number]')].map(
        (node) => `${node.getAttribute('data-line-type')}:${node.getAttribute('data-column-number')}`,
      );

    const itemsFor = (patch: string, version: number): CodeViewItem<{ id: string }>[] => {
      const parsed = parsePatchFiles(patch)[0]?.files[0];
      if (parsed === undefined) throw new Error('the fixture patch did not parse');
      return [{ id: 'a.ts', type: 'diff', fileDiff: parsed, version }];
    };

    const { container, rerender } = render(
      <CodeView<{ id: string }>
        items={itemsFor(gappedPatch('a.ts'), 1)}
        disableWorkerPool
        options={{ diffStyle: 'unified' }}
      />,
    );

    const host = container.querySelector('diffs-container');
    if (!(host instanceof HTMLElement) || host.shadowRoot === null) {
      throw new Error('no shadow root rendered');
    }
    const root = host.shadowRoot;

    await waitFor(() => {
      expect(rowsOf(root).length).toBeGreaterThan(0);
    });
    const before = rowsOf(root);
    expect(before).toContain('context:1');

    // A different patch for the same id, with a version that says so.
    rerender(
      <CodeView<{ id: string }>
        items={itemsFor(
          [
            'diff --git a/a.ts b/a.ts',
            '--- a/a.ts',
            '+++ b/a.ts',
            '@@ -20,3 +20,3 @@',
            ' twenty',
            '-old',
            '+new',
            ' twentytwo',
          ].join('\n'),
          2,
        )}
        disableWorkerPool
        options={{ diffStyle: 'unified' }}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(rowsOf(root)).toEqual(before);
  });
});

describe('switching the diff out from under the threads', () => {
  // "Changes since my last review" replaces the patch for a path the column
  // already has a card for. The rendered hunk ranges change, so a thread's
  // anchored/listed classification has to be recomputed — and the layout memo
  // is keyed on the thread fields, which have not moved at all.

  const narrowed = (path: string): string =>
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -20,3 +20,3 @@',
      ' twenty',
      '-old',
      '+new',
      ' twentytwo',
    ].join('\n');

  const tree = (files: readonly ReviewFile[], threads: readonly ReviewThread[]) => (
    <ReviewSessionProvider
      pullRequest={pullRequestNode()}
      prRef={PR_REF}
      threads={threads}
      drafts={new DraftStore(memoryStore())}
    >
      <DiffColumn
        files={files}
        diff={UNIFIED}
        current={NO_FILE}
        onScrollTo={() => {}}
      />
    </ReviewSessionProvider>
  );

  it('lists a thread that the narrowed diff no longer draws', async () => {
    // Not lost: the reviewer is never told a comment exists and then not shown
    // it. Losing review feedback is the worst thing this application can do.
    const threads = [reviewThread({ path: 'src/app.ts', line: 2 })];
    const wide = [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })];

    const { rerender } = render(tree(wide, threads));

    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(true);
    });
    expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();

    // Same path, same threads, different patch: line 2 is outside every hunk.
    rerender(tree([file({ path: 'src/app.ts', patch: narrowed('src/app.ts') })], threads));

    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });
    expect(
      section('src/app.ts').querySelector('[data-listed-reason="out-of-hunk"]'),
    ).not.toBeNull();
    expect(
      within(section('src/app.ts')).getByText('This allocates on every call.'),
    ).toBeDefined();
  });

  it('anchors it again when the wide diff comes back', async () => {
    const threads = [reviewThread({ path: 'src/app.ts', line: 2 })];
    const { rerender } = render(
      tree([file({ path: 'src/app.ts', patch: narrowed('src/app.ts') })], threads),
    );

    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });

    rerender(
      tree([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })], threads),
    );

    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(true);
    });
    expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();
  });
});

describe('acting on a thread from inside the diff', () => {
  it('resolves it without disturbing the annotation it lives in', async () => {
    // The annotation array is memoized on what affects anchoring, which
    // `isResolved` does not — so nothing about the diff is re-rendered. The
    // thread still has to update, and it does because it reads the session
    // rather than being handed a snapshot through the annotation.
    requestMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          resolveReviewThread: {
            thread: { id: 'PRRT_src/app.ts:2', isResolved: true, viewerCanUnresolve: true },
          },
        },
      },
    });
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [reviewThread({ path: 'src/app.ts', line: 2 })],
    );

    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(true);
    });
    const before = annotationNode('src/app.ts', 'additions', 2);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve conversation' }));
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Unresolve conversation' }),
      ).toBeDefined();
    });
    expect(annotationNode('src/app.ts', 'additions', 2)).toBe(before);
  });
});

describe('starting a comment from the gutter', () => {
  it('opens the composer on the line the "+" was clicked', async () => {
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })]);
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 2, 'additions');
    });

    const box = await screen.findByRole('textbox', { name: /comment on src\/app\.ts/i });
    expect(box).toBeDefined();
    // Anchored where the reviewer clicked, and actually drawn there.
    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(true);
    });
  });

  it('explains a drag across both sides instead of posting it', async () => {
    // Pierre hands back `{ side: 'deletions', endSide: 'additions' }` for this
    // gesture. GitHub has no way to express such a comment, so the reviewer is
    // told why rather than watching a request fail.
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })]);
    await untilDrawn('src/app.ts');

    await act(async () => {
      dragGutterUtility(
        'src/app.ts',
        { lineNumber: 2, side: 'deletions' },
        { lineNumber: 2, side: 'additions' },
      );
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/both sides/i);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('expanding unchanged context', () => {
  // Task 26. A patch-parsed diff is `isPartial`, so Pierre draws no expand
  // affordance for it at all until `loadDiffFiles` is supplied — and once it
  // hydrates, it upgrades the metadata object *in place*, so the layout memo
  // keyed on that object's identity never notices that the file grew.

  const BASE_SHA = 'a'.repeat(40);
  const HEAD_SHA = 'f'.repeat(40);
  const BLOBS = { pr: PR_REF, baseSha: BASE_SHA, headSha: HEAD_SHA } as const;

  /** The lines `gappedPatch` never sends: the collapsed 4–19 gap. */
  const GAP = Array.from({ length: 16 }, (_, index) => `context ${index + 4}`);

  const wholeFile = (second: string, twentyFirst: string): string =>
    ['one', second, 'three', ...GAP, 'twenty', twentyFirst, 'twentytwo'].join('\n');

  const OLD_FILE = wholeFile('before', 'old');
  const NEW_FILE = wholeFile('after', 'new');

  const serveBlobs = () => {
    requestMock.mockImplementation((msg: { kind: string; ref?: string }) => {
      if (msg.kind !== 'get-blob') {
        return Promise.resolve({ ok: true, data: { data: {} } });
      }
      return Promise.resolve({
        ok: true,
        data: { status: 'ok', text: msg.ref === BASE_SHA ? OLD_FILE : NEW_FILE },
      });
    });
  };

  it('anchors a thread that was demoted while its line was collapsed', async () => {
    serveBlobs();
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })], { blobs: BLOBS }, [
      reviewThread({ path: 'src/app.ts', line: 5 }),
    ]);
    await untilDrawn('src/app.ts');

    // Line 5 sits in the 4-19 gap between the two hunks. It exists in the
    // file, it is not outdated, and `partitionThreads` calls it anchored — and
    // Pierre would draw nothing for it, so it is demoted into the list.
    await waitFor(() => {
      expect(section('src/app.ts')).toBeDefined();
    });
    expect(
      section('src/app.ts').querySelector('[data-listed-reason="out-of-hunk"]'),
    ).not.toBeNull();

    // The affordance only exists because a loader was supplied.
    expect(hunkExpander('src/app.ts')).not.toBeNull();

    await act(async () => {
      clickHunkExpander('src/app.ts');
    });

    // The gap is now drawn, so the comment can be — and is — anchored to it.
    await waitFor(
      () => {
        expect(annotationIsVisible('src/app.ts', 'additions', 5)).toBe(true);
      },
      { timeout: 10_000 },
    );

    const node = annotationNode('src/app.ts', 'additions', 5);
    if (node === null) throw new Error('unreachable');
    expect(within(node).getByText('This allocates on every call.')).toBeDefined();
    // And it is no longer listed as something the diff cannot show.
    expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();
  });

  it('shows no expand affordance at all without a loader', async () => {
    // The other half of the same fact, and the reason this task exists.
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })]);
    await untilDrawn('src/app.ts');

    expect(hunkExpander('src/app.ts')).toBeNull();
  });

  it('upgrades the very object it was handed, which is why the memo watches its contents', async () => {
    // Not a test of this codebase. It pins the library behaviour the memo
    // signature is built around, verified against 1.3.6: `CodeView` hydrates
    // through `Object.assign(item.item.fileDiff, hydrated)`, so the metadata
    // object we parsed and cached is upgraded where it stands. Identity does
    // not move, which is exactly why an identity-keyed revision cannot see it.
    // If this ever stops being true the signature is merely redundant; while
    // it is true and the signature only watched identity, a comment revealed
    // by expanding context would stay listed as undrawable forever.
    serveBlobs();
    const target = file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') });
    mount([target], { blobs: BLOBS });
    await untilDrawn('src/app.ts');

    const parsed = fileDiffFor(target);
    expect(parsed.isPartial).toBe(true);
    expect(parsed.additionLines.length).toBe(6);
    const before = fileDiffSignature(target);

    await act(async () => {
      clickHunkExpander('src/app.ts');
    });
    await waitFor(() => {
      expect(fileDiffFor(target).isPartial).toBe(false);
    });

    // The same object, holding the whole file.
    expect(fileDiffFor(target)).toBe(parsed);
    expect(parsed.additionLines.length).toBe(22);
    expect(parsed.deletionLines.length).toBe(22);
    // And the signature moved with it, which identity alone could not.
    expect(fileDiffSignature(target)).not.toBe(before);
  });

  it('says why when a side of the file cannot be loaded', async () => {
    // A binary blob, an oversized one, or a side that does not exist at that
    // commit. Pierre catches a rejected loader, logs it and leaves the hunk
    // shut, so without this the expander is a control that does nothing.
    requestMock.mockImplementation((msg: { kind: string }) =>
      Promise.resolve(
        msg.kind === 'get-blob'
          ? { ok: true, data: { status: 'too-large' } }
          : { ok: true, data: { data: {} } },
      ),
    );
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })], {
      blobs: BLOBS,
    });
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickHunkExpander('src/app.ts');
    });

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toMatch(/too large to load in full/i);
  });
});
