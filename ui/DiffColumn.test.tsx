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

import type { ReactNode } from 'react';
import {
  CodeView as CodeViewCore,
  type CodeViewItem,
  parsePatchFiles,
} from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { ADD_THREAD, START_REVIEW } from '@/lib/github/mutations';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { parseGitAttributes } from '@/lib/review/generated';
import { BOTH_SIDES } from '@/lib/review/diffScope';
import { fileAnchor } from '@/lib/review/selection';
import { MODE_MEMORY_KEY } from '@/lib/settings';
import { CODE_VIEW_SAFE_PROPS, DiffColumn, REACH_WINDOW } from './DiffColumn';
import { request } from './background';
import { fileDiffFor, fileDiffSignature } from './diffItems';
import { AT_REST, NO_FILE } from './currentFile';
import { memoryStore } from './memoryStore.fixture';
import {
  annotationIsVisible,
  annotationNode,
  clickGutterUtility,
  clickHunkExpander,
  diffHasRendered,
  diffLayout,
  dragGutterUtility,
  fileShadow,
  gutterCell,
  hunkExpander,
} from './pierreDom.fixture';
import { pullRequestNode, reviewThread } from './prPayload.fixture';
import type { ReviewFile } from './reviewFiles';
import { ReviewSessionProvider, useReviewSession } from './reviewSession';

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

/**
 * Writes a comment straight through the session, bypassing the gutter.
 *
 * The gutter can only start a comment on a line that is on screen, which is
 * exactly the case the unplaceable path is not about.
 */
function Poster({ line }: { line: number }) {
  const session = useReviewSession();
  return (
    <button
      type="button"
      onClick={() => {
        void session.postThread({
          path: 'src/app.ts',
          body: 'Written before the diff moved.',
          anchor: { subject: 'line', line, side: 'RIGHT' },
        });
      }}
    >
      post off-hunk
    </button>
  );
}

/** The same, for a comment that is about the file and names no line at all. */
function FilePoster() {
  const session = useReviewSession();
  return (
    <button
      type="button"
      onClick={() => {
        void session.postThread({
          path: 'src/app.ts',
          body: 'The introduction reads as if it were still a draft.',
          anchor: fileAnchor(),
        });
      }}
    >
      post on file
    </button>
  );
}

function mount(
  files: readonly ReviewFile[],
  props: Record<string, unknown> = {},
  threads: readonly ReviewThread[] = [],
  extra: ReactNode = null,
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
        sides={BOTH_SIDES}
        current={NO_FILE}
        onScrollTo={onScrollTo}
        {...props}
      />
      {extra}
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

/**
 * The measured half of a card, and it arrives a tick after the header.
 *
 * Everything whose height depends on the file is an annotation rather than
 * header content, so that `CodeView` measures it — see `ui/FileBody.tsx`. The
 * annotation host is created on the render *after* the item is laid out, so a
 * synchronous assertion right after `mount` looks at a card that has its name
 * and its counts and nothing else yet.
 */
const body = async (path: string): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(document.querySelector(`[data-file-body="${path}"]`)).not.toBeNull();
  });
  const found = document.querySelector<HTMLElement>(`[data-file-body="${path}"]`);
  if (found == null) throw new Error(`no body rendered for ${path}`);
  return found;
};

const section = (path: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-unanchored="${path}"]`);
  if (found == null) throw new Error(`no unanchored section rendered for ${path}`);
  return found;
};

/** A promise this test decides when to settle, for asserting on mid-flight. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

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

  it('names no preference, so nothing here can outrank one', () => {
    // A third absence, and it is what keeps this object's name true.
    // `lineDiffType` is the reviewer's, from the options page, and it is built
    // per render alongside `theme` and `loadDiffFiles`. A default parked here
    // as well would be a second place to change one answer — and the failure
    // would be silent, because both spellings produce a working diff.
    expect('lineDiffType' in CODE_VIEW_SAFE_PROPS.options).toBe(false);
  });

  it('gives a rich card the whole width, and keeps both clauses that limit it', () => {
    // Without this a rendered Markdown document draws at 405px inside an 880px
    // card, beside an empty column. The two clauses are what keep it off
    // ordinary diffs, and losing either silently collapses real two-column
    // diffs to one:
    //   `[data-diff-type="split"]` — unified has one column already.
    //   `:only-child`             — a *text* diff can carry a file-level
    //                               annotation too, and its lines are in that
    //                               column as well.
    const css = CODE_VIEW_SAFE_PROPS.options.unsafeCSS ?? '';
    expect(css).toContain('[data-diff-type="split"]');
    expect(css).toContain('[data-line-annotation="-1,-1"]:only-child');
    expect(css).toContain('grid-template-columns: 1fr');
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

  it('says a binary file is binary rather than leaving a blank card', async () => {
    // A binary with no rich comparison to offer. An image would open in its
    // own view instead, which is what the comparison-mode tests cover.
    mount([file({ path: 'build/app.wasm', isBinary: true, patch: '' })]);

    expect(within(await body('build/app.wasm')).getByRole('note').textContent).toMatch(
      /binary/i,
    );
  });

  it('says when GitHub withheld the patch', async () => {
    mount([file({ path: 'huge.sql', patch: '', patchOmitted: true })]);

    expect(within(await body('huge.sql')).getByRole('note').textContent).toMatch(
      /github/i,
    );
  });

  it('says when a rename moved a file without changing it', async () => {
    mount([
      file({
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        isRename: true,
        patch: 'diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\n',
      }),
    ]);

    const note = within(await body('src/new.ts')).getByRole('note');
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

  it('folds a file the moment it is marked viewed', () => {
    // The point of the checkbox: a file you have finished with stops taking up
    // the column. Driven through the box rather than the fold toggle, because
    // the keyboard and the file tree tick it too and all three have to fold.
    mount([file({ path: 'src/app.ts', viewedState: 'UNVIEWED' })]);
    expect(
      within(card('src/app.ts')).getByRole('button', { name: /collapse/i }),
    ).toBeTruthy();

    act(() => {
      fireEvent.click(within(card('src/app.ts')).getByRole('checkbox'));
    });

    expect(
      within(card('src/app.ts')).getByRole('button', { name: /expand/i }),
    ).toBeTruthy();
  });

  it('folds it even after the reviewer had opened it by hand', () => {
    // The case that makes this an action rather than only a rule. Opening a
    // file is how you come to have read it, so the reviewer has almost always
    // recorded a fold override on the very card they are about to tick — and
    // an override that outlived the tick would fold everything except the
    // files they actually looked at.
    mount([
      file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts'), viewedState: 'UNVIEWED' }),
    ]);
    const toggle = () =>
      within(card('src/app.ts')).getByRole('button', { name: /collapse|expand/i });

    // Fold and unfold by hand, leaving an explicit "open" override behind.
    act(() => fireEvent.click(toggle()));
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    act(() => {
      fireEvent.click(within(card('src/app.ts')).getByRole('checkbox'));
    });

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens it again when the mark is taken back', () => {
    mount([file({ path: 'src/app.ts', viewedState: 'VIEWED' })]);

    act(() => {
      fireEvent.click(within(card('src/app.ts')).getByRole('checkbox'));
    });

    expect(
      within(card('src/app.ts')).getByRole('button', { name: /collapse/i }),
    ).toBeTruthy();
  });

  it('opens a review with the files already marked viewed folded away', () => {
    // What a reload looks like. Not a persisted interface preference — this
    // page keeps none — but GitHub's own viewed state, read the same way the
    // checkbox reads it.
    mount([
      file({ path: 'read.ts', viewedState: 'VIEWED' }),
      file({ path: 'todo.ts', viewedState: 'UNVIEWED' }),
      // Marked viewed and then changed underneath the reviewer. That is work
      // to do again, not work finished, so it opens.
      file({ path: 'moved.ts', viewedState: 'DISMISSED' }),
    ]);

    expect(
      within(card('read.ts')).getByRole('button', { name: /expand/i }),
    ).toBeTruthy();
    expect(
      within(card('todo.ts')).getByRole('button', { name: /collapse/i }),
    ).toBeTruthy();
    expect(
      within(card('moved.ts')).getByRole('button', { name: /collapse/i }),
    ).toBeTruthy();
  });

  it('leaves a viewed file open once the reviewer has opened it', () => {
    // The fold is a default, not a lock. Nothing re-folds it until the mark
    // itself moves again.
    mount([file({ path: 'read.ts', viewedState: 'VIEWED' })]);

    act(() => {
      fireEvent.click(within(card('read.ts')).getByRole('button', { name: /expand/i }));
    });

    expect(
      within(card('read.ts')).getByRole('button', { name: /collapse/i }),
    ).toBeTruthy();
  });

  it('will not fold a file out from under a comment that has not been sent', () => {
    // An entry in `posting` is writing that is on GitHub nowhere, and if the
    // post fails the alert saying so is drawn on this card. Folding it because
    // the reviewer ticked the box on the way past would hide a failure they
    // have no other way to hear about.
    requestMock.mockReturnValue(new Promise(() => {}));
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [],
      <Poster line={2} />,
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'post off-hunk' }));
    });
    act(() => {
      fireEvent.click(within(card('src/app.ts')).getByRole('checkbox'));
    });

    expect(
      within(card('src/app.ts')).getByRole('button', { name: /collapse/i }),
    ).toBeTruthy();
    expect(screen.getByText('Written before the diff moved.')).toBeDefined();
  });

  it('offers a collapse toggle even on a card whose body is one sentence', () => {
    // A binary with no comparison to offer still has a body — the sentence
    // saying why there is no diff — and it is a file like any other: marking
    // it viewed folds it, so it needs the way back.
    mount([file({ path: 'build/app.wasm', isBinary: true, patch: '' })]);

    expect(
      within(card('build/app.wasm')).getByRole('button', { name: /Collapse/ }),
    ).toBeTruthy();
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

  it('does not report the files it passes over on its way to one it was sent to', async () => {
    // The bug this pins, which a long jump is the only way to reach: a scroll
    // the column *asked for* fires `scroll` on the way, `handleScroll` reports
    // whichever card is momentarily at the top, that arrives back as a move
    // with origin `scroll` — and origin `scroll` means "do not scroll", so the
    // journey is cancelled a few files short of where it was going. It showed
    // up as `n` landing on the file before the one holding the first thread.
    //
    // Reported once it gets there, not never. What must not happen is the
    // column narrating the middle of its own journey.
    const { onScrollTo, container } = mount(
      [file({ path: 'a.ts' }), file({ path: 'b.ts' }), file({ path: 'c.ts' })],
      { current: { path: 'a.ts', origin: 'command' } },
    );
    const scroller = container.querySelector('.diff-view');
    if (scroller === null) throw new Error('no scroll region rendered');

    // While the reach is still running — it retries across frames, and these
    // are the events the browser fires underneath it.
    act(() => {
      fireEvent.scroll(scroller);
      fireEvent.scroll(scroller);
    });

    expect(onScrollTo).not.toHaveBeenCalled();

    // That the guard comes back off afterwards is not asserted here, and the
    // reason is the same one this whole file keeps running into: jsdom lays
    // nothing out, so the column is on the same card before and after the
    // journey and a released guard is indistinguishable from a deduplicated
    // report. `e2e/review.spec.ts` asks it where it can be answered — jump to
    // a file, scroll by hand, and watch the tree follow.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
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
  it('draws the new patch, which is why the remount is no longer load-bearing', async () => {
    // Not a test of this codebase. `CodeView` reconciles controlled items by
    // id and reuses the record it holds for one. Through 1.3.6 that record
    // kept the rows it had already drawn even when the item arrived carrying a
    // different `fileDiff` and a bumped `version`, so the reviewer would have
    // been shown the *old* diff under the new file list — silently — and
    // `DiffColumn` remounted the whole viewer under `diffGeneration` to avoid
    // it. **1.4.1 passes the new patch through**, which is what this now pins.
    //
    // "Changes since my last review" is the feature that replaces a patch
    // under a path the column already has a card for, so this is the exact
    // motion it makes. The remount is kept for now — it also resets the scroll
    // and every per-card choice, which is defensible when the whole comparison
    // changes — but it is no longer what keeps the right code on screen, and
    // this test failing in the other direction is what would say so.
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

    // The whole of the new patch, and nothing of the old one. Asserted both
    // ways round: `before` alone would still pass if the viewer had drawn
    // nothing at all, which is the failure this is most likely to decay into.
    const after = rowsOf(root);
    expect(after).not.toEqual(before);
    expect(after).not.toContain('context:1');
    expect(after).toContain('context:20');
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
        sides={BOTH_SIDES}
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

  it('replaces the composer with the comment, rather than showing both', async () => {
    // The bug. Publishing one comment is three round trips; the thread arrives
    // from the second, and the composer used to stay open until the third —
    // so for two round trips the line held the finished comment *and* the box
    // still showing the same words, and then re-laid out when the box closed.
    requestMock.mockReturnValue(new Promise(() => {}));
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })]);
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 2, 'additions');
    });
    const box = await screen.findByRole('textbox', { name: /comment on src\/app\.ts/i });

    await act(async () => {
      fireEvent.change(box, { target: { value: 'This allocates once per row.' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });

    // Gone on the press, with nothing answered.
    expect(
      screen.queryByRole('textbox', { name: /comment on src\/app\.ts/i }),
    ).toBeNull();
    // And the comment is on the line the composer was on, drawn where Pierre
    // will actually show it.
    expect(document.querySelectorAll('[data-posting]')).toHaveLength(1);
    expect(screen.getByText('This allocates once per row.')).toBeDefined();
    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(true);
    });
  });

  it('hands the line over to the real thread without ever drawing two', async () => {
    // The swap is one commit: `takeThread` adds the thread and retires the
    // entry together, so the row is laid out once instead of twice.
    const held = deferred<unknown>();
    requestMock.mockImplementation((msg: { document: string }) =>
      msg.document === START_REVIEW
        ? Promise.resolve({
            ok: true,
            data: {
              data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } },
            },
          })
        : msg.document === ADD_THREAD
          ? Promise.resolve({
              ok: true,
              data: {
                data: {
                  addPullRequestReviewThread: {
                    thread: {
                      id: 'PRRT_new',
                      path: 'src/app.ts',
                      line: 2,
                      diffSide: 'RIGHT',
                      subjectType: 'LINE',
                      comments: {
                        nodes: [
                          { id: 'PRRC_1', body: 'This allocates once per row.' },
                        ],
                      },
                    },
                  },
                },
              },
            })
          : held.promise,
    );
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })]);
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 2, 'additions');
    });
    const box = await screen.findByRole('textbox', { name: /comment on src\/app\.ts/i });
    await act(async () => {
      fireEvent.change(box, { target: { value: 'This allocates once per row.' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });

    // The review is open and the thread is in it; the submit is still out.
    await waitFor(() => {
      expect(document.querySelector('[data-thread="PRRT_new"]')).not.toBeNull();
    });
    expect(document.querySelectorAll('[data-posting]')).toHaveLength(0);
    // One comment on the line, not two.
    expect(screen.getAllByText('This allocates once per row.')).toHaveLength(1);
    held.settle({ ok: true, data: { data: {} } });
  });

  it('lists a comment in flight whose line the diff is not drawing', async () => {
    // The rare half of an optimistic post, and the one that must not be
    // dropped: the reviewer changed what is on screen while a comment was in
    // the air. Line 10 is in the gap between this patch's two hunks, so
    // Pierre would take the annotation and draw nothing — in silence — and
    // writing that exists on GitHub nowhere would be gone from the page.
    requestMock.mockReturnValue(new Promise(() => {}));
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [],
      <Poster line={10} />,
    );
    await untilDrawn('src/app.ts');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'post off-hunk' }));
    });

    // In the card's body, under a sentence saying why it is not on its line.
    const listed = document.querySelector('[data-unplaceable-posting="src/app.ts"]');
    expect(listed).not.toBeNull();
    expect(listed?.textContent).toMatch(/line 10/i);
    expect(screen.getByText('Written before the diff moved.')).toBeDefined();
    // And exactly once — not both listed and anchored.
    expect(document.querySelectorAll('[data-posting]')).toHaveLength(1);
  });

  it('lists a comment in flight that is about the file and not a line', async () => {
    // The body is where such a comment belongs rather than where it ended up:
    // its thread will arrive `subjectType: FILE` and be listed in the same
    // place. What is being guarded against is the sentence above it, which
    // names a line number — a comment that has none must not be introduced as
    // having been written on line `undefined`.
    requestMock.mockReturnValue(new Promise(() => {}));
    mount(
      [file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })],
      {},
      [],
      <FilePoster />,
    );
    await untilDrawn('src/app.ts');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'post on file' }));
    });

    const listed = document.querySelector('[data-unplaceable-posting="src/app.ts"]');
    expect(listed?.textContent).toContain('on the file as a whole');
    expect(listed?.textContent).not.toContain('undefined');
    // The words `threadPosition` will use for the thread that replaces it.
    expect(listed?.textContent).toContain('Whole file');
    expect(
      screen.getByText('The introduction reads as if it were still a draft.'),
    ).toBeDefined();
    expect(document.querySelectorAll('[data-posting]')).toHaveLength(1);
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

  it('refuses a line whose number belongs to another commit, and says why', async () => {
    // A comment is posted as a line number in the *pull request's* diff —
    // `addPullRequestReviewThread` has no argument for which commit a line was
    // counted in. So a line picked off a diff between two other commits would
    // be attached to whatever occupies that number in the pull request's own
    // diff: a comment that looks posted, on code the reviewer never read.
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })], {
      sides: { additions: false, deletions: true },
    });
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 2, 'additions');
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/show all commits/i);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('still allows a comment on the side that does line up', async () => {
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })], {
      sides: { additions: false, deletions: true },
    });
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 2, 'deletions');
    });

    expect(
      await screen.findByRole('textbox', { name: /comment on src\/app\.ts/i }),
    ).toBeDefined();
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
    // signature is built around, verified against 1.4.1: `CodeView` hydrates
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

/**
 * A file the reviewer has asked to read without its whitespace.
 *
 * The patch below is the case the mode exists for: one hunk in which nothing
 * happened but an indent, and one in which something did. GitHub's diff shows
 * both; ignoring whitespace should leave only the second, and must leave the
 * second one's line numbers exactly where they were — because a comment is
 * posted as a line number in GitHub's diff and there is nothing on screen that
 * would say if one had drifted.
 */
const REINDENTED = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,3 @@',
    ' one',
    '-  spaced',
    '+    spaced',
    ' three',
    '@@ -20,3 +20,3 @@',
    ' twenty',
    '-old',
    '+new',
    ' twentytwo',
  ].join('\n');

const IGNORING = { ignoreWhitespace: true };

/** Every change in it is whitespace, so the rewrite leaves no hunks at all. */
const ALL_WHITESPACE = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-  spaced',
  '+    spaced',
  ' three',
].join('\n');

/** Nothing in it is whitespace-only, so the rewrite has nothing to take out. */
const NO_WHITESPACE = [
  'diff --git a/plain.ts b/plain.ts',
  '--- a/plain.ts',
  '+++ b/plain.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
].join('\n');

describe('DiffColumn, ignoring whitespace', () => {
  it('shows GitHub’s diff while the setting is off', async () => {
    mount([file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })]);
    await untilDrawn('src/app.ts');

    // The reindented line is still a change, as GitHub says it is.
    expect(gutterCell('src/app.ts', 2, 'additions')).toBeDefined();
    expect(document.querySelector('[data-whitespace-note]')).toBeNull();
  });

  it('takes away a hunk in which nothing but whitespace moved', async () => {
    mount([file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })], IGNORING);
    await untilDrawn('src/app.ts');

    // The first hunk is gone; the second is untouched and still numbered 20–22.
    expect(() => gutterCell('src/app.ts', 2, 'additions')).toThrow();
    expect(gutterCell('src/app.ts', 21, 'additions')).toBeDefined();
  });

  it('says on the file’s own row that this is not the diff GitHub is showing', async () => {
    // The requirement that makes the setting honest, and the one that carries
    // the whole signal now that the per-file button is gone. Everyone else on
    // this pull request is looking at something else, and the reviewer has to
    // be able to tell that from the card rather than from having remembered
    // what they ticked on the options page.
    //
    // On the header rather than in the body, where it was four lines of prose
    // above the first hunk of every file in the review. The words survive in
    // full as the accessible description; what is on screen is two of them.
    mount([file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })], IGNORING);
    await untilDrawn('src/app.ts');

    const flag = within(card('src/app.ts')).getByRole('button', {
      name: /whitespace hidden/i,
    });
    // Named by the two words, described by the sentence they stand for.
    const described = document.getElementById(
      flag.getAttribute('aria-describedby') ?? '',
    );
    expect(described?.textContent).toMatch(/recomputed here/i);
    expect(described?.textContent).toMatch(/not the diff GitHub/i);
    // And for the pointer, which is what a flag this short is for.
    expect(flag.getAttribute('title')).toMatch(/not the diff GitHub/i);
  });

  it('names the emptiness on a file that was nothing but whitespace', async () => {
    // Such a card has no body at all, so a header saying only "whitespace
    // hidden" would be describing a diff that is not underneath it.
    mount([file({ path: 'src/app.ts', patch: ALL_WHITESPACE })], IGNORING);

    // Not `untilDrawn`: there is nothing left to draw, which is the whole
    // point of this case. The header is what arrives.
    await waitFor(() => {
      expect(
        within(card('src/app.ts')).getByRole('button', { name: /only whitespace/i }),
      ).toBeDefined();
    });
  });

  it('flags every file it shortened, and no others', async () => {
    // It used to be per file, on the argument that one file being a reformat
    // says nothing about the next. It is one setting now, so the guarantee that
    // replaced it is this: no file is quietly shortened. The other half is that
    // a file it did not touch says nothing — with the setting on for the whole
    // pull request, a caveat on all nineteen is one nobody reads on the one
    // that needed it.
    mount(
      [
        file({ path: 'a.ts', patch: REINDENTED('a.ts') }),
        file({ path: 'plain.ts', patch: NO_WHITESPACE }),
      ],
      IGNORING,
    );
    await untilDrawn('a.ts');

    expect(within(card('a.ts')).queryByRole('button', { name: /whitespace/i })).not.toBeNull();
    expect(within(card('plain.ts')).queryByRole('button', { name: /whitespace/i })).toBeNull();
  });

  it('leaves the cards alone when the setting is off', async () => {
    mount([
      file({ path: 'a.ts', patch: REINDENTED('a.ts') }),
      file({ path: 'b.ts', patch: REINDENTED('b.ts') }),
    ]);
    await untilDrawn('a.ts');

    expect(within(card('a.ts')).queryByRole('button', { name: /whitespace/i })).toBeNull();
    // No body at all rather than an empty one: neither file has anything to
    // put in one, and an annotation host that is never filled is a strip of
    // empty space above every hunk in the review.
    expect(document.querySelector('[data-file-body="a.ts"]')).toBeNull();
    expect(document.querySelector('[data-file-body="b.ts"]')).toBeNull();
  });

  it('asks for no body of its own, now that the caveat is on the header', async () => {
    // The saving that came with the move. The note was the only reason an
    // ordinary source file needed an annotation, and with the setting on for
    // the whole pull request that meant one on every text file in it.
    mount([file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })], IGNORING);
    await untilDrawn('src/app.ts');

    expect(document.querySelector('[data-file-body="src/app.ts"]')).toBeNull();
  });

  it('keeps a comment on a vanished hunk, in the list rather than nowhere', async () => {
    // The failure this must not have. Pierre drops an annotation outside a
    // rendered hunk in silence, so a comment on the hunk that just disappeared
    // has to come back somewhere the reviewer will still find it.
    const thread = reviewThread({
      id: 'T1',
      path: 'src/app.ts',
      line: 2,
      diffSide: 'RIGHT',
    });
    mount(
      [file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })],
      IGNORING,
      [thread],
    );
    await untilDrawn('src/app.ts');

    await waitFor(() => {
      expect(section('src/app.ts').textContent).toMatch(/nothing but whitespace/i);
    });
    expect(annotationIsVisible('src/app.ts', 'additions', 2)).toBe(false);
  });

  it('still draws a comment on a hunk that survived', async () => {
    const thread = reviewThread({
      id: 'T2',
      path: 'src/app.ts',
      line: 21,
      diffSide: 'RIGHT',
    });
    mount(
      [file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })],
      IGNORING,
      [thread],
    );
    await untilDrawn('src/app.ts');

    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 21)).toBe(true);
    });
  });

  it('anchors a new comment on the line GitHub numbers it, not on a row index', async () => {
    // The whole safety argument in one assertion. The first hunk has been
    // taken off the screen, so line 21 is now the *second* addition row in the
    // file rather than the fifth. If anything downstream were counting rows
    // instead of reading GitHub's numbers, this is where it would show.
    mount([file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })], IGNORING);
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 21, 'additions');
    });

    expect(await screen.findByRole('textbox', { name: /comment on src\/app\.ts/i })).toBeDefined();
    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 21)).toBe(true);
    });
  });

  it('folds a file that was nothing but whitespace down to its header', async () => {
    // The height complaint. Such a card has no diff left in it, so drawing an
    // empty body plus an expander under a header is chrome standing in for
    // content that is not there.
    mount([file({ path: 'src/app.ts', patch: ALL_WHITESPACE })], IGNORING);

    await waitFor(() => {
      expect(within(card('src/app.ts')).getByRole('button', { name: /only whitespace/i }))
        .toBeDefined();
    });
    // Folded: no rows at all, so the card costs a header's height and nothing
    // more. It used to draw an empty body with an expander under it.
    expect(diffHasRendered('src/app.ts')).toBe(false);
  });

  it('gives the file back when the reviewer asks for it', async () => {
    // The escape hatch, and it has to put *GitHub's* patch back rather than
    // unfold a card around a patch that has already lost its lines.
    mount([file({ path: 'src/app.ts', patch: ALL_WHITESPACE })], IGNORING);
    await waitFor(() => {
      expect(within(card('src/app.ts')).getByRole('button', { name: /only whitespace/i }))
        .toBeDefined();
    });

    await act(async () => {
      fireEvent.click(
        within(card('src/app.ts')).getByRole('button', { name: /only whitespace/i }),
      );
    });
    await untilDrawn('src/app.ts');

    // The line the rewrite had merged into context is a change again.
    expect(gutterCell('src/app.ts', 2, 'additions')).toBeDefined();
  });

  it('keeps the way back on a file it is showing in full', async () => {
    mount([file({ path: 'src/app.ts', patch: REINDENTED('src/app.ts') })], IGNORING);
    await untilDrawn('src/app.ts');

    const flag = () =>
      within(card('src/app.ts')).getByRole('button', { name: /whitespace/i });
    expect(flag().getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      fireEvent.click(flag());
    });

    // Still there, still pressable, and no longer claiming to be hiding
    // anything — the card is showing every line GitHub sent.
    expect(flag().getAttribute('aria-pressed')).toBe('true');
    expect(flag().textContent).toMatch(/whitespace shown/i);
  });

  it('leaves a file with no text diff untouched', async () => {
    // Nothing to take the whitespace out of, so the rewrite must not invent a
    // flag for it: a binary wearing "only whitespace" is a card claiming its
    // contents were shortened.
    mount([file({ path: 'logo.png', isBinary: true, patch: '' })], IGNORING);

    expect(document.querySelector('.whitespace-flag')).toBeNull();
  });
});

/**
 * Unified against split.
 *
 * `diffStyle` is an option handed to the library, so the only honest evidence
 * that it took is what came out in the shadow root — hence `diffLayout` rather
 * than an assertion about the props that went in. Comment anchoring is checked
 * in both, because split is a different path inside Pierre: `getAnnotations`
 * returns two spans there and one row in unified.
 */
describe('DiffColumn, unified against split', () => {
  it('draws the layout the reviewer arrived from unless asked otherwise', async () => {
    mount([file({ path: 'src/app.ts' })]);
    await untilDrawn('src/app.ts');

    expect(diffLayout('src/app.ts')).toBe('single');
  });

  it('draws the two files side by side when asked for split', async () => {
    mount([file({ path: 'src/app.ts' })], { diffStyle: 'split' });
    await untilDrawn('src/app.ts');

    expect(diffLayout('src/app.ts')).toBe('split');
  });

  it('still draws a comment where it belongs in split', async () => {
    // §B.3: switching between the two needs no annotation data change. That is
    // a claim about a library, so it is checked rather than believed — and
    // `assignedSlot` is the only thing that tells "drawn" apart from "emitted
    // into a slot that does not exist", which is what silent loss looks like.
    const thread = reviewThread({
      id: 'T1',
      path: 'src/app.ts',
      line: 1,
      diffSide: 'RIGHT',
    });
    mount([file({ path: 'src/app.ts' })], { diffStyle: 'split' }, [thread]);
    await untilDrawn('src/app.ts');

    await waitFor(() => {
      expect(annotationIsVisible('src/app.ts', 'additions', 1)).toBe(true);
    });
  });

  it('still refuses a drag across both sides in split', async () => {
    // Split is what makes this gesture ordinary rather than exotic: the two
    // sides are separate columns there, so dragging out of one and into the
    // other is an easy thing to do by accident. GitHub can express it in
    // neither layout.
    mount([file({ path: 'src/app.ts', patch: gappedPatch('src/app.ts') })], {
      diffStyle: 'split',
    });
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
    expect(requestMock).not.toHaveBeenCalled();
  });
});

/**
 * Folding away what nobody wrote.
 *
 * The same shape as the whitespace rule and deliberately so: one word on the
 * head row saying why the body is not drawn, and that word is also how the
 * reviewer gets it. What is different is that nothing is *rewritten* here —
 * the file's name, counts and change type are GitHub's throughout, and the
 * only thing folded is the reading of it.
 */
describe('DiffColumn, folding generated files', () => {
  const HIDING = { hideGenerated: true };

  /**
   * `dist/bundle.js` rather than `package-lock.json`, and the difference is not
   * cosmetic: a `.json` file opens on the structural JSON comparison rather
   * than on a text diff, so it would have no rows to be folded away in the
   * first place. The rule under test is about the text diff.
   */
  const BUNDLE = 'dist/bundle.js';
  const bundle = () => file({ path: BUNDLE, patch: REINDENTED(BUNDLE) });

  it('draws a lockfile like anything else until the setting is on', async () => {
    mount([bundle()]);
    await untilDrawn(BUNDLE);

    expect(
      within(card(BUNDLE)).queryByRole('button', { name: /generated/i }),
    ).toBeNull();
  });

  it('folds it to its header, and says why on the row', async () => {
    mount([bundle()], HIDING);

    await waitFor(() => {
      expect(
        within(card(BUNDLE)).getByRole('button', { name: /generated/i }),
      ).toBeDefined();
    });
    expect(diffHasRendered(BUNDLE)).toBe(false);
  });

  it('keeps the counts GitHub sent, because nothing was rewritten', async () => {
    // The distinction from ignoring whitespace, and it is the whole reason this
    // one is safe to fold by default once asked for: no line has been taken out
    // of anything, so the header is still describing GitHub's diff exactly.
    mount([file({ path: 'package-lock.json', additions: 402, deletions: 118 })], HIDING);

    await waitFor(() => {
      expect(card('package-lock.json').textContent).toContain('+402');
    });
    expect(card('package-lock.json').textContent).toContain('118');
  });

  it('opens it when the reviewer presses the word', async () => {
    mount([bundle()], HIDING);
    await waitFor(() => {
      expect(
        within(card(BUNDLE)).getByRole('button', { name: /generated/i }),
      ).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(
        within(card(BUNDLE)).getByRole('button', { name: /generated/i }),
      );
    });

    await untilDrawn(BUNDLE);
    expect(
      within(card(BUNDLE))
        .getByRole('button', { name: /generated/i })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('leaves the files somebody wrote alone', async () => {
    mount([bundle(), file({ path: 'src/app.ts' })], HIDING);
    await untilDrawn('src/app.ts');

    expect(
      within(card('src/app.ts')).queryByRole('button', { name: /generated/i }),
    ).toBeNull();
    expect(diffHasRendered('src/app.ts')).toBe(true);
  });

  it('obeys a repository that exempts one of its own files', async () => {
    // The direction that matters most: somebody went out of their way to say
    // this lockfile is worth reading, and folding it anyway would be overruling
    // the repository with a guess.
    mount([bundle()], {
      ...HIDING,
      gitAttributes: parseGitAttributes(`${BUNDLE} -linguist-generated`),
    });
    await untilDrawn(BUNDLE);

    expect(
      within(card(BUNDLE)).queryByRole('button', { name: /generated/i }),
    ).toBeNull();
  });

  it('obeys a repository that declares a file no pattern would catch', async () => {
    mount([file({ path: 'src/schema.ts' })], {
      ...HIDING,
      gitAttributes: parseGitAttributes('src/schema.ts linguist-generated'),
    });

    await waitFor(() => {
      expect(
        within(card('src/schema.ts')).getByRole('button', { name: /generated/i }),
      ).toBeDefined();
    });
  });

  /**
   * The reviewer's own globs, on top of the built-in list.
   *
   * `src/api/client.gen.ts` is the case the setting exists for: a real path
   * that no heuristic over names could be expected to catch, and that the
   * repository has said nothing about. The two claims worth pinning are that
   * the globs do nothing at all while the folding setting is off, and that a
   * repository's `.gitattributes` still outranks them.
   *
   * The path carries no `generated` in it deliberately — the card header is
   * searched by accessible name, and a file called `generated-client.ts` would
   * satisfy every one of these assertions by being named rather than folded.
   */
  describe('with the reviewer’s own patterns', () => {
    const OURS = 'src/api/client.gen.ts';
    const ours = () => file({ path: OURS, patch: REINDENTED(OURS) });
    const PATTERNS = { generatedPatterns: ['**/*.gen.ts'] };

    const foldWord = () =>
      within(card(OURS)).queryByRole('button', { name: /generated/i });

    it('folds a path the built-in list would never have caught', async () => {
      mount([ours()], { ...HIDING, ...PATTERNS });

      await waitFor(() => {
        expect(foldWord()).not.toBeNull();
      });
      expect(diffHasRendered(OURS)).toBe(false);
    });

    it('ignores them entirely while the folding setting is off', async () => {
      // The rule `Settings.generatedPatterns` insists on: a preference that
      // folds a file away must not be able to start folding without the
      // reviewer having turned folding on. A glob typed and then left behind
      // is not consent.
      mount([ours()], PATTERNS);
      await untilDrawn(OURS);

      expect(foldWord()).toBeNull();
    });

    it('lets the repository overrule them, because it is talking about that file', async () => {
      // The precedence decision, and the direction that matters: a glob typed
      // months ago about a different codebase must not overrule a repository
      // that went out of its way to say this file is worth reading.
      mount([ours()], {
        ...HIDING,
        ...PATTERNS,
        gitAttributes: parseGitAttributes(`${OURS} -linguist-generated`),
      });
      await untilDrawn(OURS);

      expect(foldWord()).toBeNull();
    });

    it('adds to the built-in list rather than replacing it', async () => {
      mount([bundle(), ours()], { ...HIDING, ...PATTERNS });

      await waitFor(() => {
        expect(foldWord()).not.toBeNull();
      });
      expect(
        within(card(BUNDLE)).queryByRole('button', { name: /generated/i }),
      ).not.toBeNull();
    });

    it('still opens on a press, like any other folded file', async () => {
      // The escape hatch has to work for these too, or a mistyped glob is a
      // file the reviewer cannot read without going to the options page.
      mount([ours()], { ...HIDING, ...PATTERNS });
      await waitFor(() => {
        expect(foldWord()).not.toBeNull();
      });

      await act(async () => {
        const word = foldWord();
        if (word === null) throw new Error('the fold word is not showing');
        fireEvent.click(word);
      });

      await untilDrawn(OURS);
    });
  });

  it('says generated rather than whitespace on a file that is both', async () => {
    // "Nobody wrote this" explains the folding on its own. "Every change in it
    // was whitespace" invites the reviewer to wonder what a lockfile is doing
    // reindenting itself.
    mount([file({ path: BUNDLE, patch: ALL_WHITESPACE })], {
      ...HIDING,
      ignoreWhitespace: true,
    });

    await waitFor(() => {
      expect(
        within(card(BUNDLE)).getByRole('button', { name: /generated/i }),
      ).toBeDefined();
    });
    expect(
      within(card(BUNDLE)).queryByRole('button', { name: /whitespace/i }),
    ).toBeNull();
  });
});

/**
 * How much of a changed line is picked out inside it.
 *
 * `lineDiffType` is an option handed to the library, so — like `diffStyle`
 * above — the only honest evidence that it took is what came out in the shadow
 * root. Pierre wraps each changed run in a `[data-diff-span]`, and the *text*
 * of those spans is what the three settings disagree about: `word-alt` marks
 * the whole token, `char` marks only the characters that moved, and `none`
 * emits no span at all.
 *
 * Asserted on `textContent` rather than on markup on purpose. Whether the run
 * inside a span is one element or five depends on whether the shared
 * highlighter has warmed up, which is a property of test ordering rather than
 * of the setting.
 */
describe('DiffColumn, how much of a changed line is marked', () => {
  /**
   * One word inside a line becomes a longer word.
   *
   * `doSomething` → `doSomethingElse`, so the three settings have visibly
   * different answers: the whole token, the four characters added to it, or
   * nothing. The fixture patch elsewhere in this file replaces `before` with
   * `after`, which shares no run long enough to tell them apart.
   */
  const INNER = 'src/inner.ts';
  const innerPatch = [
    `diff --git a/${INNER} b/${INNER}`,
    `--- a/${INNER}`,
    `+++ b/${INNER}`,
    '@@ -1,3 +1,3 @@',
    ' one',
    '-const alpha = doSomething(value);',
    '+const alpha = doSomethingElse(value);',
    ' three',
  ].join('\n');

  const inner = () => file({ path: INNER, patch: innerPatch });

  /** The text of every run Pierre marked as changed within a line. */
  const marked = (path: string): string[] =>
    [...fileShadow(path).querySelectorAll('[data-diff-span]')].map(
      (span) => span.textContent ?? '',
    );

  it('marks whole words by default, which is Pierre’s own answer and ours', async () => {
    mount([inner()]);
    await untilDrawn(INNER);

    expect(marked(INNER)).toContain('doSomething');
  });

  it('marks only the characters that moved when asked for char', async () => {
    // The case the setting exists for: a rename inside a line, where a
    // word-level pass marks the whole token and says nothing about what
    // changed in it.
    mount([inner()], { lineDiff: 'char' });
    await untilDrawn(INNER);

    const runs = marked(INNER);
    expect(runs).toContain('Else');
    expect(runs).not.toContain('doSomething');
  });

  it('marks nothing inside the line when asked for none', async () => {
    // The line is still drawn, and still carries its addition colour. Only the
    // emphasis inside it is gone, which is the claim `Settings.lineDiff` makes
    // about this one hiding nothing.
    mount([inner()], { lineDiff: 'none' });
    await untilDrawn(INNER);

    expect(marked(INNER)).toEqual([]);
    expect(diffHasRendered(INNER)).toBe(true);
  });
});

describe('remembering how markdown is compared', () => {
  // The fake storage area in ui/testSetup.ts lives on globalThis for the whole
  // file. Without this, the first test here decides what every later test in
  // the file sees, and the failure names the wrong test.
  afterEach(async () => {
    await browser.storage.local.remove(MODE_MEMORY_KEY);
  });

  const pressed = (path: string, label: string): string | null =>
    within(card(path)).getByRole('button', { name: label }).getAttribute('aria-pressed');

  it('pressing a mode on one markdown card flips the others', async () => {
    mount([
      file({ path: 'docs/a.md' }),
      file({ path: 'docs/b.md' }),
      file({ path: 'assets/logo.png', isBinary: true }),
    ]);
    // Settles the column's opening read of the preference, which resolves a
    // tick after mount, so what is asserted below is the press rather than a
    // race with it.
    //
    // It is no longer load-bearing: a press made inside that tick used to be
    // undone by the read finishing, and `useModeMemory` now marks itself
    // superseded so the reviewer's own action outranks a read issued before
    // they took it. `ui/useModeMemory.test.tsx` pins that directly.
    await act(async () => {});

    fireEvent.click(within(card('docs/a.md')).getByRole('button', { name: 'Raw' }));

    for (const path of ['docs/a.md', 'docs/b.md']) {
      await waitFor(() => {
        expect(pressed(path, 'Raw')).toBe('true');
      });
    }

    // The rule is Markdown-only. An image in the same column must not move.
    expect(pressed('assets/logo.png', 'Side by side')).toBe('true');
  });

  it('a per-file choice on an unremembered kind still stands alone', async () => {
    mount([
      file({ path: 'assets/a.png', isBinary: true }),
      file({ path: 'assets/b.png', isBinary: true }),
    ]);

    fireEvent.click(within(card('assets/a.png')).getByRole('button', { name: 'Onion skin' }));

    expect(pressed('assets/b.png', 'Side by side')).toBe('true');
  });

  it('a remembered mode decides how the next review opens', async () => {
    await browser.storage.local.set({ [MODE_MEMORY_KEY]: { markdown: 'raw' } });
    mount([file({ path: 'docs/a.md' })]);

    await waitFor(() => {
      expect(pressed('docs/a.md', 'Raw')).toBe('true');
    });
  });
});

/**
 * A press on a card's own control returns the column to that card.
 *
 * Two controls on a card change that card's own height: the mode switcher, and
 * the word saying why a body is being withheld. Both used to leave the column
 * wherever the height change had pushed it, and the second was worse than
 * that — `shown` reaches `drawnFiles`, `drawnFiles` reaches `generation`, and
 * `generation` is the viewer's `key`, so pressing it remounts `CodeView` and
 * scroll goes to zero. A press on the nineteenth file put the reviewer at the
 * top of the first.
 *
 * What is asserted here is the *request*, not where the column ended up. jsdom
 * lays nothing out: every rect is zero, the viewer measures every item as
 * zero-high, and `Element.prototype.scrollTo` is the inert stub `testSetup`
 * installs. So "did the reviewer end up looking at that file" is a question
 * only a browser can answer, and `e2e/` is where it is asked; the honest
 * question here is what the column asked the viewer for.
 *
 * The spy is on the vanilla `CodeView` rather than on the React one, because
 * that is the object the handle delegates to — `@pierre/diffs` and
 * `@pierre/diffs/react` import the same module, so one prototype covers every
 * viewer this file mounts, including the one a remount replaces.
 */
/**
 * Reaching a file the tree asked for, when the viewer is wrong about where it is.
 *
 * The reported bug: clicking a generated file in the tree landed on one of its
 * neighbours. Being generated had nothing to do with it — `CodeView` sizes
 * every card header from one 44px metric and never measures one, and ours are
 * 38px and 70px, so its item offsets are short by the accumulated shortfall of
 * every header above the target. Every file under a card showing a comparison
 * had it.
 *
 * That is a model rather than an estimate, so asking again does not improve it:
 * measured in a browser, a generated file sat 84px down the scrollport and
 * stayed exactly there when the row was pressed four more times. So the column
 * asks once, measures where the card actually landed, and folds the difference
 * into the next ask's `offset`.
 *
 * jsdom reports every rect as zero and so can answer none of "where did it end
 * up". What it can answer is the *shape* of the conversation — how many asks,
 * in what order, carrying what offset — which is where the two mistakes this
 * loop is built around would show: correcting before the viewer has answered,
 * and correcting again before the correction has landed.
 */
describe('DiffColumn, reaching the file the tree picked', () => {
  // Typed through the prototype rather than as a bare `vi.spyOn`, so the
  // filter below reads `target.type` off the real `CodeViewScrollTarget`
  // union instead of off `any`.
  const spyOnScrollTo = () => vi.spyOn(CodeViewCore.prototype, 'scrollTo');
  let scrolls: ReturnType<typeof spyOnScrollTo>;

  beforeEach(() => {
    scrolls = spyOnScrollTo();
  });
  afterEach(() => {
    scrolls.mockRestore();
  });

  const askedFor = (path: string): number =>
    scrolls.mock.calls.filter(
      ([target]) => target.type === 'item' && target.align === 'start' && target.id === path,
    ).length;

  /**
   * Let the retry run itself out, and report what it spent.
   *
   * The loop is driven by `requestAnimationFrame`, so the count right after
   * the first render is one — the attempt made before paint — and everything
   * this describes happens over the frames after it. Waiting until the number
   * stops moving is what makes "kept asking" and "gave up" two assertions
   * about one observed run rather than two guesses about a clock.
   */
  const untilSettled = async (path: string): Promise<number> => {
    let last = -1;
    for (let round = 0; round < 40 && askedFor(path) !== last; round += 1) {
      last = askedFor(path);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    return last;
  };

  const FILES = [
    file({ path: 'src/app.ts' }),
    file({ path: 'src/beta.ts' }),
    file({ path: 'src/gamma.ts' }),
  ];

  it('asks the viewer where the file is, carrying nothing of its own', async () => {
    mount(FILES, { current: { path: 'src/app.ts', origin: 'tree' } });
    await untilDrawn('src/app.ts');
    await untilSettled('src/app.ts');

    const offsets = scrolls.mock.calls.flatMap(([target]) =>
      target.type === 'item' && target.align === 'start' && target.id === 'src/app.ts'
        ? [target.offset ?? 0]
        : [],
    );

    // The order is what this pins, and it is the mistake that makes the fix
    // worse than the bug. A residual read before the viewer has answered is
    // the distance still to travel rather than the error in it, and folding
    // *that* in sent the column a screenful past a file two rows away — far
    // enough that the card was virtualized back out and there was nothing left
    // to correct against. So the first ask carries nothing of ours.
    expect(offsets[0]).toBe(0);
  });

  it('waits for the column to answer rather than asking again', async () => {
    mount(FILES, { current: { path: 'src/app.ts', origin: 'tree' } });
    await untilDrawn('src/app.ts');

    // The other half of the same mistake: correcting again before the last
    // correction has landed folds the same error in twice, and five frames of
    // that is how far past the file the column went.
    //
    // jsdom is a document where nothing ever moves, which makes it exactly the
    // case this rule is about. Two things can change here and no more: the
    // first ask goes out, and the card turns up in the DOM — so two asks is
    // the ceiling, against the twenty-nine a loop that asked every frame would
    // spend. Whether it is one or two is a race with the first render and not
    // worth pinning. What the asks would be once something really moved is a
    // question for a browser, and `e2e/review.spec.ts` walks every file in the
    // column asking it.
    expect(await untilSettled('src/app.ts')).toBeLessThanOrEqual(2);
  });

  it('gives up rather than fighting a reviewer who scrolls away', async () => {
    mount(FILES, { current: { path: 'src/app.ts', origin: 'tree' } });
    await untilDrawn('src/app.ts');

    // A target that never reports as reached is the worst case, and this is
    // that case stopping rather than running on. Bounded by {@link
    // REACH_WINDOW} rather than equal to it, because most of a journey's
    // frames are spent watching rather than scrolling.
    const spent = await untilSettled('src/app.ts');
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(REACH_WINDOW);
  });

  it('asks nothing of a move the column itself made', async () => {
    // The other half of the feedback loop `currentFile.ts` exists to break: a
    // file that reached the top because the reviewer scrolled must not be
    // scrolled back to.
    mount(FILES, { current: { path: 'src/app.ts', origin: 'scroll' } });
    await untilDrawn('src/app.ts');

    expect(await untilSettled('src/app.ts')).toBe(0);
  });
});

describe('DiffColumn, returning to the card that was pressed', () => {
  const spyOnScrollTo = () => vi.spyOn(CodeViewCore.prototype, 'scrollTo');
  let scrolls: ReturnType<typeof spyOnScrollTo>;

  beforeEach(() => {
    // Left calling through: a target the library refuses is not a scroll, and
    // a stub would report one anyway.
    scrolls = spyOnScrollTo();
  });

  afterEach(async () => {
    scrolls.mockRestore();
    // One press below is on a Markdown card, whose mode is a stored preference
    // rather than a per-file choice — and `testSetup` gives the whole file one
    // storage area. See the note on the same hook further up.
    await browser.storage.local.remove(MODE_MEMORY_KEY);
  });

  /** Every file the column asked to be brought to the top, in order. */
  const asked = (): string[] =>
    scrolls.mock.calls.flatMap(([target]) =>
      target.type === 'item' && target.align === 'start' ? [target.id] : [],
    );

  it('asks for nothing until something is pressed', async () => {
    // The effect is driven by a press rather than by a render, and this is
    // what says so: a column that scrolled on mount would fight the tree, the
    // `j` key and the reviewer's own scrolling, all of which arrive as renders.
    mount([file({ path: 'src/app.ts' }), file({ path: 'data/rows.csv' })]);
    await untilDrawn('src/app.ts');

    expect(asked()).toEqual([]);
  });

  it('returns to the file whose comparison mode was pressed', async () => {
    // The CSV first and the plain source file second. Which one is pressed is
    // not free on either axis: a `.ts` file offers one comparison and so has
    // no switcher to press at all, and under this file's zero layout the last
    // card is where the column already is — see the note on the skip test
    // below. The card with the control has to be the one that is not.
    mount([file({ path: 'data/rows.csv' }), file({ path: 'src/app.ts' })]);
    await untilDrawn('src/app.ts');

    await act(async () => {
      fireEvent.click(
        within(card('data/rows.csv')).getByRole('button', { name: 'Raw' }),
      );
    });

    expect(asked()).toContain('data/rows.csv');
  });

  it('asks for nothing when the card pressed is already the one at the top', async () => {
    // The scroll is skipped when it would not move anything, and that is not
    // tidiness. `CodeView.suspendScrollInteractions` puts `pointer-events:
    // none` on the sticky container for 120ms after any scroll it is asked
    // for, and that container holds the card headers — so a pointless scroll
    // spends those 120ms making the very control that was just pressed dead to
    // a second press. Raw and then Grid, faster than the timer, is a reviewer
    // changing their mind at an ordinary speed; `ui/comparisonModes.test.tsx`
    // is where that press pair is driven end to end.
    //
    // "Already at the top" is a measurement, and jsdom reports every rect as
    // zero — which makes `topmostFile` run its whole list without finding one
    // past `REACHED` and settle on the last card registered. That is not a
    // position, it is the absence of one, but it is a *consistent* absence:
    // here the last card is what the column reports itself to be on, so it
    // stands in for the card a browser would report under a real scrollTop.
    mount([file({ path: 'src/app.ts' }), file({ path: 'data/rows.csv' })]);
    await untilDrawn('src/app.ts');

    await act(async () => {
      fireEvent.click(
        within(card('data/rows.csv')).getByRole('button', { name: 'Raw' }),
      );
    });

    expect(asked()).toEqual([]);
  });

  it('returns to the card pressed, not to the others that moved with it', async () => {
    // Markdown is the one kind whose mode is a preference rather than a
    // per-file choice, so this press changes every `.md` card in the column.
    // The card the reviewer is owed is still the one under their finger.
    mount([file({ path: 'docs/a.md' }), file({ path: 'docs/b.md' })]);
    // Settles the column's opening read of the preference, so what is asserted
    // is the press rather than a race with it.
    await act(async () => {});

    await act(async () => {
      fireEvent.click(within(card('docs/a.md')).getByRole('button', { name: 'Raw' }));
    });

    expect(asked()).toContain('docs/a.md');
    expect(asked()).not.toContain('docs/b.md');
  });

  it('returns to the file whose whitespace chip was pressed', async () => {
    // The reported bug. This press remounts the viewer, so the scroll is
    // being asked of an instance that did not exist when the press was made.
    mount(
      [
        file({ path: 'src/app.ts' }),
        file({ path: 'lib/util.ts', patch: REINDENTED('lib/util.ts') }),
      ],
      IGNORING,
    );
    await untilDrawn('lib/util.ts');

    await act(async () => {
      fireEvent.click(
        within(card('lib/util.ts')).getByRole('button', { name: /whitespace hidden/i }),
      );
    });

    expect(asked()).toContain('lib/util.ts');
  });

  it('acts on a second press of the same control', async () => {
    // What the token in `CardReturn` is for. A bare path would be the same
    // value both times and the effect would not re-run, so the press that puts
    // the file back the way it was would leave the reviewer wherever undoing
    // it had pushed them — which is the same bug, one press later.
    mount(
      [
        file({ path: 'src/app.ts' }),
        file({ path: 'lib/util.ts', patch: REINDENTED('lib/util.ts') }),
      ],
      IGNORING,
    );
    await untilDrawn('lib/util.ts');

    const flag = () =>
      within(card('lib/util.ts')).getByRole('button', { name: /whitespace/i });

    await act(async () => {
      fireEvent.click(flag());
    });
    expect(asked()).toContain('lib/util.ts');

    scrolls.mockClear();
    await act(async () => {
      fireEvent.click(flag());
    });

    expect(asked()).toContain('lib/util.ts');
  });

  it('gives up rather than scrolling for as long as the page is open', async () => {
    // The retry is there because the viewer's item offsets are a model of card
    // headers rather than a measurement of them, and a remounted viewer has
    // not measured its items at all yet. A retry with no deadline is an
    // animation-frame loop that would out-argue a reviewer who had started
    // scrolling themselves, so it stops after {@link REACH_WINDOW} frames
    // whether or not the card ever arrived — and in jsdom, where every card
    // measures as sitting at the top and nothing ever moves, it does not.
    mount(
      [
        file({ path: 'src/app.ts' }),
        file({ path: 'lib/util.ts', patch: REINDENTED('lib/util.ts') }),
      ],
      IGNORING,
    );
    await untilDrawn('lib/util.ts');

    await act(async () => {
      fireEvent.click(
        within(card('lib/util.ts')).getByRole('button', { name: /whitespace hidden/i }),
      );
      // Comfortably longer than the window.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const settled = asked().length;
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(REACH_WINDOW);

    // And having stopped, it stays stopped.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(asked().length).toBe(settled);
  });
});

describe('finding the changed sections', () => {
  /** What one file's header says about its sections, or null when it says nothing. */
  const counter = (path: string): string | null =>
    document.querySelector(`[data-hunk-steps="${path}"]`)?.textContent ?? null;

  it('counts the sections on the header of a file that has several', async () => {
    mount([file({ path: 'a.ts', patch: gappedPatch('a.ts') })]);

    await waitFor(() => expect(counter('a.ts')).toMatch(/2 changes|Change \d+ of 2/));
  });

  it('says nothing on the header of a file with a single section', async () => {
    mount([file({ path: 'a.ts' })]);

    await waitFor(() => expect(card('a.ts')).toBeTruthy());
    expect(counter('a.ts')).toBeNull();
  });

  // Counting per file rather than across the review is `positionInFile`, and
  // is tested there, in `lib`, against real numbers. It is deliberately not
  // asserted here: jsdom performs no layout, so which cards `CodeView`
  // virtualizes in is not something this environment decides honestly, and a
  // test that depends on the second card being mounted passes or fails for
  // reasons that have nothing to do with counting. `e2e/review.spec.ts` asks
  // the same question of a real browser.

  it('forgets the sections of a card the reviewer has collapsed', async () => {
    // A collapsed item renders no rows at all, so a section inside one is
    // somewhere `scrollTo` cannot reach — `J` stepped into exactly that and
    // landed on nothing. The counter going quiet is that filter, visible.
    mount([
      file({ path: 'a.ts', patch: gappedPatch('a.ts') }),
      file({ path: 'b.ts', patch: gappedPatch('b.ts') }),
    ]);
    await waitFor(() => expect(counter('a.ts')).not.toBeNull());

    await act(async () => {
      fireEvent.click(
        within(card('a.ts')).getByRole('button', { name: /collapse a\.ts/i }),
      );
    });

    await waitFor(() => expect(counter('a.ts')).toBeNull());
    // And only that card. The other file is untouched.
    expect(counter('b.ts')).not.toBeNull();
  });
});
