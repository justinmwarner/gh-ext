/**
 * Two Markdown documents, rendered into one with the changes marked inside it.
 *
 * `.md` is the most common non-code file in a pull request and until now it got
 * nothing but the text diff. The obvious replacement — render both sides and
 * put them next to each other — is worse than what it replaces: two blocks of
 * formatted prose have to be compared by eye, and the source diff at least
 * paints the words that moved. Formatting *removes* the marks.
 *
 * So the mode is a rendered **diff**. The new document, formatted the way the
 * reader will eventually see it, with insertions and deletions marked where
 * they happened — which is the one arrangement that keeps the formatting and
 * the marks at the same time. Three steps: render both sides with `marked`,
 * word-diff the two HTML strings with the vendored `htmlDiff`, and hand the
 * result to `ui/` to be sanitised and shown.
 *
 * **The output of this module is not safe and its type name says so.** The
 * document came from a pull request, which anyone can open, and this page runs
 * in an origin holding a GitHub token in `chrome.storage.local`. The sanitiser
 * runs in `ui/`, on the finished string, immediately before it reaches the DOM.
 *
 * That ordering is the whole design and it is the opposite of the obvious one.
 * Sanitising each side *before* diffing would look tidier and would be wrong:
 * the diff step afterwards injects tags into the token stream and can splice
 * them in the middle of anything, so it would be constructing new markup out of
 * markup that had already been declared safe — and the thing that declared it
 * safe would no longer be looking. Sanitisation has to be the last thing that
 * happens to a string before the DOM sees it, or it is not sanitisation.
 *
 * This module is pure, and that is the reason the sanitiser is not in it rather
 * than an accident of layout: DOMPurify needs a `Document` to parse into, and
 * `lib/` has no DOM. The seam falls exactly where the security boundary does.
 *
 * Everything is bounded. See `MARKDOWN_LIMITS` for the two input caps and
 * `HTML_DIFF_BUDGET` in `./htmlDiff` for the one that catches what a size
 * cannot predict.
 */

import { Marked } from 'marked';
import { diffHtml } from './htmlDiff/htmlDiff';

export interface MarkdownLimits {
  /**
   * Source characters per side, checked before anything is rendered.
   *
   * Sixty-four kilobytes is an enormous Markdown file — five times this
   * repository's README and twice the comparison spec beside it — and the
   * cheapest possible gate, since it is a `length` on a string already in hand.
   */
  maxSourceChars: number;
  /**
   * Rendered characters per side, checked after rendering and before diffing.
   *
   * Markdown expands, and not by a predictable amount: a table of one-character
   * cells renders to roughly nine times its source, so the source gate alone
   * would let through documents whose rendered form is the thing that costs.
   * Rendering is linear and fast — 71 ms for 119,000 characters — so measuring
   * it before deciding is affordable, and the expensive step is the one after.
   */
  maxRenderedChars: number;
}

export const MARKDOWN_LIMITS: MarkdownLimits = {
  maxSourceChars: 64_000,
  maxRenderedChars: 80_000,
};

export type MarkdownStatus = 'ok' | 'unchanged' | 'too-large' | 'too-complex';

export interface MarkdownComparison {
  status: MarkdownStatus;
  /**
   * The rendered, marked-up document — **unsanitised**.
   *
   * Null unless the status is `ok`. The name is the guard rail: there is no
   * type that can stop a caller writing this into `innerHTML`, so instead
   * every caller has to type the word.
   */
  unsafeHtml: string | null;
  /** Why there is no comparison, in a sentence. Null when there is one. */
  reason: string | null;
}

/**
 * The renderer, configured once.
 *
 * A `Marked` instance rather than the global `marked.use`, which mutates
 * process-wide state that a test — or another feature added later — would then
 * inherit without asking for it.
 */
const renderer = new Marked({
  // GitHub Flavoured Markdown: tables, task lists, strikethrough, autolinks.
  // These are what a repository's documentation is actually written in.
  gfm: true,
  // Off, matching how GitHub renders a `.md` *file*: a single newline is a
  // wrap, not a line break. On, every re-wrapped paragraph in a pull request
  // would show as a structural change.
  breaks: false,
  // Synchronous, so `parse` returns a string rather than a promise. Nothing
  // here is async and the caller renders inside React.
  async: false,
  renderer: {
    /**
     * An image is named, never loaded.
     *
     * Two reasons, and the first is the serious one. An absolute `src` in a
     * `.md` file makes this page fetch from a third party the instant a
     * reviewer opens the card — announcing who is reviewing which pull request,
     * from which address, from inside the extension origin. It is the quietest
     * possible way to get a signal out of a review tool and it needs no script
     * at all. Second, a relative `src` — which is most of them — has no base to
     * resolve against here and would draw a broken icon.
     *
     * Naming the file instead has a benefit beyond the two costs it avoids:
     * swapping one image for another becomes a text change, which is something
     * this diff can mark. Two `<img>` tags with different `src` attributes are
     * invisible to a word diff that strips attributes before comparing.
     *
     * This is the same trade §3.3 of the comparison spec made for SVG, one step
     * further along: there, markup renders through `<img>` because `<img>` runs
     * no script and fetches nothing beyond itself; here even that fetch is more
     * than a prose diff needs.
     */
    image({ href, text, title }): string {
      const label = text !== '' ? text : (title ?? '');
      const named = label !== '' ? `${label} (${href})` : href;
      return `<span class="md-image">Image: ${escapeHtml(named)}</span>`;
    },
  },
});

/**
 * Escape for a text position in HTML.
 *
 * Belt and braces: the sanitiser downstream would catch anything this let
 * through, but the string being built here is the one place this module writes
 * markup of its own, and a renderer override that interpolates an attacker's
 * `alt` text into it unescaped would be handing the diff step a tag to work
 * with rather than the text it was told to show.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const tooLarge = (reason: string): MarkdownComparison => ({
  status: 'too-large',
  unsafeHtml: null,
  reason,
});

/**
 * Render both sides and mark the difference between them.
 *
 * Nulls are accepted and read as empty, though the mode is not offered for a
 * one-sided change — see `modes.ts`, where `markdown:rendered` is marked
 * `needsBothSides`, because a document with every word marked as inserted is a
 * rendered preview wearing a diff's clothes.
 */
export function compareMarkdown(
  before: string | null,
  after: string | null,
): MarkdownComparison {
  const source = { before: before ?? '', after: after ?? '' };

  if (
    source.before.length > MARKDOWN_LIMITS.maxSourceChars ||
    source.after.length > MARKDOWN_LIMITS.maxSourceChars
  ) {
    return tooLarge(
      'This document is too large to render and mark up here. Raw shows the ' +
        'change as GitHub sent it.',
    );
  }

  let rendered: { before: string; after: string };
  try {
    rendered = {
      before: renderer.parse(source.before) as string,
      after: renderer.parse(source.after) as string,
    };
  } catch {
    // `marked` is forgiving by design and there is no such thing as invalid
    // Markdown, so this is close to unreachable — but "close to" is not a
    // reason to let one file take the whole column down.
    return {
      status: 'too-complex',
      unsafeHtml: null,
      reason:
        'This document could not be rendered. Raw shows the change as GitHub ' +
        'sent it.',
    };
  }

  if (
    rendered.before.length > MARKDOWN_LIMITS.maxRenderedChars ||
    rendered.after.length > MARKDOWN_LIMITS.maxRenderedChars
  ) {
    return tooLarge(
      'This document renders to more than can be marked up here. Raw shows ' +
        'the change as GitHub sent it.',
    );
  }

  // Compared after rendering, not before. Two documents whose source differs
  // only where it does not matter — a setext heading rewritten with hashes,
  // trailing whitespace, a reordered link reference — are genuinely the same
  // document, and saying so is more useful than marking nothing in a wall of
  // prose and leaving the reader to work out that nothing is what was meant.
  if (rendered.before === rendered.after) {
    return {
      status: 'unchanged',
      unsafeHtml: null,
      reason:
        'These two versions render identically. The difference between them is ' +
        'in the Markdown rather than in the document.',
    };
  }

  const marked = diffHtml(rendered.before, rendered.after);
  if (marked === null) {
    return {
      status: 'too-complex',
      unsafeHtml: null,
      reason:
        'Marking up the differences in this document ran past its budget, so ' +
        'there is no complete answer to show. Raw shows the change as GitHub ' +
        'sent it.',
    };
  }

  return { status: 'ok', unsafeHtml: marked, reason: null };
}
