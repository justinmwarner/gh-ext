/**
 * Making a pull request's Markdown safe to put in this page.
 *
 * This is the security boundary of the whole rendered-diff feature, so the
 * tests are written as attacks rather than as assertions about configuration.
 * A `.md` file is written by whoever opened the pull request — which, on a
 * public repository, is anyone at all — and it is rendered inside an origin
 * that holds a GitHub token in `chrome.storage.local`. Getting this wrong does
 * not degrade a comparison; it hands over the token.
 *
 * Every test below inspects the resulting DOM rather than the string, because
 * the string is not what runs. An image tag with a comment where its space
 * should be, one with an unquoted attribute, and one with an entity-encoded
 * scheme are all the same element once parsed and three different strings
 * before it — and the parser's opinion is the only one that matters.
 *
 * Named `.tsx` deliberately: the `ui` project only collects `ui/**` + `.test.tsx`,
 * and a file named `.test.ts` here would be silently skipped forever.
 */

import { describe, expect, it } from 'vitest';
import { ANCHOR_ATTRIBUTE } from '@/lib/compare/markdownAnchors';
import { sanitizeMarkdownHtml } from './markdownHtml';

/** The sanitised string, parsed the way the browser will parse it. */
const parse = (unsafe: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = sanitizeMarkdownHtml(unsafe);
  return host;
};

/** Every attribute on every element, as `name=value` pairs. */
const attributesOf = (root: HTMLElement): string[] => {
  const found: string[] = [];
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of element.attributes) {
      found.push(`${attribute.name}=${attribute.value}`);
    }
  }
  return found;
};

const tagsOf = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('*')].map((element) => element.tagName.toLowerCase());

describe('the attacks a .md file can carry', () => {
  it('defuses the image error handler, the classic one', () => {
    const host = parse('<p>hello<img src=x onerror="alert(1)"></p>');

    expect(tagsOf(host)).not.toContain('img');
    expect(attributesOf(host).join(' ')).not.toMatch(/onerror/i);
    // The prose around it is still there. A sanitiser that emptied the document
    // would be safe and useless.
    expect(host.textContent).toContain('hello');
  });

  it('removes a script element and its contents', () => {
    const host = parse('<p>a</p><script>alert(1)</script>');

    expect(tagsOf(host)).not.toContain('script');
    expect(host.textContent).not.toContain('alert');
  });

  it('removes a javascript: href but keeps the link text', () => {
    const host = parse('<a href="javascript:alert(1)">click</a>');

    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    for (const href of hrefs) expect(href.toLowerCase()).not.toContain('javascript:');
    expect(host.textContent).toContain('click');
  });

  it('removes an iframe', () => {
    const host = parse('<iframe src="https://evil.test/"></iframe>');

    expect(tagsOf(host)).not.toContain('iframe');
  });

  it('removes object and embed, which are iframes wearing a hat', () => {
    const host = parse('<object data="x"></object><embed src="y">');

    expect(tagsOf(host)).not.toContain('object');
    expect(tagsOf(host)).not.toContain('embed');
  });

  it('removes inline SVG, which is the rule §3.3 already settled', () => {
    // DOMPurify allows SVG and MathML by default. That default is wrong for
    // this page: the comparison spec decided that SVG from a pull request
    // renders through `<img>` and never inline, precisely so that none of it is
    // ever parsed as part of this document. Naming the html profile is what
    // turns the default off.
    const host = parse('<svg><script>alert(1)</script></svg><svg onload="alert(1)"></svg>');

    expect(tagsOf(host)).not.toContain('svg');
    expect(attributesOf(host).join(' ')).not.toMatch(/onload/i);
  });

  it('removes MathML, for the same reason', () => {
    const host = parse('<math><mtext><table><mglyph><style><!--</style></mglyph></table></mtext></math>');

    expect(tagsOf(host)).not.toContain('math');
  });

  it('removes an event handler from a tag it otherwise keeps', () => {
    const host = parse('<p onmouseover="alert(1)" onclick="alert(2)">text</p>');

    expect(tagsOf(host)).toContain('p');
    const attributes = attributesOf(host).join(' ');
    expect(attributes).not.toMatch(/onmouseover/i);
    expect(attributes).not.toMatch(/onclick/i);
  });

  it('leaves no on* attribute anywhere, whatever the shape of the input', () => {
    // A sweep rather than a list, so that a handler nobody thought of is caught
    // by the same test.
    const host = parse(
      '<p onfocus=alert(1) autofocus>a</p>' +
        '<details ontoggle=alert(1) open>b</details>' +
        '<div onpointerover=alert(1)>c</div>' +
        '<video onerror=alert(1)><source onerror=alert(1)></video>' +
        '<body onload=alert(1)>',
    );

    for (const attribute of attributesOf(host)) {
      expect(attribute).not.toMatch(/^on/i);
    }
  });

  it('removes a style element, which would repaint the whole page', () => {
    // The card body is light DOM, not a shadow root, so a `<style>` from a pull
    // request is a stylesheet for this entire application — enough to hide the
    // real controls and draw convincing fake ones over them.
    const host = parse('<style>body { display: none }</style><p>a</p>');

    expect(tagsOf(host)).not.toContain('style');
  });

  it('removes a style attribute, which is the same attack one element at a time', () => {
    const host = parse(
      '<p style="position:fixed;inset:0;z-index:99999;background:#fff">Sign in again</p>',
    );

    expect(attributesOf(host).join(' ')).not.toMatch(/style=/i);
  });

  it('removes form controls, which are a phishing surface in this origin', () => {
    // A rendered README has no use for an input box, and this page is the one
    // place a fake "your session expired, paste your token" prompt would look
    // completely at home.
    const host = parse(
      '<form action="https://evil.test/"><input name="token"><textarea></textarea>' +
        '<select><option>x</option></select><button>Sign in</button></form>',
    );

    const tags = tagsOf(host);
    for (const tag of ['form', 'input', 'textarea', 'select', 'button']) {
      expect(tags).not.toContain(tag);
    }
  });

  it('removes data attributes, which this page queries by', () => {
    // Not theoretical. `DiffColumn` finds threads with
    // `querySelectorAll('[data-thread]')`, `Shell` finds a reply box with
    // `querySelector('[data-reply-for="…"]')` and casts the result to a
    // textarea. Content that can mint either of those can make the page act on
    // an element a pull request supplied. Exactly one name is exempt, for
    // reasons set out at the bottom of this file and in the config itself.
    const host = parse(
      '<p data-thread="1" data-reply-for="99" data-file-card="src/app.ts">x</p>',
    );

    const attributes = attributesOf(host).join(' ');
    expect(attributes).not.toContain('data-thread');
    expect(attributes).not.toContain('data-reply-for');
    expect(attributes).not.toContain('data-file-card');
  });

  it('removes id, which this page also queries by', () => {
    const host = parse('<p id="view-tab-files">x</p><p id="root">y</p>');

    expect(attributesOf(host).join(' ')).not.toMatch(/(^| )id=/);
  });

  it('survives the shapes that are meant to slip past a naive filter', () => {
    const host = parse(
      '<img src=x onerror=alert(1)//>' +
        '<scr<script>ipt>alert(1)</scr</script>ipt>' +
        '<a href="jav&#x09;ascript:alert(1)">x</a>' +
        '<a href="JaVaScRiPt:alert(1)">y</a>' +
        '<a href="&#106;avascript:alert(1)">z</a>' +
        '<p><![CDATA[<script>alert(1)</script>]]></p>',
    );

    expect(tagsOf(host)).not.toContain('script');
    expect(tagsOf(host)).not.toContain('img');
    for (const anchor of host.querySelectorAll('a')) {
      expect((anchor.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript');
    }
    for (const attribute of attributesOf(host)) expect(attribute).not.toMatch(/^on/i);
  });
});

describe('what has to survive for the mode to be worth having', () => {
  it('keeps the insertion and deletion marks the diff put in', () => {
    // The sanitiser sits downstream of the word diff, so it is holding the only
    // copy of the marks. A configuration that stripped `<ins>`, `<del>` or
    // their classes would leave a rendered preview — the mode this feature
    // exists instead of — and nothing would fail except the point.
    const host = parse(
      '<p>a <del class="diffdel">gone</del> <ins class="diffins">new</ins> ' +
        '<del class="diffmod">old</del><ins class="diffmod">fresh</ins></p>',
    );

    expect(host.querySelectorAll('del')).toHaveLength(2);
    expect(host.querySelectorAll('ins')).toHaveLength(2);
    expect(host.querySelector('ins')?.getAttribute('class')).toBe('diffins');
    expect(host.querySelector('del')?.getAttribute('class')).toBe('diffdel');
  });

  it('keeps the structures a README is made of', () => {
    const host = parse(
      '<h1>T</h1><h2>S</h2><p>text with <strong>bold</strong> and <em>italic</em> and ' +
        '<code>code</code></p><ul><li>a</li></ul><ol><li>b</li></ol>' +
        '<blockquote><p>q</p></blockquote><pre><code>x</code></pre>' +
        '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>' +
        '<hr><a href="https://example.test/page">link</a>',
    );

    const tags = tagsOf(host);
    for (const tag of [
      'h1', 'h2', 'p', 'strong', 'em', 'code', 'ul', 'li', 'ol',
      'blockquote', 'pre', 'table', 'thead', 'tr', 'th', 'tbody', 'td', 'hr', 'a',
    ]) {
      expect(tags).toContain(tag);
    }
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.test/page');
  });

  it('keeps the class the image placeholder is styled by', () => {
    const host = parse('<span class="md-image">Image: logo (a.png)</span>');

    expect(host.querySelector('.md-image')?.textContent).toContain('a.png');
  });

  it('keeps a relative link, which is broken but harmless and honest', () => {
    const host = parse('<a href="./CONTRIBUTING.md">contributing</a>');

    expect(host.querySelector('a')?.getAttribute('href')).toBe('./CONTRIBUTING.md');
  });
});

describe('the anchor attribute', () => {
  it('survives, because the affordance depends on it', () => {
    expect(sanitizeMarkdownHtml(`<p ${ANCHOR_ATTRIBUTE}="n-R1">x</p>`)).toContain(
      ANCHOR_ATTRIBUTE,
    );
  });

  // The reason ALLOW_DATA_ATTR was false, and it must stay true of everything
  // except the one name above. DiffColumn finds threads with [data-thread] and
  // Shell finds a reply box with [data-reply-for] and casts it to a textarea.
  it.each(['data-thread', 'data-reply-for', 'data-file-card', 'data-unanchored'])(
    'still strips %s',
    (attribute) => {
      expect(sanitizeMarkdownHtml(`<p ${attribute}="x">y</p>`)).not.toContain(attribute);
    },
  );

  // One name, matched whole. A future reader reaching for a prefix — so that a
  // second anchor-ish attribute could be added without touching the config —
  // would be handing back most of what `ALLOW_DATA_ATTR: false` was defending,
  // since the page's own queries are all `data-` names too.
  it.each([`${ANCHOR_ATTRIBUTE}-extra`, `x-${ANCHOR_ATTRIBUTE}`, 'data-md'])(
    'admits no name that merely resembles it, such as %s',
    (attribute) => {
      expect(sanitizeMarkdownHtml(`<p ${attribute}="x">y</p>`)).not.toContain(attribute);
    },
  );

  // Admitted, not believed. What the value *says* is checked by `parseAnchor`
  // against a nonce minted after the document was written; this layer's job
  // ends at letting the string through, and a test that asserted otherwise
  // would be asserting the wrong file's promise.
  it('does not judge the value, only the name', () => {
    const forged = sanitizeMarkdownHtml(`<p ${ANCHOR_ATTRIBUTE}="not-a-real-nonce-R7">x</p>`);

    expect(forged).toContain('not-a-real-nonce-R7');
  });
});
