/**
 * A Markdown change, rendered, with the words that moved marked in place.
 *
 * The comparison itself is `lib/compare/markdown.ts`; this is the half that
 * needs a DOM. Two things happen here and only here.
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
 * The memo is not an optimisation. Sanitising is a full parse of the document
 * into a detached tree, and this component re-renders whenever anything on the
 * card moves — a thread resolving, the viewed checkbox — none of which changes
 * the document.
 */

import { useMemo } from 'react';
import type { MarkdownComparison } from '@/lib/compare/markdown';
import { sanitizeMarkdownHtml } from './markdownHtml';

export function MarkdownCompare({ comparison }: { comparison: MarkdownComparison }) {
  const safeHtml = useMemo(
    () =>
      comparison.unsafeHtml === null ? null : sanitizeMarkdownHtml(comparison.unsafeHtml),
    [comparison.unsafeHtml],
  );

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
        // eslint-disable-next-line react/no-danger -- see the file comment: this
        // is the one insertion point, and the sanitiser is the line above it.
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}
