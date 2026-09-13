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
 * The strings themselves live in `./markdownHtml.fixture.ts` rather than in
 * this file, and that is not tidiness. `markdownBlocks.test.tsx` runs the same
 * corpus through the per-block split — where the document is cut into its
 * top-level elements and each one is sanitised on its own — and the whole of
 * that design rests on the two paths agreeing. Sharing the strings is what
 * stops an attack added here from being one the split path never sees.
 *
 * Named `.tsx` deliberately: the `ui` project only collects `ui/**` + `.test.tsx`,
 * and a file named `.test.ts` here would be silently skipped forever.
 */

import { describe, expect, it } from 'vitest';
import { ANCHOR_ATTRIBUTE } from '@/lib/compare/markdownAnchors';
import { sanitizeMarkdownHtml } from './markdownHtml';
import { ATTACKS, DOCUMENTS } from './markdownHtml.fixture';

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
    const host = parse(ATTACKS.imageErrorHandler);

    expect(tagsOf(host)).not.toContain('img');
    expect(attributesOf(host).join(' ')).not.toMatch(/onerror/i);
    // The prose around it is still there. A sanitiser that emptied the document
    // would be safe and useless.
    expect(host.textContent).toContain('hello');
  });

  it('removes a script element and its contents', () => {
    const host = parse(ATTACKS.scriptElement);

    expect(tagsOf(host)).not.toContain('script');
    expect(host.textContent).not.toContain('alert');
  });

  it('removes a javascript: href but keeps the link text', () => {
    const host = parse(ATTACKS.javascriptHref);

    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    for (const href of hrefs) expect(href.toLowerCase()).not.toContain('javascript:');
    expect(host.textContent).toContain('click');
  });

  it('removes an iframe', () => {
    const host = parse(ATTACKS.iframe);

    expect(tagsOf(host)).not.toContain('iframe');
  });

  it('removes object and embed, which are iframes wearing a hat', () => {
    const host = parse(ATTACKS.objectAndEmbed);

    expect(tagsOf(host)).not.toContain('object');
    expect(tagsOf(host)).not.toContain('embed');
  });

  it('removes inline SVG, which is the rule §3.3 already settled', () => {
    // DOMPurify allows SVG and MathML by default. That default is wrong for
    // this page: the comparison spec decided that SVG from a pull request
    // renders through `<img>` and never inline, precisely so that none of it is
    // ever parsed as part of this document. Naming the html profile is what
    // turns the default off.
    const host = parse(ATTACKS.inlineSvg);

    expect(tagsOf(host)).not.toContain('svg');
    expect(attributesOf(host).join(' ')).not.toMatch(/onload/i);
  });

  it('removes MathML, for the same reason', () => {
    const host = parse(ATTACKS.mathMl);

    expect(tagsOf(host)).not.toContain('math');
  });

  it('removes an event handler from a tag it otherwise keeps', () => {
    const host = parse(ATTACKS.eventHandlers);

    expect(tagsOf(host)).toContain('p');
    const attributes = attributesOf(host).join(' ');
    expect(attributes).not.toMatch(/onmouseover/i);
    expect(attributes).not.toMatch(/onclick/i);
  });

  it('leaves no on* attribute anywhere, whatever the shape of the input', () => {
    // A sweep rather than a list, so that a handler nobody thought of is caught
    // by the same test.
    const host = parse(ATTACKS.everyShapeOfHandler);

    for (const attribute of attributesOf(host)) {
      expect(attribute).not.toMatch(/^on/i);
    }
  });

  it('removes a style element, which would repaint the whole page', () => {
    // The card body is light DOM, not a shadow root, so a `<style>` from a pull
    // request is a stylesheet for this entire application — enough to hide the
    // real controls and draw convincing fake ones over them.
    const host = parse(ATTACKS.styleElement);

    expect(tagsOf(host)).not.toContain('style');
  });

  it('removes a style attribute, which is the same attack one element at a time', () => {
    const host = parse(ATTACKS.styleAttribute);

    expect(attributesOf(host).join(' ')).not.toMatch(/style=/i);
  });

  it('removes form controls, which are a phishing surface in this origin', () => {
    // A rendered README has no use for an input box, and this page is the one
    // place a fake "your session expired, paste your token" prompt would look
    // completely at home.
    const host = parse(ATTACKS.formControls);

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
    const host = parse(ATTACKS.dataAttributes);

    const attributes = attributesOf(host).join(' ');
    expect(attributes).not.toContain('data-thread');
    expect(attributes).not.toContain('data-reply-for');
    expect(attributes).not.toContain('data-file-card');
  });

  it('removes id, which this page also queries by', () => {
    const host = parse(ATTACKS.ids);

    expect(attributesOf(host).join(' ')).not.toMatch(/(^| )id=/);
  });

  it('survives the shapes that are meant to slip past a naive filter', () => {
    const host = parse(ATTACKS.naiveFilterBypasses);

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
    const host = parse(DOCUMENTS.diffMarks);

    expect(host.querySelectorAll('del')).toHaveLength(2);
    expect(host.querySelectorAll('ins')).toHaveLength(2);
    expect(host.querySelector('ins')?.getAttribute('class')).toBe('diffins');
    expect(host.querySelector('del')?.getAttribute('class')).toBe('diffdel');
  });

  it('keeps the structures a README is made of', () => {
    const host = parse(DOCUMENTS.readmeStructures);

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
    const host = parse(DOCUMENTS.imagePlaceholder);

    expect(host.querySelector('.md-image')?.textContent).toContain('a.png');
  });

  it('keeps a relative link, which is broken but harmless and honest', () => {
    const host = parse(DOCUMENTS.relativeLink);

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
