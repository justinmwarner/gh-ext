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

import { render, screen, waitFor } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareMarkdown } from '@/lib/compare/markdown';
import { MarkdownCompare } from './MarkdownCompare';
import { renderMermaid } from './mermaid';

vi.mock('./mermaid', async () => {
  const actual = await vi.importActual<typeof import('./mermaid')>('./mermaid');
  return { ...actual, renderMermaid: vi.fn() };
});

const renderMock = renderMermaid as unknown as Mock;

/** A fixed nonce: these tests are about the card, not about the anchors on it. */
const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

beforeEach(() => {
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

function mount(before: string, after: string) {
  return render(<MarkdownCompare comparison={compareMarkdown(before, after, NONCE)} />);
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
    expect(blocks[0]?.firstElementChild?.tagName).toBe('H1');
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
      <MarkdownCompare
        comparison={compareMarkdown(
          doc(DIAGRAM),
          doc(DIAGRAM, 'Some other prose.'),
          'c4e2d1ef-0000-4000-8000-000000000000',
        )}
      />,
    );

    expect(diagram()).not.toBeNull();
  });
});

describe('a comparison with nothing to render', () => {
  it('says why instead of drawing an empty card', () => {
    render(
      <MarkdownCompare
        comparison={compareMarkdown('# Same\n', '# Same\n', NONCE)}
      />,
    );

    expect(screen.getByRole('note').textContent).toMatch(/render identically/i);
  });
});
