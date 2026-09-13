/**
 * One Mermaid diagram in a rendered Markdown diff, drawn.
 *
 * Diagrams were the one element of the rendered mode that stayed unrendered —
 * a wall of `graph TD` in a view whose whole thesis is "the document as the
 * reader will see it". `markdownBlocks.ts` recovers each one's real source out
 * of the marked-up block, using the reconstruction `mermaidBlocks.ts` argues is
 * exact, and this component draws it.
 *
 * **Into an `<img>`, never into the page.** That is the rule `markdownHtml.ts`
 * sets out at length: a diagram's source is markup a pull request wrote, and
 * markup a pull request wrote renders through `<img>`, where the browser treats
 * SVG as a secure static document that runs no script and fetches nothing. It
 * is never inlined into an origin holding a GitHub token.
 *
 * **The source is kept when the diagram changed and hidden when it did not.**
 * A rendered diagram carries no `<ins>` or `<del>` and the old version is not
 * on screen beside it, so for a diagram whose source moved the marked-up source
 * underneath is the only thing that says *what* moved. That is the difference
 * between a rendered diff and a rendered preview. When nothing moved the source
 * is the picture written out longhand and the picture is the better copy, so it
 * is hidden — hidden rather than removed, because it is still the document and
 * a reader looking for where the text went should find it in the DOM.
 *
 * **It is a component rather than DOM surgery, and that is the whole point of
 * the change around it.** This used to be an effect that walked the subtree
 * belonging to a single `dangerouslySetInnerHTML` and inserted figures into it.
 * React rebuilds that subtree whenever the prop's identity moves, which wiped
 * the drawn diagrams moments after they were placed — no error, no failing
 * test, no effect re-run, and nothing but a real browser ever showed it. The
 * figure below is React's own element, so there is no subtree to lose it in.
 *
 * Drawing is still asynchronous, because the renderer is a lazily loaded chunk
 * and a card can be scrolled out from under it mid-draw. That is what `live`
 * is for. The effect it guards belongs to one diagram and depends on that
 * diagram's source, which retires a second piece of bookkeeping: the old one
 * drew every diagram in the document at once, so on the far side of the await
 * it had to find the blocks again and compare the count, in case the card was
 * now showing a different document altogether. An effect that can only ever be
 * handed its own source has nothing to check.
 */

import { useEffect, useMemo, useState } from 'react';
import type { MarkdownBlock } from './markdownBlocks';
import { type MermaidResult, renderMermaid, svgDataUrl } from './mermaid';

export function MermaidBlock({ block }: { block: MarkdownBlock }) {
  // Empty means every word of it was inside a `<del>`: the diagram was
  // removed, and the marked-up source is what says so.
  const source = block.mermaid ?? '';
  const [drawn, setDrawn] = useState<MermaidResult | null>(null);

  useEffect(() => {
    // A different diagram, so whatever is on screen belongs to the last one.
    setDrawn(null);
    if (source === '') return;

    let live = true;
    void renderMermaid(source).then((result) => {
      if (live) setDrawn(result);
    });

    return () => {
      live = false;
    };
  }, [source]);

  /**
   * The prop object, memoized, which is load-bearing rather than tidy.
   *
   * React decides whether to re-apply `dangerouslySetInnerHTML` by comparing
   * the prop **by identity**, not by the string inside it, and then does a bare
   * `domElement.innerHTML = html`. A fresh object literal here would re-parse
   * the block every time this component re-renders, which it does twice for
   * every diagram it draws.
   */
  const html = useMemo(() => ({ __html: block.html }), [block.html]);

  const picture = drawn !== null && drawn.ok ? drawn : null;

  // No class until there is a picture. A diagram still drawing, one Mermaid
  // refused and one that was deleted all keep their source at full size,
  // because in each of those three the source is all there is.
  const sourceClass =
    picture === null ? undefined : block.changed ? 'md-diagram-source' : 'md-diagram-drawn';

  return (
    // `markdown-block-content`, the same class an ordinary block's markup
    // carries: a diagram is one block of the document, and the box around it —
    // with the comment button and the threads in it — belongs to
    // `MarkdownCompare`, which draws it for every block alike.
    <div className="markdown-block-content">
      {picture !== null && (
        <figure className="md-diagram">
          {/* Width and height off the diagram's own `viewBox`, so the space is
              reserved before the image decodes and the card does not jump. */}
          <img
            src={svgDataUrl(picture.svg)}
            alt="Diagram"
            width={picture.width ?? undefined}
            height={picture.height ?? undefined}
          />
          {block.changed && (
            <figcaption>
              This diagram changed. The picture is the new version; the marked-up
              source below is where the change is.
            </figcaption>
          )}
        </figure>
      )}

      {/* A `.md` file in a pull request is entitled to contain a diagram that
          does not parse. That is a sentence to show, not a card to lose. */}
      {drawn !== null && !drawn.ok && (
        <p className="md-diagram-error" role="note">
          {drawn.reason} The source is below.
        </p>
      )}

      <div
        className={sourceClass}
        // eslint-disable-next-line react/no-danger -- sanitised in markdownBlocks,
        // immediately before this, with nothing in between. See the note there.
        dangerouslySetInnerHTML={html}
      />
    </div>
  );
}
