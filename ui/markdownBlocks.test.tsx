/**
 * Cutting a rendered Markdown diff into blocks, and the claim that licenses it.
 *
 * The interesting half of this file is the last describe. The design splits the
 * document **before** the sanitiser rather than after — see `markdownBlocks.ts`
 * for why after would be unsound — so the sanitiser is handed one block at a
 * time instead of one document, and everything downstream rests on those two
 * being the same thing. That was verified on one sample when the design was
 * written, which is not a proof. Here the whole corpus of
 * `markdownHtml.test.tsx` goes through both paths and the resulting trees are
 * compared, along with a set of shapes chosen because they straddle the cut.
 *
 * Named `.tsx` deliberately: the `ui` project only collects `ui/**` +
 * `.test.tsx`, and a file named `.test.ts` here would be silently skipped.
 */

import { describe, expect, it } from 'vitest';
import { compareMarkdown } from '@/lib/compare/markdown';
import { ANCHOR_ATTRIBUTE } from '@/lib/compare/markdownAnchors';
import { markdownBlocks } from './markdownBlocks';
import { sanitizeMarkdownHtml } from './markdownHtml';
import { ATTACKS, DOCUMENTS, EVERY_FIXTURE } from './markdownHtml.fixture';

/** A fixed nonce. A real one is minted per comparison in `RichCompare`. */
const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

describe('markdownBlocks', () => {
  it('gives one entry per top-level element, in order', () => {
    const blocks = markdownBlocks('<h1>A</h1><p>B</p>', NONCE);
    expect(blocks.map((b) => b.html)).toEqual(['<h1>A</h1>', '<p>B</p>']);
  });

  it('reads each block anchor', () => {
    const blocks = markdownBlocks(`<p ${ANCHOR_ATTRIBUTE}="${NONCE}-R7">x</p>`, NONCE);
    expect(blocks[0]?.anchor).toEqual({ side: 'RIGHT', line: 7 });
  });

  it('leaves a forged anchor unanchored', () => {
    const blocks = markdownBlocks(`<p ${ANCHOR_ATTRIBUTE}="forged-R7">x</p>`, NONCE);
    expect(blocks[0]?.anchor).toBeNull();
  });

  it('sanitises each block', () => {
    const blocks = markdownBlocks('<p onclick="x">hi</p><script>bad()</script>', NONCE);
    expect(blocks.map((b) => b.html).join('')).not.toContain('onclick');
    expect(blocks.map((b) => b.html).join('')).not.toContain('<script');
  });

  it('says which blocks the diff marked', () => {
    const blocks = markdownBlocks('<p><ins class="diffins">new</ins></p><p>old</p>', NONCE);
    expect(blocks[0]?.changed).toBe(true);
    expect(blocks[1]?.changed).toBe(false);
  });

  it('does not read an author’s own mark as a change', () => {
    // A `.md` file may contain its own `<ins>`; the sanitiser allows it and it
    // is part of both versions rather than a diff of them. `htmlDiff` writes a
    // class on every mark it makes, which is what tells the two apart.
    const blocks = markdownBlocks('<p><ins>emphasis, in a way</ins></p>', NONCE);
    expect(blocks[0]?.changed).toBe(false);
  });

  it('keeps a block the renderer could give no anchor', () => {
    // A run of raw HTML in a `.md` file is printed verbatim, so there is
    // nowhere to put an attribute and the block gets none — §5.1 of the design.
    // It is still a block. The affordance has to read that as file-level rather
    // than as a control it forgot to draw, and it can only do that if the block
    // is here to be asked.
    const blocks = markdownBlocks('<table><tr><td>hand written</td></tr></table>', NONCE);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.anchor).toBeNull();
    expect(blocks[0]?.html).toContain('hand written');
  });

  it('gives the block text the new document reads, for a blockquote to seed from', () => {
    const blocks = markdownBlocks(
      '<p>The <del class="diffdel">old</del><ins class="diffins">new</ins> way.</p>',
      NONCE,
    );

    // What the reviewer is looking at, not what the diff is made of. A
    // file-level comment quotes the document it was written against.
    expect(blocks[0]?.text).toBe('The new way.');
  });

  it('finds the source of a diagram fence', () => {
    const blocks = markdownBlocks(
      '<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>',
      NONCE,
    );

    expect(blocks[0]?.mermaid).toBe('graph TD\n  A --> B');
  });

  it('leaves every other block with no diagram', () => {
    const blocks = markdownBlocks('<p>prose</p><pre><code>plain()</code></pre>', NONCE);
    expect(blocks.map((b) => b.mermaid)).toEqual([null, null]);
  });

  it('reports a deleted diagram as a fence with nothing to draw', () => {
    // Empty rather than absent: the block is still a diagram, and the thing
    // that says the diagram went is its marked-up source.
    const blocks = markdownBlocks(
      '<pre><code class="language-mermaid"><del class="diffdel">graph TD</del></code></pre>',
      NONCE,
    );

    expect(blocks[0]?.mermaid).toBe('');
  });

  it('keeps text a raw HTML block left outside its own tags', () => {
    // `<div>a</div> and more` is one `html_block`, and the words after the
    // close tag are a text node at the top level. Dropping them would be the
    // rendered mode quietly losing something the author wrote.
    const blocks = markdownBlocks('<div>a</div> and more', NONCE);

    expect(blocks.map((b) => b.html)).toEqual(['<div>a</div>', ' and more']);
  });

  it('drops the whitespace between blocks, which renders as nothing', () => {
    const blocks = markdownBlocks('<p>a</p>\n<p>b</p>\n', NONCE);
    expect(blocks).toHaveLength(2);
  });

  it('gives every block a key of its own', () => {
    const blocks = markdownBlocks('<p>same</p><p>same</p><p>same</p>', NONCE);
    expect(new Set(blocks.map((b) => b.key)).size).toBe(3);
  });
});

describe('a document that has been through the real pipeline', () => {
  const before = '# Title\n\nSome prose.\n\n```mermaid\ngraph TD\n  A --> B\n```\n';
  const after = '# Title\n\nSome other prose.\n\n```mermaid\ngraph TD\n  A --> C\n```\n';

  const blocksOf = (): ReturnType<typeof markdownBlocks> => {
    const comparison = compareMarkdown(before, after, NONCE);
    return markdownBlocks(comparison.unsafeHtml ?? '', comparison.nonce);
  };

  it('anchors each block to the line it was rendered from', () => {
    expect(blocksOf().map((block) => block.anchor)).toEqual([
      { side: 'RIGHT', line: 1 },
      { side: 'RIGHT', line: 3 },
      // The fence, whose anchor `markdown-it` prints on the `<code>` rather
      // than on the `<pre>` — which is why the anchor is looked for on the
      // block and inside it.
      { side: 'RIGHT', line: 5 },
    ]);
  });

  it('marks the blocks the diff touched and leaves the rest alone', () => {
    expect(blocksOf().map((block) => block.changed)).toEqual([false, true, true]);
  });

  it('hands the new version of the diagram over to be drawn', () => {
    expect(blocksOf()[2]?.mermaid).toBe('graph TD\n  A --> C');
  });
});

/**
 * Shapes chosen because they straddle the cut.
 *
 * The corpus below is about attacks; this is about the split itself. Each of
 * these either puts something at the top level that is not an element, or
 * leaves a construct open across a boundary, or uses one of the two
 * foreign-content modes — which is where a parse-and-print round trip is most
 * likely to produce a different tree, because they switch the tokeniser into
 * nesting rules of their own.
 */
const BOUNDARIES: Record<string, string> = {
  foreignContentBetweenBlocks: '<p>a</p><svg><script>alert(1)</script></svg><p>b</p>',
  unclosedAcrossBlocks: '<p>a<p>b<svg onload=alert(1)>',
  foreignContentNestedDeep:
    '<table><tr><td><svg onload="alert(1)"></svg>' +
    '<math><mtext><style><!--</style></mtext></math></td></tr></table>',
  mutationPayloadBesideProse:
    '<math><mtext><table><mglyph><style><!--</style></mglyph></table></mtext></math>' +
    '<p>after</p>',
  textOutsideAnyElement: '<div>a</div> and more',
  inlineRunAtTopLevel: '<div>x</div> trailing <b>bold</b> text',
  commentBetweenBlocks: '<p>a</p><!--<script>alert(1)</script>--><p>b</p>',
  markSpanningTwoBlocks:
    '<p><ins class="diffins">first</ins></p><ins class="diffins">\n</ins>',
};

describe('per-block sanitising and whole-document sanitising agree', () => {
  /**
   * A tree, flattened, so that two of them can be compared by value.
   *
   * Nesting is in it, because a flat list of tags is the same for two documents
   * that put the same elements in different places — and a parser disagreeing
   * about *where* something goes is exactly the failure this is looking for.
   * Attributes are sorted, because their order is a serializer's opinion rather
   * than a fact about the document.
   *
   * Whitespace-only text is left out, and that is the one difference the split
   * is allowed to have: the newlines `markdown-it` writes between blocks are
   * top-level text nodes, they are not elements, and they render as nothing
   * between two block boxes. Text that is not whitespace is compared, because
   * losing any of that would be the rendered mode dropping something silently.
   */
  const shapeOf = (html: string): string[] => {
    const host = document.createElement('div');
    host.innerHTML = html;

    const lines: string[] = [];
    const walk = (parent: Node, depth: number): void => {
      for (const node of parent.childNodes) {
        if (node.nodeType === node.TEXT_NODE) {
          const text = node.nodeValue ?? '';
          if (text.trim() !== '') lines.push(`${depth} #text ${JSON.stringify(text)}`);
          continue;
        }
        if (node.nodeType !== node.ELEMENT_NODE) {
          lines.push(`${depth} #${node.nodeType} ${JSON.stringify(node.nodeValue)}`);
          continue;
        }
        const element = node as Element;
        const attributes = [...element.attributes]
          .map((attribute) => `${attribute.name}="${attribute.value}"`)
          .sort()
          .join(' ');
        lines.push(`${depth} <${element.tagName.toLowerCase()} ${attributes}>`);
        walk(element, depth + 1);
      }
    };

    walk(host, 0);
    return lines;
  };

  /** The document, cut up and sanitised a block at a time, put back together. */
  const throughTheSplit = (unsafe: string): string =>
    markdownBlocks(unsafe, NONCE)
      .map((block) => block.html)
      .join('');

  const named = (label: string, corpus: Record<string, string>): void => {
    describe(label, () => {
      it.each(Object.keys(corpus))('%s comes out the same either way', (key) => {
        const unsafe = corpus[key] ?? '';
        expect(shapeOf(throughTheSplit(unsafe))).toEqual(
          shapeOf(sanitizeMarkdownHtml(unsafe)),
        );
      });
    });
  };

  named('every attack the sanitiser suite carries', { ...ATTACKS });
  named('every document the mode would not be worth having without', { ...DOCUMENTS });
  named('the shapes that straddle a block boundary', BOUNDARIES);
});

describe('nothing reaches the page through the split that could not reach it before', () => {
  /**
   * The same assertions the sanitiser suite makes, made again against the
   * output of the split path.
   *
   * The comparison above would pass if both paths were equally broken, so this
   * is the half that says what "harmless" means: no tag that runs, fetches or
   * navigates, no handler, no scheme that executes, and none of the attribute
   * names this page queries by and then acts on the result of.
   */
  const everything = [...EVERY_FIXTURE, ...Object.values(BOUNDARIES)];

  it.each(everything)('leaves nothing dangerous in %s', (unsafe) => {
    const host = document.createElement('div');
    host.innerHTML = markdownBlocks(unsafe, NONCE)
      .map((block) => block.html)
      .join('');

    const tags = [...host.querySelectorAll('*')].map((element) =>
      element.tagName.toLowerCase(),
    );
    for (const tag of [
      'script', 'iframe', 'object', 'embed', 'svg', 'math', 'style', 'img',
      'form', 'input', 'textarea', 'select', 'button',
    ]) {
      expect(tags).not.toContain(tag);
    }

    for (const element of host.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on/i);
        expect(attribute.name).not.toBe('style');
        expect(attribute.name).not.toBe('id');
        expect(attribute.name).not.toMatch(/^data-(thread|reply-for|file-card|unanchored)$/);
      }
    }

    for (const anchor of host.querySelectorAll('a')) {
      expect((anchor.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript');
    }
  });
});
