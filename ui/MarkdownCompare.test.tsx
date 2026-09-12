/**
 * The rendered Markdown card, and the diagrams in it.
 *
 * `renderMermaid` is mocked throughout. Mermaid measures text with
 * `getBBox` and `getComputedTextLength`, neither of which jsdom implements,
 * so a real draw here would test the mock in the DOM rather than the wiring —
 * and the wiring is what has the decisions in it: which source is drawn,
 * whether the marked-up source stays, and what happens when the draw refuses.
 *
 * Everything above the mock is real: the Markdown is rendered and diffed by
 * the actual pipeline and sanitised by the actual sanitiser.
 *
 * The diagram assertions reach for `.md-diagram-drawn` and `.md-diagram-source`
 * without naming a tag, because the fold class sits on the element holding the
 * source rather than on the `<pre>` itself. A diagram's block is now a picture
 * and a source, and only the source half folds away.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareMarkdown } from '@/lib/compare/markdown';
import { START_REVIEW } from '@/lib/github/mutations';
import type { ReviewThread } from '@/lib/github/types';
import { commentableLines } from '@/lib/review/commentable';
import { DraftStore, type KeyValueStore } from '@/lib/review/drafts';
import { request } from './background';
import { MarkdownCompare } from './MarkdownCompare';
import { memoryStore } from './memoryStore.fixture';
import { renderMermaid } from './mermaid';
import { pullRequestNode, reviewThread } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';
import {
  type ShortcutTargets,
  ShortcutTargetsProvider,
  useShortcutTargets,
} from './shortcutTargets';
import { UnanchoredThreads } from './UnanchoredThreads';

vi.mock('./mermaid', async () => {
  const actual = await vi.importActual<typeof import('./mermaid')>('./mermaid');
  return { ...actual, renderMermaid: vi.fn() };
});

vi.mock('./background', () => ({ request: vi.fn() }));

const renderMock = renderMermaid as unknown as Mock;
const requestMock = request as unknown as Mock;

/** A fixed nonce: these tests are about the card, not about the anchors on it. */
const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

const PATH = 'docs/readme.md';
const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;

beforeEach(() => {
  requestMock.mockReset();
  renderMock.mockReset();
  renderMock.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 300 120"></svg>',
    width: 300,
    height: 120,
  });
});

const DIAGRAM = 'graph TD\n  A[Start] --> B[Stop]';

const doc = (diagram: string, prose = 'Some prose.'): string =>
  `# Title\n\n${prose}\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;

/**
 * The review keyboard, as the shell holds it.
 *
 * `J`, `K` and `c` are claimed by the card rather than handled by the shell, so
 * a test that wants to press one has to be the thing that asks. Captured out of
 * the provider because that is the only way in — the registry is a ref, not
 * state, and nothing renders from it.
 */
let targets: ShortcutTargets | null = null;

function CaptureTargets() {
  targets = useShortcutTargets();
  return null;
}

interface MountOptions {
  path?: string;
  /** Which lines a comment can name. Defaults to none, as an unpatched file. */
  patch?: string;
  threads?: readonly ReviewThread[];
  store?: KeyValueStore;
}

function mount(before: string, after: string, options: MountOptions = {}) {
  const { path = PATH, patch = '', threads = [], store = memoryStore() } = options;
  const view = render(
    <ShortcutTargetsProvider>
      <CaptureTargets />
      <ReviewSessionProvider
        pullRequest={pullRequestNode()}
        prRef={PR_REF}
        threads={[...threads]}
        drafts={new DraftStore(store)}
      >
        <MarkdownCompare
          comparison={compareMarkdown(before, after, NONCE)}
          path={path}
          commentable={commentableLines(patch)}
        />
      </ReviewSessionProvider>
    </ShortcutTargetsProvider>,
  );
  return { ...view, store };
}

const diagram = (): HTMLImageElement | null =>
  document.querySelector('.md-diagram img');

const untilDrawn = () => waitFor(() => expect(diagram()).not.toBeNull());

describe('a Mermaid diagram in a rendered Markdown diff', () => {
  it('is drawn, rather than left as its own source', async () => {
    mount(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));

    await untilDrawn();
    expect(renderMock).toHaveBeenCalledWith(DIAGRAM);
  });

  it('goes into an image rather than into the page', async () => {
    // The rule `markdownHtml.ts` sets out: markup a pull request wrote
    // renders through `<img>`, where SVG is a secure static document, and is
    // never inlined into an origin holding a GitHub token.
    mount(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));

    await untilDrawn();
    expect(diagram()?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(document.querySelector('.markdown-rendered svg')).toBeNull();
  });

  it('reserves the space the picture will take, so the card does not jump', async () => {
    mount(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));

    await untilDrawn();
    expect(diagram()?.getAttribute('width')).toBe('300');
    expect(diagram()?.getAttribute('height')).toBe('120');
  });

  it('hides the source when nothing in the diagram moved', async () => {
    // The source is then the picture written out longhand, and the picture is
    // the better copy.
    mount(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));

    await untilDrawn();
    expect(document.querySelector('.md-diagram-drawn pre')).not.toBeNull();
    expect(document.querySelector('figcaption')).toBeNull();
  });

  it('keeps the marked-up source when the diagram itself changed', async () => {
    // The case the rendered mode would otherwise lose. A drawn diagram
    // carries no `<ins>` or `<del>` and the old version is not on screen, so
    // the source below it is the only place the change is visible.
    const after = DIAGRAM.replace('Stop', 'Carry on');
    mount(doc(DIAGRAM), doc(after));

    await untilDrawn();
    expect(document.querySelector('.md-diagram-source pre')).not.toBeNull();
    expect(document.querySelector('.md-diagram-drawn')).toBeNull();
    expect(document.querySelector('figcaption')?.textContent).toMatch(/source below/i);
    // And the new version is what was drawn.
    expect(renderMock).toHaveBeenCalledWith(after);
  });

  it('draws nothing for a diagram that was deleted', async () => {
    mount(doc(DIAGRAM), '# Title\n\nSome prose.\n');

    await waitFor(() => expect(screen.getByText(/title/i)).toBeDefined());
    expect(renderMock).not.toHaveBeenCalled();
    // Its source is still there, marked as gone, which is what says it went.
    expect(document.querySelector('pre')).not.toBeNull();
  });

  it('explains a diagram it could not draw, and leaves the source up', async () => {
    // A `.md` file in a pull request is entitled to contain a diagram that
    // does not parse. That is a sentence to show, not a card to lose.
    renderMock.mockResolvedValue({
      ok: false,
      reason: 'This diagram could not be drawn: Parse error on line 2.',
    });
    mount(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));

    await waitFor(() => {
      expect(document.querySelector('.md-diagram-error')).not.toBeNull();
    });
    expect(document.querySelector('.md-diagram-error')?.textContent).toMatch(
      /parse error/i,
    );
    expect(document.querySelector('.md-diagram-drawn')).toBeNull();
    expect(document.querySelector('pre')?.textContent).toContain('graph TD');
  });

  it('draws every diagram in the document', async () => {
    const two = (b: string): string =>
      `\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n\ntext\n\n\`\`\`mermaid\n${b}\n\`\`\`\n`;
    mount(two('graph LR\n  C --> D'), two('graph LR\n  C --> E'));

    await waitFor(() => {
      expect(document.querySelectorAll('.md-diagram img')).toHaveLength(2);
    });
  });

  it('asks for nothing at all when the document has no diagram', async () => {
    mount('# Title\n\nSome prose.\n', '# Title\n\nOther prose.\n');

    await waitFor(() => expect(screen.getByText(/title/i)).toBeDefined());
    expect(renderMock).not.toHaveBeenCalled();
  });
});

describe('the document as React sees it', () => {
  it('gives every block an element of its own', async () => {
    // The structural claim the rest of the feature is built on: a thread card
    // or a composer beside one paragraph is an ordinary sibling, not a portal
    // into a placeholder somebody inserted by hand.
    mount('# Title\n\nOne.\n\nTwo.\n', '# Title\n\nOne.\n\nThree.\n');

    await waitFor(() => expect(screen.getByText(/title/i)).toBeDefined());
    const blocks = document.querySelectorAll('.markdown-rendered > .markdown-block');
    expect(blocks).toHaveLength(3);
    // A block is the box now — the markup, the comment button, the threads on
    // it — so its own first child is the content rather than the heading, and
    // the heading is one level further in.
    expect(blocks[0]?.firstElementChild?.className).toBe('markdown-block-content');
    expect(blocks[0]?.querySelector('.markdown-block-content')?.firstElementChild?.tagName).toBe(
      'H1',
    );
  });

  it('keeps a drawn diagram when the document around it is rebuilt', async () => {
    // The failure this rewrite exists to remove, in the only shape a test can
    // reach. The diagrams used to be written into the subtree belonging to a
    // single `dangerouslySetInnerHTML`, and React replaces every child of that
    // element whenever it re-applies the prop — so the figures were wiped
    // moments after they were placed, with no error and no effect re-run, and
    // nothing but a real browser ever showed it.
    //
    // A second comparison of the same two documents differs only in its nonce,
    // which is enough to make every block's markup a new string and have React
    // re-apply all of it. The figure is React's own element now, so it is not
    // inside anything being replaced: it is still on screen in the same tick.
    const { rerender } = mount(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));
    await untilDrawn();

    rerender(
      <ShortcutTargetsProvider>
        <CaptureTargets />
        <ReviewSessionProvider
          pullRequest={pullRequestNode()}
          prRef={PR_REF}
          threads={[]}
          drafts={new DraftStore(memoryStore())}
        >
          <MarkdownCompare
            comparison={compareMarkdown(
              doc(DIAGRAM),
              doc(DIAGRAM, 'Some other prose.'),
              'c4e2d1ef-0000-4000-8000-000000000000',
            )}
            path={PATH}
            commentable={commentableLines('')}
          />
        </ReviewSessionProvider>
      </ShortcutTargetsProvider>,
    );

    expect(diagram()).not.toBeNull();
  });
});

describe('a comparison with nothing to render', () => {
  it('says why instead of drawing an empty card', () => {
    mount('# Same\n', '# Same\n');

    expect(screen.getByRole('note').textContent).toMatch(/render identically/i);
  });
});

/**
 * Commenting on rendered prose, which is what the rest of this feature was for.
 *
 * The documents below are real Markdown through the real pipeline, so the
 * anchors are the ones `htmlDiff` actually emits rather than ones a test made
 * up: `# Title` on line 1, `Alpha.` on line 3, the changed paragraph on line 5,
 * and a hand-written `<table>` that `markdown-it` hands back verbatim and which
 * therefore carries no anchor at all.
 *
 * `PATCH` covers one line, so exactly one block is inside a hunk. That is the
 * shape a README has — a few changed lines in a document of hundreds — rather
 * than a convenience.
 */
const BEFORE = '# Title\n\nAlpha.\n\nTwo.\n\n<table><tr><td>raw</td></tr></table>\n';
const AFTER = '# Title\n\nAlpha.\n\nThree.\n\n<table><tr><td>raw</td></tr></table>\n';
const PATCH = '@@ -5 +5 @@\n-Two.\n+Three.\n';

const affordances = (): HTMLElement[] =>
  screen.getAllByRole('button', { name: /^Comment on/ });

const affordance = (name: RegExp): HTMLElement =>
  screen.getByRole('button', { name });

const box = (): HTMLTextAreaElement =>
  screen.getByRole('textbox', { name: /comment on/i }) as HTMLTextAreaElement;

/**
 * Answer the whole publish path, exactly as `Composer.test.tsx` does.
 *
 * Posting one comment is three round trips, and the first has to be answered
 * specifically or nothing after it ever runs. It is here because the anchor a
 * block hands the composer is not otherwise observable: the box shows the line
 * but never the side, and the side is half of what makes a comment land in the
 * right place.
 */
function answersPublish() {
  requestMock.mockImplementation((msg: { document: string }) =>
    Promise.resolve(
      msg.document === START_REVIEW
        ? {
            ok: true,
            data: {
              data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_x' } } },
            },
          }
        : { ok: true, data: { data: {} } },
    ),
  );
}

/** Which call carried the thread. The publish path puts START_REVIEW ahead of it. */
const threadCall = (): number =>
  requestMock.mock.calls.findIndex((call) => call[0]?.document !== START_REVIEW);

const variablesOf = (call: number): Record<string, unknown> =>
  requestMock.mock.calls[call]?.[0]?.variables ?? {};

/** Write a comment in the open box and send it. */
async function postComment(text: string) {
  answersPublish();
  await userEvent.type(box(), text);
  await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
  await waitFor(() => expect(threadCall()).toBeGreaterThan(-1));
  return variablesOf(threadCall());
}

describe('the comment affordance', () => {
  it('is on every block, including one the renderer gave no anchor', () => {
    // A README with a hand-written table is still a README. A control present
    // on three paragraphs and absent on the fourth reads as a defect, and the
    // reviewer has no way to know the fourth is a raw HTML block.
    mount(BEFORE, AFTER, { patch: PATCH });

    expect(affordances()).toHaveLength(4);
    expect(affordance(/Comment on “raw”/)).toBeDefined();
  });

  it('is out of the tab order, because a README is hundreds of blocks', () => {
    mount(BEFORE, AFTER, { patch: PATCH });

    for (const button of affordances()) {
      expect(button.getAttribute('tabindex')).toBe('-1');
    }
  });
});

describe('the composer a block opens', () => {
  it('carries the block’s own line and side when the diff has that line', async () => {
    mount(BEFORE, AFTER, { patch: PATCH });

    await userEvent.click(affordance(/Comment on “Three\.”/));
    expect(screen.getByText('Line 5')).toBeDefined();

    // The line as shown, and the side — which the box never displays and which
    // decides whether the comment lands on the old file or the new one.
    expect(await postComment('this reads better')).toMatchObject({
      path: PATH,
      line: 5,
      side: 'RIGHT',
    });
  });

  it('falls back to the file for a block outside every hunk, and says so', async () => {
    mount(BEFORE, AFTER, { patch: PATCH });

    await userEvent.click(affordance(/Comment on “Alpha\.”/));

    expect(screen.getByText('Whole file')).toBeDefined();
    expect(screen.getByRole('note').textContent).toMatch(/file as a whole/i);
    // Seeded, so the comment says which paragraph it is about once it is read
    // on github.com with no paragraph beside it.
    expect(box().value).toBe('> Alpha.\n\n');

    const sent = await postComment('this is out of date');
    expect(sent).toMatchObject({ path: PATH, subjectType: 'FILE' });
    expect(sent['line']).toBeUndefined();
  });

  it('treats a block with no anchor exactly as one outside the diff', async () => {
    mount(BEFORE, AFTER, { patch: PATCH });

    await userEvent.click(affordance(/Comment on “raw”/));

    expect(screen.getByText('Whole file')).toBeDefined();
    expect(box().value).toBe('> raw\n\n');
    expect(await postComment('this table needs a header')).toMatchObject({
      path: PATH,
      subjectType: 'FILE',
    });
  });

  it('moves to the block that was pressed, and leaves the draft behind', async () => {
    const store = memoryStore();
    mount(BEFORE, AFTER, { patch: PATCH, store });

    await userEvent.click(affordance(/Comment on “Three\.”/));
    await userEvent.type(box(), 'half a thought');
    await userEvent.click(affordance(/Comment on “Alpha\.”/));

    // One box, on the block that was asked for.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('Whole file')).toBeDefined();
    // And the half-written comment is still somewhere, which is the whole
    // reason the draft store exists.
    await waitFor(async () => {
      expect(await store.get(`draft:PR_kwDOABCD:${PATH}:5:RIGHT`)).toBe('half a thought');
    });
  });
});

describe('threads on a rendered document', () => {
  it('renders under the block whose line they were written on', () => {
    mount(BEFORE, AFTER, {
      patch: PATCH,
      threads: [reviewThread({ path: PATH, line: 5 })],
    });

    const block = affordance(/Comment on “Three\.”/).closest('.markdown-block');
    expect(block?.querySelector('[data-thread]')).not.toBeNull();
    // And nowhere else in the document.
    expect(document.querySelectorAll('[data-thread]')).toHaveLength(1);
  });

  it('leaves an outdated one in the per-file list it is already in', () => {
    // GitHub nulls `line` on an outdated thread and keeps `originalLine`, so
    // there is no line to match a block against — only a guess, and a comment
    // drawn beside prose it was not written about is worse than one listed
    // below. `layoutThreads` calls this `outdated`; the list says why.
    const outdated = reviewThread({ path: PATH, line: null, isOutdated: true });
    render(
      <ShortcutTargetsProvider>
        <ReviewSessionProvider
          pullRequest={pullRequestNode()}
          prRef={PR_REF}
          threads={[outdated]}
          drafts={new DraftStore(memoryStore())}
        >
          <MarkdownCompare
            comparison={compareMarkdown(BEFORE, AFTER, NONCE)}
            path={PATH}
            commentable={commentableLines(PATCH)}
          />
          <UnanchoredThreads path={PATH} threads={[{ thread: outdated, reason: 'outdated' }]} />
        </ReviewSessionProvider>
      </ShortcutTargetsProvider>,
    );

    expect(document.querySelectorAll('[data-thread]')).toHaveLength(1);
    expect(
      document.querySelector('.markdown-rendered [data-thread]'),
    ).toBeNull();
    expect(document.querySelector('.unanchored [data-thread]')).not.toBeNull();
  });
});

describe('the keyboard, on a document that has no hunks', () => {
  const press = (action: 'next-hunk' | 'previous-hunk' | 'comment-on-line'): boolean => {
    let handled = false;
    act(() => {
      handled = targets?.run(action, PATH) ?? false;
    });
    return handled;
  };

  it('steps J through the blocks the diff marked', () => {
    // A changed block is what a hunk is in a rendered document: it is the part
    // of the page the pull request altered, and it is what `J` has always
    // meant. Only the paragraph that moved qualifies here.
    mount(BEFORE, AFTER, { patch: PATCH });

    expect(press('next-hunk')).toBe(true);
    expect(document.activeElement?.closest('.markdown-block')).toBe(
      affordance(/Comment on “Three\.”/).closest('.markdown-block'),
    );
  });

  it('steps K back to where J came from', () => {
    const twoChanges = '# Title\n\nAlpha.\n\nTwo.\n\n<table><tr><td>raw</td></tr></table>\n';
    const after = '# Heading\n\nAlpha.\n\nThree.\n\n<table><tr><td>raw</td></tr></table>\n';
    mount(twoChanges, after, { patch: PATCH });

    press('next-hunk');
    press('next-hunk');
    expect(press('previous-hunk')).toBe(true);
    expect(document.activeElement?.closest('.markdown-block')).toBe(
      affordance(/Comment on “Heading”/).closest('.markdown-block'),
    );
  });

  it('opens the composer on the block c was pressed over', async () => {
    mount(BEFORE, AFTER, { patch: PATCH });

    press('next-hunk');
    expect(press('comment-on-line')).toBe(true);

    await waitFor(() => expect(screen.getByText('Line 5')).toBeDefined());
  });

  it('answers for its own file and nobody else’s', () => {
    mount(BEFORE, AFTER, { patch: PATCH });

    let handled = true;
    act(() => {
      handled = targets?.run('next-hunk', 'src/other.ts') ?? false;
    });
    // The shell falls back to the diff column, which is where every card that
    // is not this one still navigates from.
    expect(handled).toBe(false);
  });
});
