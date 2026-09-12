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
 * the marks at the same time. Three steps: render both sides with
 * `markdown-it`, word-diff the two HTML strings with the vendored `htmlDiff`,
 * and hand the result to `ui/` to be sanitised and shown.
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

import MarkdownIt from 'markdown-it';
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
 * An instance of its own rather than a shared module-level default, which would
 * mutate process-wide state that a test — or another feature added later —
 * would then inherit without asking for it. The rules installed below belong to
 * this module.
 *
 * `markdown-it` rather than `marked`, for three reasons set out in §3 and §4 of
 * the Markdown review design. Two of them are defects `marked` rendered on the
 * page: `~~struck~~` came out as `<del>`, the very tag `htmlDiff` marks
 * deletions with, so a word an author struck through was painted — and, because
 * `<del>` carries its meaning to a screen reader, *announced* — as a word the
 * diff had removed; and a ticked checkbox came out as an attribute on an
 * `<input>`, which the word diff strips and the sanitiser forbids, so ticking a
 * box rendered as no change at all. The third is `token.map`, a source line
 * range carried on every block token, which is what anchoring a comment to a
 * paragraph of rendered prose needs and what `marked` carries nothing of.
 */
const renderer = new MarkdownIt({
  // Raw HTML in a `.md` file is passed through and sanitised downstream, which
  // is what GitHub does and what a README expects. `ui/markdownHtml.ts` is the
  // gate; turning this off here would silently change how documents render
  // without making anything safer.
  html: true,
  // Bare URLs become links, which is half of what `gfm: true` meant before.
  linkify: true,
  // Off, matching how GitHub renders a `.md` *file*: a single newline is a
  // wrap, not a line break. On, every re-wrapped paragraph in a pull request
  // would show as a structural change.
  breaks: false,
  // No smart quotes. A typographic substitution the author did not write is a
  // character this diff would mark as changed.
  typographer: false,
});

/**
 * An image is named, never loaded.
 *
 * Two reasons, and the first is the serious one. An absolute `src` in a `.md`
 * file makes this page fetch from a third party the instant a reviewer opens
 * the card — announcing who is reviewing which pull request, from which
 * address, from inside the extension origin. It is the quietest possible way to
 * get a signal out of a review tool and it needs no script at all. Second, a
 * relative `src` — which is most of them — has no base to resolve against here
 * and would draw a broken icon.
 *
 * Naming the file instead has a benefit beyond the two costs it avoids:
 * swapping one image for another becomes a text change, which is something this
 * diff can mark. Two `<img>` tags with different `src` attributes are invisible
 * to a word diff that strips attributes before comparing.
 *
 * This is the same trade §3.3 of the comparison spec made for SVG, one step
 * further along: there, markup renders through `<img>` because `<img>` runs no
 * script and fetches nothing beyond itself; here even that fetch is more than a
 * prose diff needs.
 */
renderer.renderer.rules.image = (tokens, index): string => {
  const token = tokens[index];
  if (token === undefined) return '';
  // `attrGet` is typed `string | number | null` — `attrSet` accepts a number
  // and nothing narrows it back — so the coercions here are not redundant.
  const href = String(token.attrGet('src') ?? '');
  const label = renderer.renderer.renderInlineAsText(
    token.children ?? [],
    renderer.options,
    {},
  );
  const title = String(token.attrGet('title') ?? '');
  const named = label !== '' ? label : title;
  const text = named !== '' ? `${named} (${href})` : href;
  return `<span class="md-image">Image: ${escapeHtml(text)}</span>`;
};

/**
 * The anchor and the trailing `\s+` are both load-bearing, and between them say
 * "at the start of the item, and followed by a space". That is GitHub's own
 * rule, and it is what keeps a bracket pair somebody wrote mid-sentence from
 * being redrawn as a checkbox.
 */
const TASK_MARKER = /^\[([ xX])\]\s+/;

/**
 * A task list's checkbox is a character, not a control.
 *
 * `markdown-it` has no task list rule at all, so `- [x] ship it` already
 * arrives here as the literal text `[x] ship it`. That on its own is what fixes
 * §3.1 of the design — the state is in the text, where the word diff can see
 * it, rather than in an attribute the diff strips and the sanitiser then
 * discards along with the `<input>` carrying it. The renderer swap fixed that
 * defect; this rule did not.
 *
 * What this rule adds is that the marker reads as the control it stands in for
 * rather than as a bracket pair somebody happened to type, and that `[X]` and
 * `[x]` are one document rather than two — the same judgement `compareMarkdown`
 * makes further down when it compares the rendered forms rather than the
 * source, because a difference that changes no document is not worth marking.
 *
 * It is the image rule's argument one more time. State kept in an attribute is
 * invisible to a word diff that strips attributes before comparing, and text is
 * not; a checkbox has the additional problem that `ui/markdownHtml.ts` forbids
 * `input` outright, so no checkbox could reach the page even if one were drawn.
 *
 * A plugin exists and was refused. `markdown-it-task-lists` 2.1.1 was last
 * modified in 2022 — the dormant-package-with-a-live-publish-key shape this
 * project already turned down for `toml` and for `htmldiff-js` — and what it
 * draws is the `<input>` this page cannot use.
 *
 * The marker is written the way the author wrote it: `[ ]` and `[x]`, ASCII. A
 * ballot box, U+2610 and U+2611, was the obvious alternative and was rejected
 * twice over. It depends on a symbol font a reviewer may not have, and it would
 * make this view disagree with the Raw view beside it, in a card whose point is
 * that you can flip between the two and see the same document. Written as
 * brackets, the diff marks the one character that carries the state and leaves
 * the brackets around it still.
 *
 * `markdown-it` emits `list_item_open`, `paragraph_open`, `inline`, so the item
 * an inline token belongs to is two tokens back.
 */
renderer.core.ruler.push('task-list-text', (state): void => {
  for (const [index, token] of state.tokens.entries()) {
    if (token.type !== 'inline') continue;
    if (state.tokens[index - 2]?.type !== 'list_item_open') continue;

    const matched = TASK_MARKER.exec(token.content);
    if (matched === null) continue;

    // Checked before anything is mutated, so that a bail-out here cannot leave
    // the marker stripped from `content` and still present in the children the
    // item is actually rendered from.
    const first = token.children?.[0];
    if (first === undefined || first.type !== 'text') continue;

    token.content = token.content.slice(matched[0].length);
    first.content = first.content.replace(TASK_MARKER, '');

    const ticked = matched[1] !== ' ';
    const marker = new state.Token('html_inline', '', 0);
    marker.content = `<span class="md-task">${ticked ? '[x]' : '[ ]'}</span> `;
    token.children?.unshift(marker);
  }
});

/**
 * Escape for a text position in HTML.
 *
 * Belt and braces: the sanitiser downstream would catch anything this let
 * through, but the string being built here is the only markup this module
 * writes with anything of the document's in it — the task marker above is a
 * fixed string — and a renderer override that interpolates an attacker's `alt`
 * text unescaped would be handing the diff step a tag to work with rather than
 * the text it was told to show.
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
      before: renderer.render(source.before),
      after: renderer.render(source.after),
    };
  } catch {
    // `markdown-it` is forgiving by design and there is no such thing as
    // invalid Markdown, so this is close to unreachable — but "close to" is not
    // a reason to let one file take the whole column down.
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
