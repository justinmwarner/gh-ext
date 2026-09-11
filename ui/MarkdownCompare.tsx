/**
 * A Markdown change, rendered, with the words that moved marked in place.
 *
 * The comparison itself is `lib/compare/markdown.ts`; this is the half that
 * needs a DOM. Three things happen here and only here.
 *
 * **The sanitiser runs, and it runs last.** `comparison.unsafeHtml` is HTML
 * that whoever opened the pull request wrote, and this page holds a GitHub
 * token. `sanitizeMarkdownHtml` is the only thing between the two, it is
 * called immediately before the string reaches `dangerouslySetInnerHTML`, and
 * nothing transforms the result afterwards. The ordering is the design — see
 * the note in `markdownHtml.ts` for why sanitising earlier would be unsound
 * rather than merely differently arranged.
 *
 * **The result is inserted as HTML.** `dangerouslySetInnerHTML` is the honest
 * spelling of what this does, and the name is worth keeping rather than hiding
 * behind a wrapper: there is exactly one place in this application where a
 * string becomes markup, and it should be greppable.
 *
 * **Mermaid diagrams are drawn.** They were the one element of the rendered
 * mode that stayed unrendered — a wall of `graph TD` in a view whose whole
 * thesis is "the document as the reader will see it". `mermaidBlocks.ts`
 * recovers each diagram's real source out of the marked-up block and
 * `mermaid.ts` draws it, into an `<img>` rather than into the page, for the
 * reason `markdownHtml.ts` refuses inline SVG in the first place.
 *
 * That last step is imperative DOM work inside a React component, which is
 * unusual here and is the only shape available: React does not reconcile
 * inside `dangerouslySetInnerHTML`, so the subtree is ours to write into. It
 * is ours only for as long as React leaves it alone, though, and both memos
 * below are what make that a period rather than a race — see the note on
 * `html`, which is the one that turned out to matter. Drawing is also
 * asynchronous, since the renderer is a lazily loaded chunk, and a card can
 * be scrolled out from under it mid-draw; that is what `live` is for.
 *
 * Neither memo is an optimisation. Sanitising is a full parse of the document
 * into a detached tree and re-applying the result is another one, and this
 * component re-renders whenever anything on the card moves — a thread
 * resolving, the viewed checkbox — none of which changes the document.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { MarkdownComparison } from '@/lib/compare/markdown';
import { sanitizeMarkdownHtml } from './markdownHtml';
import { mermaidBlocks } from './mermaidBlocks';
import { renderMermaid, svgDataUrl } from './mermaid';

/**
 * Put one drawn diagram on the page, above the source it came from.
 *
 * The source is not removed, only hidden, and only when nothing in it moved.
 * A diagram whose source changed is the one case where the picture is not
 * enough: the two versions are not on screen together and a rendered diagram
 * carries no `<ins>` or `<del>`, so the marked-up source underneath it is the
 * only thing that says *what* changed. Keeping it is the difference between a
 * rendered diff and a rendered preview.
 */
function placeDiagram(
  pre: HTMLElement,
  changed: boolean,
  svg: string,
  size: { width: number | null; height: number | null },
): void {
  const figure = pre.ownerDocument.createElement('figure');
  figure.className = 'md-diagram';

  const img = pre.ownerDocument.createElement('img');
  img.src = svgDataUrl(svg);
  img.alt = 'Diagram';
  if (size.width !== null) img.width = size.width;
  if (size.height !== null) img.height = size.height;
  figure.append(img);

  if (changed) {
    const caption = pre.ownerDocument.createElement('figcaption');
    caption.textContent =
      'This diagram changed. The picture is the new version; the marked-up ' +
      'source below is where the change is.';
    figure.append(caption);
  }

  pre.before(figure);
  pre.classList.add(changed ? 'md-diagram-source' : 'md-diagram-drawn');
}

/** Say why there is no picture, without taking the source away. */
function placeRefusal(pre: HTMLElement, reason: string): void {
  const note = pre.ownerDocument.createElement('p');
  note.className = 'md-diagram-error';
  note.setAttribute('role', 'note');
  note.textContent = `${reason} The source is below.`;
  pre.before(note);
}

export function MarkdownCompare({ comparison }: { comparison: MarkdownComparison }) {
  const safeHtml = useMemo(
    () =>
      comparison.unsafeHtml === null ? null : sanitizeMarkdownHtml(comparison.unsafeHtml),
    [comparison.unsafeHtml],
  );

  /**
   * The prop object, memoized — which is load-bearing rather than tidy.
   *
   * React 19 decides whether to re-apply `dangerouslySetInnerHTML` by
   * comparing the prop **by identity**, not by the string inside it:
   * `updateProperties` reaches `setProp` whenever `nextProps[key] !==
   * lastProps[key]`, and `setProp` then does a bare `domElement.innerHTML =
   * html`. A fresh object literal here is therefore a full re-parse of the
   * document on every single render of the card — a thread resolving, the
   * viewed checkbox, a rail drag — which is the cost the memo above was
   * written to avoid and only half avoided.
   *
   * It is also what made the diagrams disappear. Each re-parse replaces every
   * child of this element, so the figures drawn into it were wiped moments
   * after they were placed, with no error, no effect re-run — the deps have
   * not moved — and the source still on screen. Nothing short of a real
   * browser showed it. Memoized, the subtree is rebuilt exactly when
   * `safeHtml` changes, which is exactly when the effect re-runs to draw into
   * it again.
   */
  const html = useMemo(() => ({ __html: safeHtml ?? '' }), [safeHtml]);

  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = host.current;
    if (container === null || safeHtml === null) return;

    const sources = mermaidBlocks(container).map((block) => block.source);
    if (sources.length === 0) return;

    let live = true;
    void (async () => {
      // Only strings cross the await, and the blocks are found again on the
      // other side of it. The subtree here belongs to
      // `dangerouslySetInnerHTML`, so React may rebuild it — the elements are
      // then different objects holding the same markup, and putting a diagram
      // beside one of the old ones inserts it into nothing, silently, with
      // the source still on screen and no error anywhere. That is exactly
      // what happened before `html` above was memoized, and it only ever
      // showed up in a real browser. Holding no element across the boundary
      // is the half of the fix that does not depend on knowing why React
      // decided to rebuild.
      const drawings = await Promise.all(
        sources.map((source) =>
          // Empty means every word of it was inside a `<del>`: the diagram was
          // removed, and the marked-up source is what says so.
          source === '' ? Promise.resolve(null) : renderMermaid(source),
        ),
      );
      if (!live) return;

      const blocks = mermaidBlocks(container);
      // A different document is on screen — the file list was replaced, or the
      // reviewer switched what this card is comparing. These drawings belong
      // to a document nobody is looking at.
      if (blocks.length !== drawings.length) return;

      for (const [index, block] of blocks.entries()) {
        const drawn = drawings[index];
        if (drawn === null || drawn === undefined) continue;
        if (drawn.ok) placeDiagram(block.pre, block.changed, drawn.svg, drawn);
        else placeRefusal(block.pre, drawn.reason);
      }
    })();

    return () => {
      live = false;
    };
    // On the sanitised string, because that is what React rebuilds the
    // subtree from — and rebuilding it is what wipes the diagrams this wrote.
  }, [safeHtml]);

  if (safeHtml === null) {
    // Every non-`ok` status carries its own sentence, because "this looks
    // empty" and "this refused" are indistinguishable in a card otherwise, and
    // the difference decides whether the reviewer presses Raw.
    return (
      <p className="file-note" role="note">
        {comparison.reason}
      </p>
    );
  }

  return (
    <div className="markdown-compare">
      {/* The marks are `<ins>` and `<del>`, which carry the meaning to a
          screen reader on their own — so the colour underneath them is a
          second channel rather than the only one. */}
      <div
        className="markdown-rendered"
        ref={host}
        // eslint-disable-next-line react/no-danger -- see the file comment: this
        // is the one insertion point, and the sanitiser is the line above it.
        dangerouslySetInnerHTML={html}
      />
    </div>
  );
}
