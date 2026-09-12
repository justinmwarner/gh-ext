/**
 * A rendered Markdown diff, cut into the blocks a reviewer can comment on.
 *
 * Until now the whole document was one string handed to one
 * `dangerouslySetInnerHTML`, and React does not reconcile inside one of those.
 * Everything that has to appear *beside* a paragraph — a comment button, a
 * thread, a composer — would therefore have had to be written into that
 * subtree imperatively, or portalled into placeholders put there imperatively
 * first. The Mermaid diagrams already went in that way and it cost a bug that
 * nothing but a real browser could see. So the document arrives here as a list
 * of blocks instead, each one a sanitised string, and every one of them
 * becomes an element React owns.
 *
 * **The split happens before the sanitiser, and that ordering is the design.**
 * The obvious alternative is to sanitise the document once and cut up the
 * result, and `./markdownHtml.ts` refuses it for a reason that still holds: a
 * string that has been declared safe and is then parsed and reprinted has been
 * through two parsers that are allowed to disagree, and nothing is looking at
 * the join. Splitting first keeps the seam where it already was. This module
 * takes the *unsafe* diffed HTML — the same string `htmlDiff` assembled out of
 * two documents a pull request wrote — parses it, and hands each block to the
 * sanitiser on its own. **The sanitiser is still the last thing that touches
 * every string before the DOM**, which is the rule that was being defended.
 * Nothing here transforms `html` after `sanitizeMarkdownHtml` returns it.
 *
 * That the per-block result matches the whole-document one is a claim rather
 * than a hope, and `markdownBlocks.test.tsx` runs the sanitiser suite's entire
 * corpus of attacks through both paths and compares the trees. Inline SVG and
 * MathML are in that corpus deliberately: they are where a parse-and-print
 * round trip is most likely to differ, because they switch the tokeniser into
 * a foreign-content mode with its own nesting rules.
 *
 * **`DOMParser` is inert.** `parseFromString` produces a document with no
 * browsing context: no script in it runs, no `src` is fetched, no `onerror`
 * fires. It is the same machinery DOMPurify itself parses into one step later,
 * which is what makes reading an attacker's markup here no more dangerous than
 * sanitising it was.
 */

import {
  ANCHOR_ATTRIBUTE,
  type BlockAnchor,
  parseAnchor,
} from '@/lib/compare/markdownAnchors';
import { sanitizeMarkdownHtml } from './markdownHtml';
import { mermaidBlocks, sideText, undoNonBreakingSpaces } from './mermaidBlocks';

/** One top-level element of the rendered document, ready to be put on screen. */
export interface MarkdownBlock {
  /** Stable across re-renders of the same document. */
  key: string;
  /** Sanitised. Safe to insert. */
  html: string;
  /** Where a comment on this block would go, or null if it cannot be believed. */
  anchor: BlockAnchor | null;
  /** Whether the diff marked anything inside it. */
  changed: boolean;
  /** The block's text, for seeding a file-level comment's blockquote. */
  text: string;
  /** The Mermaid source, when this block is a diagram fence. Null otherwise. */
  mermaid: string | null;
}

/**
 * A mark the word diff made, as opposed to one the document's author wrote.
 *
 * `htmlDiff` emits every mark with one of these three classes, so the class is
 * what tells the two apart — and a `.md` file may contain its own `<ins>`,
 * which survives the sanitiser and is part of both versions rather than a diff
 * of them. That is the same distinction `sideText` draws one file over.
 *
 * An author who writes `class="diffins"` by hand can still make a block read as
 * changed. Nothing rests on it: the field decides whether the source under a
 * diagram is worth keeping and, later, where `J` stops. Neither is a claim
 * about the document that a forgery could turn into a wrong comment.
 */
const MARK_SELECTOR = 'ins.diffins, ins.diffmod, del.diffdel, del.diffmod';

/**
 * The anchor this block would post a comment against.
 *
 * The first element carrying the attribute, the block itself included, which is
 * one rule covering two shapes rather than a special case. Every block token
 * `markdown-it` stamps prints its attributes on its own opening tag, with one
 * exception: a fence's go on the `<code>` inside the `<pre>`, because that is
 * where the default fence renderer puts them. Descending finds it.
 *
 * Descending cannot reach an anchor belonging to some *other* block, because
 * the only anchors a document contains are the ones this render stamped, and
 * the outermost of those inside a block is the block's own. A `.md` file may of
 * course write the attribute itself — that is what the nonce is for, and
 * `parseAnchor` refuses every value that does not bear this render's.
 */
function anchorOf(element: Element, nonce: string): BlockAnchor | null {
  const carrier = element.hasAttribute(ANCHOR_ATTRIBUTE)
    ? element
    : element.querySelector(`[${ANCHOR_ATTRIBUTE}]`);
  const value = carrier?.getAttribute(ANCHOR_ATTRIBUTE);
  return value === null || value === undefined ? null : parseAnchor(value, nonce);
}

/** The new document's text, with `htmlDiff`'s one substitution undone. */
const textOf = (root: Node): string =>
  undoNonBreakingSpaces(sideText(root, 'DEL')).trim();

/**
 * Every block of a rendered Markdown diff, in document order.
 *
 * The `nonce` is the one `compareMarkdown` stamped this document with. An
 * anchor bearing anything else is a forgery and the block is returned
 * unanchored, which costs it a line comment and never costs it the block.
 */
export function markdownBlocks(unsafeHtml: string, nonce: string): MarkdownBlock[] {
  const parsed = new DOMParser().parseFromString(unsafeHtml, 'text/html');

  /**
   * Which top-level `<pre>` is a diagram, and what its source says.
   *
   * `mermaidBlocks` is asked once, for the whole document, and the answers are
   * matched back to blocks by element. Calling it per block would not work and
   * the reason is worth naming: it selects `pre > code`, and a fence's block
   * *is* the `<pre>`, which `querySelectorAll` never matches against itself.
   *
   * Reconstructing a diagram's source out of a marked-up block is exact rather
   * than approximate, and the argument for that is long and lives in
   * `./mermaidBlocks.ts`. It is not worth having twice.
   *
   * A diagram inside a list item or a blockquote is found by that walk and is
   * not a top-level `<pre>`, so it is not in this map and is not drawn. It was
   * drawn before, by DOM surgery that reached anywhere in the subtree. Drawing
   * one now would mean splitting a block around its own descendants, which is
   * the machinery this module exists to remove, and a fence nested inside
   * another block is rare enough that the source is an honest fallback.
   */
  const diagrams = new Map<Element, string>();
  for (const found of mermaidBlocks(parsed.body)) diagrams.set(found.pre, found.source);

  const blocks: MarkdownBlock[] = [];

  /**
   * Unique by position and specific by origin.
   *
   * The position alone would be unique and stable, and would also hand a block
   * arriving at the same index from a different line whatever the previous
   * occupant had drawn. Naming the anchor as well means React treats that as a
   * new element instead. Only the parsed anchor goes in, never the raw
   * attribute, which is a string a pull request may have written.
   */
  const keyFor = (anchor: BlockAnchor | null): string =>
    `${blocks.length}:${anchor === null ? '-' : `${anchor.side}${anchor.line}`}`;

  // A snapshot, because `childNodes` is live and the loop borrows nodes from it.
  for (const node of [...parsed.body.childNodes]) {
    if (node.nodeType === node.ELEMENT_NODE) {
      const element = node as Element;
      const anchor = anchorOf(element, nonce);
      blocks.push({
        key: keyFor(anchor),
        html: sanitizeMarkdownHtml(element.outerHTML),
        anchor,
        changed:
          element.matches(MARK_SELECTOR) || element.querySelector(MARK_SELECTOR) !== null,
        text: textOf(element),
        // `??` rather than `||`: an empty source is a diagram every word of
        // which was deleted, which is a diagram block with nothing to draw
        // rather than a block that is not a diagram.
        mermaid: diagrams.get(element) ?? null,
      });
      continue;
    }

    if (node.nodeType !== node.TEXT_NODE) continue;

    /**
     * Text at the top level, which is rarer than it looks and still real.
     *
     * Between two block elements the parser leaves the newlines `markdown-it`
     * writes, and those render as nothing, so they are dropped. Anything else
     * is text a raw HTML block left outside its own tags — `<div>a</div> and
     * more` is one `html_block` and the words after it are a top-level text
     * node — and dropping *that* would be the rendered mode silently losing
     * something the author wrote, which is the one failure this feature exists
     * to prevent. It goes back through the serializer so the sanitiser is
     * handed a string here as it is everywhere else.
     */
    const text = node.nodeValue ?? '';
    if (text.trim() === '') continue;

    const holder = parsed.createElement('div');
    holder.append(node.cloneNode(true));
    blocks.push({
      key: keyFor(null),
      html: sanitizeMarkdownHtml(holder.innerHTML),
      anchor: null,
      changed: false,
      text: undoNonBreakingSpaces(text).trim(),
      mermaid: null,
    });
  }

  return blocks;
}
