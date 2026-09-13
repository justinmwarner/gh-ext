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
import type { DiffSide } from '../github/types';
import { diffHtml } from './htmlDiff/htmlDiff';
import { ANCHOR_ATTRIBUTE, anchorValue } from './markdownAnchors';

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
   *
   * Measured with the source anchors removed, so this cap means the same thing
   * it meant before they existed. An anchor is forty-odd characters of this
   * module's own bookkeeping on every block, which on a long README is
   * kilobytes that the reader never asked for and — because `toWords` makes
   * each tag one token however many attributes it carries — that the word diff
   * does not pay for either. Counting them would quietly shrink the document
   * this mode will accept, in exchange for measuring nothing real.
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
  /**
   * The nonce the anchors in `unsafeHtml` were stamped with.
   *
   * Handed back rather than left with the caller to remember, because the value
   * and the document it describes are one thing and separating them is how they
   * come apart: a page holding last render's nonce believes none of this
   * render's anchors, and a page holding the wrong render's nonce is worse than
   * that. Present on every status, including the three refusals, so the failure
   * path has the same shape as the success one and no reader has to work out
   * which branch left the field off.
   */
  nonce: string;
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
 * What `renderSide` puts in the renderer's `env` for the rule below to find.
 *
 * `markdown-it` types `env` as `any` and threads whatever it is given straight
 * through to the core rules, so this interface is the only description of the
 * contract between the two halves and both halves are in this file.
 */
interface AnchorEnv {
  mdAnchor?: { nonce: string; side: DiffSide };
}

/**
 * Every block says which lines of which document it came from.
 *
 * This is what makes the mode commentable at all. See `./markdownAnchors.ts`
 * for the format and for why the value carries a nonce and a whole range rather
 * than a line; the decision worth recording here is the shape of the mechanism
 * rather than the format.
 *
 * **Pushed once, not per render.** The side and the nonce travel in the `env`
 * that `render(src, env)` threads through to the core rules, so one rule serves
 * both sides of every comparison with no state of its own. Installing a
 * freshly-closed-over rule per render was the obvious alternative and is a
 * leak: `core.ruler` is a property of this module-level instance, so the chain
 * would grow by two every time a reviewer opened a card, and a pull request
 * with two hundred `.md` files would end up running four hundred stale rules
 * over every document. A render whose `env` carries no `mdAnchor` — which is
 * every render this module does not make — stamps nothing.
 *
 * **Two classes of token are skipped, for different reasons.** A closing tag
 * has `nesting === -1` and prints no attributes, so an anchor on one is
 * invisible. An `inline` token does carry a `map`, which is easy to miss, but
 * `renderInline` walks its children and never prints the container, so an
 * anchor there is a fact nothing can read. What is left is the set of tokens
 * whose attributes reach the page: every block opening, and the standalone
 * blocks — `fence`, `code_block`, `hr` — that are one token with no closer.
 *
 * One block is not reachable this way and it is worth naming rather than
 * discovering: `html_block`, a run of raw HTML in the `.md` file, is rendered
 * by returning its content verbatim, so it has nowhere to put an attribute and
 * gets no anchor. A reviewer cannot comment on a hand-written `<table>` in a
 * README. That is the same trade the sanitiser already makes about raw HTML,
 * and the alternative — synthesizing a wrapper element around content a pull
 * request wrote — is markup this module manufactures out of an attacker's
 * string, which is the one thing the image rule above exists to avoid.
 *
 * **It does not interact with `task-list-text` above.** That rule reads
 * `state.tokens[index - 2]` and mutates `content` and `children` on `inline`
 * tokens; this one reads `map` and `nesting` and mutates `attrs` on everything
 * else. Neither inserts, removes or reorders anything in `state.tokens`, so
 * the lookback cannot be shifted and the disjoint fields cannot be overwritten
 * — which means the order the two run in is not load-bearing, and the order
 * they happen to run in is the order they are pushed, this one second. A test
 * pins a ticked box that also carries an anchor, so a future rule that did
 * insert a token would fail here rather than in a browser.
 */
renderer.core.ruler.push('source-anchors', (state): void => {
  const stamp = (state.env as AnchorEnv).mdAnchor;
  if (stamp === undefined) return;

  for (const token of state.tokens) {
    if (token.map === null || token.nesting === -1 || token.type === 'inline') continue;

    const from = token.map[0];
    const to = token.map[1];
    if (from === undefined || to === undefined) continue;

    // **The two ends do not convert the same way, and the asymmetry is real.**
    // `map` counts from zero, where GitHub counts from one and so does every
    // line number elsewhere in this project; and `map`'s end is *exclusive*,
    // where an anchor's is inclusive. So the start gains one, and the end gains
    // one for the numbering and loses one for the bound, which cancel. A
    // paragraph on source lines 3, 4 and 5 has `map === [2, 5]` and must anchor
    // as `R3-5`; the same paragraph on line 3 alone has `map === [2, 3]` and
    // anchors as `R3-3`. Adding one to both would claim every block reached a
    // line belonging to whatever follows it, and a comment on the last line of
    // a paragraph would be offered by two blocks at once.
    //
    // `Math.max` covers a token whose end is not past its start, which every
    // block rule `markdown-it` ships makes unreachable because each consumes at
    // least the line it began on. A token that managed it would be stamped with
    // an inverted range, `parseAnchor` would refuse it on arrival, and the block
    // would lose its comment button for a reason nothing on screen could
    // explain. Clamping anchors it to its own first line instead, which is what
    // it had before this range existed.
    const line = from + 1;
    token.attrSet(
      ANCHOR_ATTRIBUTE,
      anchorValue(stamp.nonce, stamp.side, line, Math.max(to, line)),
    );
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

const tooLarge = (nonce: string, reason: string): MarkdownComparison => ({
  status: 'too-large',
  unsafeHtml: null,
  reason,
  nonce,
});

/** One side, rendered with every block told which lines of it it came from. */
const renderSide = (source: string, nonce: string, side: DiffSide): string =>
  renderer.render(source, { mdAnchor: { nonce, side } } satisfies AnchorEnv);

/**
 * Every anchor in a rendered document, as a pattern.
 *
 * `attrSet` and `markdown-it`'s `renderAttrs` are the only things that write
 * this attribute here, and they write it one way: a leading space, the name, an
 * `=`, and a double-quoted value with no double quote inside it, because the
 * renderer escapes the value it is given. So the match is exact rather than
 * approximate. Declared once at module scope like `TASK_MARKER` above, and safe
 * to be global because `replace` resets `lastIndex` where `test` would have
 * carried it between calls — which is a defect this project has already fixed
 * once, in `htmlDiff`.
 */
const ANCHOR_PATTERN = new RegExp(` ${ANCHOR_ATTRIBUTE}="[^"]*"`, 'g');

/**
 * The rendered document without this module's bookkeeping on it.
 *
 * Used for the two questions that must not see the anchors: how large the
 * document is, and whether the two sides are the same document. Both are
 * questions about what the reader gets, and an anchor is not that — two
 * documents identical but for a blank line inserted above them render the same
 * prose and carry different line numbers, and calling that a change would
 * reintroduce exactly the noise the rendered mode exists to remove.
 *
 * This is `htmlDiff`'s own trick one layer up: strip the attributes to decide,
 * never to emit. `unsafeHtml` is always the anchored form.
 */
const withoutAnchors = (html: string): string => html.replace(ANCHOR_PATTERN, '');

/**
 * Render both sides and mark the difference between them.
 *
 * Nulls are accepted and read as empty, though the mode is not offered for a
 * one-sided change — see `modes.ts`, where `markdown:rendered` is marked
 * `needsBothSides`, because a document with every word marked as inserted is a
 * rendered preview wearing a diff's clothes.
 *
 * The nonce is required and has no default. An empty one would still stamp
 * anchors, and `parseAnchor` would then believe any anchor a pull request wrote
 * by hand — so a default here would not be a convenience, it would be the
 * mechanism quietly turning itself off. It is minted by the caller in `ui/`,
 * because `lib/` is pure and has no source of randomness.
 */
export function compareMarkdown(
  before: string | null,
  after: string | null,
  nonce: string,
): MarkdownComparison {
  const source = { before: before ?? '', after: after ?? '' };

  if (
    source.before.length > MARKDOWN_LIMITS.maxSourceChars ||
    source.after.length > MARKDOWN_LIMITS.maxSourceChars
  ) {
    return tooLarge(
      nonce,
      'This document is too large to render and mark up here. Raw shows the ' +
        'change as GitHub sent it.',
    );
  }

  let rendered: { before: string; after: string };
  try {
    rendered = {
      before: renderSide(source.before, nonce, 'LEFT'),
      after: renderSide(source.after, nonce, 'RIGHT'),
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
      nonce,
    };
  }

  const plain = {
    before: withoutAnchors(rendered.before),
    after: withoutAnchors(rendered.after),
  };

  if (
    plain.before.length > MARKDOWN_LIMITS.maxRenderedChars ||
    plain.after.length > MARKDOWN_LIMITS.maxRenderedChars
  ) {
    return tooLarge(
      nonce,
      'This document renders to more than can be marked up here. Raw shows ' +
        'the change as GitHub sent it.',
    );
  }

  // Compared after rendering, not before. Two documents whose source differs
  // only where it does not matter — a setext heading rewritten with hashes,
  // trailing whitespace, a reordered link reference — are genuinely the same
  // document, and saying so is more useful than marking nothing in a wall of
  // prose and leaving the reader to work out that nothing is what was meant.
  //
  // Compared without the anchors for the same reason: the two sides are stamped
  // `L` and `R`, so the anchored forms of one unchanged document never match
  // each other and this branch would be unreachable.
  if (plain.before === plain.after) {
    return {
      status: 'unchanged',
      unsafeHtml: null,
      reason:
        'These two versions render identically. The difference between them is ' +
        'in the Markdown rather than in the document.',
      nonce,
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
      nonce,
    };
  }

  return { status: 'ok', unsafeHtml: marked, reason: null, nonce };
}
