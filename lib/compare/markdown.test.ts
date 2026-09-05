/**
 * Rendering two Markdown documents into one marked-up document.
 *
 * The point of the mode, asserted rather than described: the reader gets the
 * *new* document, formatted, with the words that moved marked where they moved.
 * Not two documents to compare by eye — that is the thing the source diff
 * already does better.
 *
 * The other half of this file is about what deliberately does *not* happen
 * here. This layer produces HTML that a pull request wrote, and it is not safe;
 * the sanitiser runs in `ui/`, last, on the finished string. Several tests
 * below pin that, because a future reader who moves sanitisation earlier to
 * "tidy the seam" would be removing the property the seam exists for.
 */

import { describe, expect, it } from 'vitest';
import { MARKDOWN_LIMITS, compareMarkdown } from './markdown';

const ok = (before: string, after: string): string => {
  const result = compareMarkdown(before, after);
  expect(result.status).toBe('ok');
  return result.unsafeHtml ?? '';
};

describe('the rendered diff', () => {
  it('renders the new document rather than the source of either', () => {
    const html = ok('# Guide\n\nSome text.\n', '# Guide\n\nSome other text.\n');

    expect(html).toContain('<h1>');
    expect(html).toContain('Guide');
    // Not the Markdown, and not a line-oriented diff of it.
    expect(html).not.toContain('# Guide');
    expect(html).not.toContain('@@');
  });

  it('marks a changed word inside the prose that surrounds it', () => {
    const html = ok('The quick brown fox.\n', 'The quick red fox.\n');

    expect(html).toMatch(/<del class="diffmod">brown<\/del>/);
    expect(html).toMatch(/<ins class="diffmod">red<\/ins>/);
    // Still one paragraph, with the unchanged words unmarked around it.
    expect(html).toContain('quick');
    expect(html).toContain('fox');
  });

  it('marks an added paragraph as an insertion', () => {
    const html = ok('One.\n', 'One.\n\nTwo.\n');

    expect(html).toContain('diffins');
    expect(html).toContain('Two');
  });

  it('keeps a removed paragraph visible, marked as a deletion', () => {
    // A rendered *preview* would simply not show it. Showing what left is most
    // of why this mode is worth its bytes.
    const html = ok('One.\n\nTwo.\n', 'One.\n');

    expect(html).toContain('diffdel');
    expect(html).toContain('Two');
  });

  it('says so when nothing rendered differently', () => {
    // Two documents whose Markdown differs only in ways that render the same —
    // here the underline heading and the hash heading — genuinely have no
    // rendered difference, and claiming one would be a lie.
    const result = compareMarkdown('Title\n=====\n', '# Title\n');

    expect(result.status).toBe('unchanged');
  });

  it('renders the structures a README is actually made of', () => {
    const html = ok(
      '# T\n\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n> quoted\n',
      '# T\n\n- a\n- c\n\n| x | y |\n| - | - |\n| 1 | 3 |\n\n```js\nconst a = 2;\n```\n\n> quoted\n',
    );

    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code');
    expect(html).toContain('<blockquote>');
  });
});

describe('images, which must not fetch anything', () => {
  it('names an image instead of loading one', () => {
    // An `<img src="https://attacker.test/x.png">` in a pull request would make
    // this page issue a request the moment a reviewer opened the card, telling
    // a third party who is reviewing what and from which address — inside the
    // origin that holds the token. A relative path, meanwhile, has nothing to
    // resolve against and would draw a broken icon.
    const html = ok('![logo](a.png)\n', '![logo](b.png)\n');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('src=');
    expect(html).toContain('logo');
    // The path is shown as text, which also makes swapping one image for
    // another a change this diff can mark — and it marks the part of the path
    // that moved rather than the whole of it, which two `<img>` tags could
    // never have shown, since the word diff strips attributes before comparing.
    expect(html).toContain('<del class="diffmod">a</del>');
    expect(html).toContain('<ins class="diffmod">b</ins>');
    expect(html).toContain('.png');
  });

  it('shows the whole path when only the caption moved', () => {
    const html = ok('![before](fig.png)\n', '![after](fig.png)\n');

    expect(html).toContain('fig.png');
    expect(html).toContain('<del class="diffmod">before</del>');
    expect(html).toContain('<ins class="diffmod">after</ins>');
  });

  it('escapes what it puts inside the placeholder it builds', () => {
    // The one place this module writes markup of its own rather than passing
    // `marked`'s through. Interpolating an alt text unescaped would hand the
    // word diff a tag to align on instead of the text it was told to show —
    // and while the sanitiser downstream would still refuse to run it, a
    // renderer that manufactures tags out of content is the wrong shape
    // regardless of who cleans up after it.
    const html = ok('![a](x.png)\n', '![<b>bold</b>](y.png)\n');

    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('names a raw HTML image too, not only a Markdown one', () => {
    const result = compareMarkdown('x\n', '<img src="https://evil.test/beacon.gif">\n');

    // This layer does not strip it — the sanitiser does — but the renderer must
    // not be the only thing standing between a `.md` file and a network
    // request, because raw HTML never reaches the renderer at all.
    expect(result.unsafeHtml).toContain('<img');
  });
});

describe('the seam: this layer does not sanitise', () => {
  it('lets a script tag straight through', () => {
    const result = compareMarkdown('# T\n', '# T\n\n<script>alert(1)</script>\n');

    expect(result.unsafeHtml).toContain('<script>');
  });

  it('lets an event handler straight through', () => {
    const result = compareMarkdown('x\n', '<img src=x onerror="alert(1)">\n');

    expect(result.unsafeHtml).toContain('onerror');
  });

  it('lets a javascript: href straight through', () => {
    const result = compareMarkdown('x\n', '[click](javascript:alert(1))\n');

    expect(result.unsafeHtml).toMatch(/javascript:/i);
  });

  it('names the field it returns so that no caller mistakes it for safe', () => {
    // Not a behaviour so much as a promise about the shape. The one thing that
    // stops this HTML reaching the DOM unsanitised is that every use site has
    // to type the word "unsafe" to get at it.
    const result = compareMarkdown('a\n', 'b\n');

    expect(Object.keys(result)).toContain('unsafeHtml');
    expect(Object.keys(result)).not.toContain('html');
  });
});

describe('the ceiling', () => {
  it('refuses a document larger than the source cap without rendering it', () => {
    const huge = `${'word '.repeat(MARKDOWN_LIMITS.maxSourceChars)}\n`;
    const result = compareMarkdown('small\n', huge);

    expect(result.status).toBe('too-large');
    expect(result.unsafeHtml).toBeNull();
    // The *reason* is asserted, not merely that there is one. Both gates refuse
    // an oversized document and either would catch this input, so a test that
    // checked only the status would still pass with the source gate deleted —
    // and the point of the source gate is that it refuses *before* paying to
    // render, not that it refuses at all.
    expect(result.reason).toMatch(/too large to render/);
  });

  it('refuses a document whose rendered form is too large, even from small source', () => {
    // Markdown expands, and not predictably: a table of one-character cells
    // renders to several times its source, so the source gate alone would let
    // through exactly the documents whose *rendered* size is what the word diff
    // then has to walk.
    const rows = Math.ceil(MARKDOWN_LIMITS.maxRenderedChars / 30);
    const table = `| a | b |\n| - | - |\n${'| 1 | 2 |\n'.repeat(rows)}`;
    const result = compareMarkdown('x\n', table);

    // Comfortably inside the source cap, which is the whole point of the case.
    expect(table.length).toBeLessThan(MARKDOWN_LIMITS.maxSourceChars);
    expect(result.status).toBe('too-large');
    expect(result.reason).toMatch(/renders to more/);
    expect(result.unsafeHtml).toBeNull();
  });

  it('declines a document built to make the word diff quadratic', () => {
    // Inside every size limit and still ruinous: the cost is in how many words
    // collide, not in how many there are. See the budget in `htmlDiff`.
    const before = `${'word '.repeat(7000)}\n`;
    const after = `${'word '.repeat(7000)}x\n`;

    const started = Date.now();
    const result = compareMarkdown(before, after);

    expect(result.status).toBe('too-complex');
    expect(result.unsafeHtml).toBeNull();
    expect(result.reason).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('has bounds that are exported and can be argued with', () => {
    expect(MARKDOWN_LIMITS.maxSourceChars).toBeGreaterThan(0);
    expect(MARKDOWN_LIMITS.maxRenderedChars).toBeGreaterThan(0);
  });

  it('renders a document the size of this repository README comfortably', () => {
    const section = (i: number): string =>
      `## Heading ${i}\n\nA paragraph of ordinary prose numbered ${i}, with a [link](https://x.test/${i}) in it.\n\n- point ${i}\n- another ${i}\n\n`;
    let before = '';
    let after = '';
    for (let i = 0; i < 40; i += 1) {
      before += section(i);
      after += i === 12 ? section(i).replace('ordinary', 'extraordinary') : section(i);
    }

    const result = compareMarkdown(before, after);

    expect(result.status).toBe('ok');
    expect(result.unsafeHtml).toContain('extraordinary');
  });
});
