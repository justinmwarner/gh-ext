/**
 * A Markdown change, rendered, with the words that moved marked in place.
 *
 * The comparison itself is `lib/compare/markdown.ts`; this is the half that
 * needs a DOM. It is a list of blocks and nothing else: `markdownBlocks` cuts
 * the diffed document into its top-level elements and sanitises each one, and
 * every block it returns becomes an element React owns.
 *
 * **The sanitiser runs, and it runs last.** `comparison.unsafeHtml` is HTML
 * that whoever opened the pull request wrote, and this page holds a GitHub
 * token. `sanitizeMarkdownHtml` is the only thing between the two. It is now
 * called per block rather than per document, immediately before the string is
 * handed over and with nothing transforming the result afterwards, which is
 * the ordering the design rests on — see the note in `markdownBlocks.ts` for
 * why splitting *before* the sanitiser is the sound half of that trade and
 * splitting after would not be.
 *
 * **The result is inserted as HTML.** `dangerouslySetInnerHTML` is the honest
 * spelling of what this does, and the name is worth keeping rather than hiding
 * behind a wrapper. There are two places in this application where a string
 * becomes markup — the block below and the diagram source in `MermaidBlock` —
 * they are both in this feature, and both should be greppable.
 *
 * **Mermaid diagrams are drawn**, by a component per diagram rather than by an
 * effect that reached into the document and inserted figures. That effect is
 * what this rewrite removes, and the reason is recorded in `MermaidBlock.tsx`:
 * React rebuilds a `dangerouslySetInnerHTML` subtree whenever the prop's
 * identity moves, so the figures drawn into it were wiped moments after they
 * were placed, with no error, no failing test and no effect re-run. Only a real
 * browser ever showed it. Nothing here writes into a subtree it does not own,
 * so that failure has nowhere left to happen.
 *
 * **`markdown-block` is this component's class, not the document's.** A `.md`
 * file may write the name itself — `class` survives the sanitiser, and must,
 * since the diff marks are keyed on it — so the next thing to enumerate these
 * blocks should match `.markdown-rendered > .markdown-block` and not the class
 * on its own. A forged one is inside a block by construction, never beside one.
 *
 * Neither memo below is an optimisation. Parsing, sanitising and re-serializing
 * a document is real work, and this component re-renders whenever anything on
 * the card moves — a thread resolving, the viewed checkbox — none of which
 * changes the document.
 */

import { useMemo } from 'react';
import type { MarkdownComparison } from '@/lib/compare/markdown';
import { markdownBlocks } from './markdownBlocks';
import { MermaidBlock } from './MermaidBlock';

export function MarkdownCompare({ comparison }: { comparison: MarkdownComparison }) {
  const blocks = useMemo(
    () =>
      comparison.unsafeHtml === null
        ? []
        : markdownBlocks(comparison.unsafeHtml, comparison.nonce),
    [comparison.unsafeHtml, comparison.nonce],
  );

  /**
   * The elements, memoized — which is load-bearing rather than tidy.
   *
   * React compares `dangerouslySetInnerHTML` **by identity**, not by the string
   * inside it, and re-applying it is a bare `domElement.innerHTML = html`. A
   * fresh object literal per block would therefore re-parse every block of the
   * document on every render of the card — a thread resolving, a rail drag —
   * which is the cost the sanitising memo above was written to avoid and would
   * only half avoid. Holding the elements themselves keeps React from
   * reconciling these children at all when nothing about the document moved,
   * which covers the diagrams in the same breath.
   */
  const rendered = useMemo(
    () =>
      blocks.map((block) =>
        block.mermaid !== null ? (
          <MermaidBlock key={block.key} block={block} />
        ) : (
          <div
            key={block.key}
            className="markdown-block"
            // eslint-disable-next-line react/no-danger -- sanitised in markdownBlocks,
            // immediately before this, with nothing in between. See the note there.
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ),
      ),
    [blocks],
  );

  if (comparison.unsafeHtml === null) {
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
      <div className="markdown-rendered">{rendered}</div>
    </div>
  );
}
