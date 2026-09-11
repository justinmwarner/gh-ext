/**
 * Finding the Mermaid diagrams in a rendered Markdown diff, and recovering the
 * source each one was written from.
 *
 * `marked` turns a ` ```mermaid ` fence into `<pre><code class="language-mermaid">`
 * holding the diagram's source as text, so until now a `.md` file's diagrams
 * were the one part of the rendered mode that stayed unrendered — a wall of
 * `graph TD` in a view whose entire thesis is "the document as the reader will
 * see it".
 *
 * Rendering one needs its source, and the source is not simply the block's
 * text. By the time this runs, `diffHtml` has spliced `<ins>` and `<del>` into
 * the token stream, so the block holds *both* versions interleaved. The new
 * document is what the rendered mode shows, so the new document's source is
 * what a diagram is drawn from: the text with every `<del>` left out.
 *
 * **Why that reconstruction is exact rather than approximate.** `diffHtml`
 * makes exactly one alteration to the text it is given — a marked run starting
 * with a plain space has that space written as `&nbsp;`, so it cannot collapse
 * against the tag in front of it. Everything else is passed through verbatim,
 * tag by tag and word by word. Undo that one substitution and dropping the
 * other side's marks gives back the original character for character. There is
 * a test for each half.
 *
 * A `<pre>` whose every word is inside a `<del>` is a diagram that was
 * deleted: the reconstruction is empty and the caller draws nothing, leaving
 * the marked-up source to say what went.
 *
 * Nothing here renders anything or takes a dependency on Mermaid. It is a DOM
 * walk, which is why it is in `ui/` rather than `lib/`, and it is separate
 * from the renderer so the hard part is testable without one.
 */

/** One diagram found in a rendered Markdown diff. */
export interface MermaidBlock {
  /** The `<pre>` the fence produced. Where the diagram goes. */
  pre: HTMLElement;
  /**
   * The new document's source for this diagram, ready to render.
   *
   * Empty when the block exists only in the old document — see the file note.
   */
  source: string;
  /**
   * Whether the diff marked anything inside this block.
   *
   * Decides whether the source is worth keeping on screen beside the picture.
   * An unchanged diagram is just a diagram; a changed one is the only place
   * the reader can see *what* changed, because the two pictures are not on
   * screen together and a rendered diagram carries no marks.
   */
  changed: boolean;
}

/** The classes `htmlDiff` marks with. `diffmod` sits on both halves of a swap. */
const MARKS = new Set(['diffins', 'diffdel', 'diffmod']);

const isMark = (node: Element): boolean =>
  [...node.classList].some((name) => MARKS.has(name));

/**
 * The text of one side of a marked-up subtree.
 *
 * `drop` names the tag belonging to the *other* side. Only marked elements are
 * dropped: a `.md` file may contain its own `<ins>` — it is in the sanitiser's
 * allow-list and survives to here — and a document's own markup is part of
 * both versions rather than a diff of them.
 */
export function sideText(root: Node, drop: 'INS' | 'DEL'): string {
  let text = '';

  for (const node of root.childNodes) {
    if (node.nodeType === node.TEXT_NODE) {
      text += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== node.ELEMENT_NODE) continue;

    const element = node as Element;
    if (element.tagName === drop && isMark(element)) continue;
    text += sideText(element, drop);
  }

  return text;
}

/**
 * Put back the one character `htmlDiff` rewrote.
 *
 * A marked run beginning with a space has that space emitted as `&nbsp;`, so
 * the space cannot collapse against the tag written before it. In prose that
 * is invisible; in a diagram's source it is a non-breaking space in the middle
 * of `A --> B`, which Mermaid either draws oddly or refuses outright.
 *
 * A non-breaking space the author typed themselves is rewritten too. Inside a
 * diagram that only ever appears in a label, where a plain space is what it
 * was standing in for anyway.
 */
const undoNonBreakingSpaces = (text: string): string => text.replace(/ /g, ' ');

/** Whether a `<code>` element is a Mermaid fence, however the lang was cased. */
function isMermaidCode(code: Element): boolean {
  return [...code.classList].some((name) => name.toLowerCase() === 'language-mermaid');
}

/**
 * Every Mermaid diagram in a rendered Markdown diff, in document order.
 *
 * Matched on the class `marked` already emits rather than on anything this
 * project adds, so `lib/compare/markdown.ts` needs no change and the seam
 * survives the sanitiser — which strips `data-*` on purpose and leaves `class`
 * alone.
 *
 * A `<pre class="language-mermaid">` hand-written as raw HTML in the `.md`
 * file matches too. That is not a hole: the author of the pull request could
 * have written a fence instead, and the two produce the same diagram from the
 * same source. Nothing is reachable this way that a fence does not already
 * reach.
 */
export function mermaidBlocks(container: ParentNode): MermaidBlock[] {
  const found: MermaidBlock[] = [];

  for (const code of container.querySelectorAll('pre > code')) {
    if (!isMermaidCode(code)) continue;
    const pre = code.parentElement;
    if (pre === null) continue;

    found.push({
      pre,
      source: undoNonBreakingSpaces(sideText(code, 'DEL')).trim(),
      changed: code.querySelector('ins, del') !== null,
    });
  }

  return found;
}
