/**
 * Recovering a diagram's source from a rendered Markdown diff.
 *
 * The whole feature turns on this being exact. A diagram is drawn from the
 * source these functions reconstruct, so a stray non-breaking space or a word
 * left in from the old version is not a cosmetic slip — Mermaid either draws
 * the wrong picture or refuses to draw one, and the reviewer is looking at a
 * diagram that does not match the file.
 *
 * So the inputs here are real output: the Markdown is rendered and diffed by
 * the actual pipeline, and what comes out is fed to the sanitiser and parsed,
 * exactly as `MarkdownCompare` does it.
 */

import { describe, expect, it } from 'vitest';
import { compareMarkdown } from '@/lib/compare/markdown';
import { mermaidBlocks, sideText } from './mermaidBlocks';
import { sanitizeMarkdownHtml } from './markdownHtml';

const DIAGRAM = `graph TD
  A[Start] --> B{Choice}
  B -->|yes| C[Do it]
  B -->|no| D[Stop]`;

const doc = (diagram: string, prose = 'Some prose.'): string =>
  `# Title\n\n${prose}\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\nAfter.\n`;

/** Run the real pipeline, then parse it the way the card does. */
function rendered(before: string, after: string): HTMLElement {
  const comparison = compareMarkdown(before, after);
  expect(comparison.status).toBe('ok');
  const host = document.createElement('div');
  host.innerHTML = sanitizeMarkdownHtml(comparison.unsafeHtml ?? '');
  return host;
}

describe('mermaidBlocks', () => {
  it('finds the diagram and hands back its source unchanged', () => {
    const host = rendered(doc(DIAGRAM), doc(DIAGRAM, 'Some other prose.'));

    const [block] = mermaidBlocks(host);
    expect(block?.source).toBe(DIAGRAM);
    // Nothing inside it moved, so the picture is the whole story.
    expect(block?.changed).toBe(false);
  });

  it('reconstructs the new source when the diagram itself changed', () => {
    // The case the reconstruction exists for. By this point the block holds
    // both versions interleaved, so its text is neither one of them.
    const after = DIAGRAM.replace('Do it', 'Do it twice');
    const host = rendered(doc(DIAGRAM), doc(after));

    const [block] = mermaidBlocks(host);
    expect(block?.source).toBe(after);
    expect(block?.changed).toBe(true);
  });

  it('leaves no non-breaking space where the diff marked a word', () => {
    // `htmlDiff` writes a marked run's leading space as `&nbsp;` so it cannot
    // collapse against the tag before it. Left in, `A --> B` becomes
    // `A --> B` and Mermaid draws the wrong thing or nothing at all.
    const after = DIAGRAM.replace('Do it', 'Do it twice');
    const host = rendered(doc(DIAGRAM), doc(after));

    const [block] = mermaidBlocks(host);
    expect(block?.source).not.toContain(' ');
    expect(block?.source).toContain('Do it twice');
  });

  it('reads a diagram that is entirely new', () => {
    const host = rendered(doc('graph TD\n  A --> B'), doc(DIAGRAM));

    expect(mermaidBlocks(host)[0]?.source).toBe(DIAGRAM);
  });

  it('hands back nothing to draw for a diagram that was removed', () => {
    // Every word of it is inside a `<del>`. There is no new version to draw,
    // and the marked-up source left on screen is what says it went.
    const host = rendered(doc(DIAGRAM), '# Title\n\nSome prose.\n\nAfter.\n');

    for (const block of mermaidBlocks(host)) expect(block.source).toBe('');
  });

  it('finds every diagram in the document, in order', () => {
    const two = (a: string, b: string): string =>
      `\`\`\`mermaid\n${a}\n\`\`\`\n\ntext\n\n\`\`\`mermaid\n${b}\n\`\`\`\n`;
    const host = rendered(
      two('graph TD\n  A --> B', 'graph LR\n  C --> D'),
      two('graph TD\n  A --> B', 'graph LR\n  C --> E'),
    );

    const blocks = mermaidBlocks(host);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.source).toBe('graph TD\n  A --> B');
    expect(blocks[1]?.source).toBe('graph LR\n  C --> E');
  });

  it('ignores a code block in another language', () => {
    const host = rendered(
      '# T\n\n```ts\nconst a = 1;\n```\n\ntext\n',
      '# T\n\n```ts\nconst a = 2;\n```\n\ntext\n',
    );

    expect(mermaidBlocks(host)).toEqual([]);
  });

  it('matches the fence however the language was cased', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<pre><code class="language-Mermaid">graph TD\n  A --&gt; B</code></pre>';

    expect(mermaidBlocks(host)[0]?.source).toBe('graph TD\n  A --> B');
  });
});

describe('sideText', () => {
  it('keeps markup the document wrote, and drops only the diff’s own', () => {
    // A `.md` file may contain its own `<ins>`; the sanitiser allows it
    // through. It belongs to both versions, so treating it as a diff mark
    // would delete part of the document from one side of the comparison.
    const host = document.createElement('div');
    host.innerHTML =
      '<p>kept <ins>by the author</ins>' +
      '<ins class="diffins">, added</ins>' +
      '<del class="diffdel">, removed</del></p>';

    expect(sideText(host, 'DEL')).toBe('kept by the author, added');
    expect(sideText(host, 'INS')).toBe('kept by the author, removed');
  });
});
