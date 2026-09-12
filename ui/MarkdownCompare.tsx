/**
 * A Markdown change, rendered, with the words that moved marked in place — and
 * commentable.
 *
 * The comparison itself is `lib/compare/markdown.ts`; this is the half that
 * needs a DOM. It is a list of blocks and nothing else: `markdownBlocks` cuts
 * the diffed document into its top-level elements and sanitises each one, and
 * every block it returns becomes an element React owns, with a comment button,
 * its threads and — when it is the one being written on — the composer beside
 * it as ordinary siblings.
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
 * on its own. A forged one is inside `.markdown-block-content` by construction,
 * never beside one, so the child combinator is what does the work.
 *
 * Neither memo below is an optimisation. Parsing, sanitising and re-serializing
 * a document is real work, and this component re-renders whenever anything on
 * the card moves — a thread resolving, the viewed checkbox — none of which
 * changes the document.
 */

import { useMemo, useRef, useState } from 'react';
import type { MarkdownComparison } from '@/lib/compare/markdown';
import type { DiffSide, ReviewThread } from '@/lib/github/types';
import { isCommentable } from '@/lib/review/commentable';
import type { PostingComment } from '@/lib/review/posting';
import { type CommentAnchor, fileAnchor } from '@/lib/review/selection';
import { Composer } from './Composer';
import { type MarkdownBlock, markdownBlocks } from './markdownBlocks';
import { MermaidBlock } from './MermaidBlock';
import { PostingCard } from './PostingCard';
import { useReviewSession } from './reviewSession';
import { useShortcutTarget } from './shortcutTargets';
import { ThreadCard } from './ThreadCard';

export interface MarkdownCompareProps {
  comparison: MarkdownComparison;
  path: string;
  /**
   * Which lines of this file a comment can name, from `commentableLines`.
   *
   * The set rather than the patch, so a document of several hundred blocks
   * walks the patch once instead of once per block — and so this component
   * cannot form its own opinion about what a patch says.
   */
  commentable: ReadonlySet<string>;
}

/** Long enough to recognise a paragraph, short enough to be read aloud. */
const EXCERPT_LIMIT = 60;

/** No selection to seed a suggestion from, shared so it costs no allocation. */
const NO_LINES: readonly string[] = [];

/**
 * What a screen reader hears on the way past the button.
 *
 * "Comment" on two hundred controls is a list of two hundred identical items,
 * which is the same as no list at all. The block's own words are what tell them
 * apart, and they are already the words on screen beside it. A block with no
 * text — a diagram every line of which was deleted — falls back to its position,
 * because "Comment on “”" is worse than a number.
 */
function affordanceLabel(block: MarkdownBlock, index: number, path: string): string {
  const text = block.text.replace(/\s+/g, ' ').trim();
  if (text === '') return `Comment on block ${index + 1} of ${path}`;
  const clipped =
    text.length > EXCERPT_LIMIT ? `${text.slice(0, EXCERPT_LIMIT - 1)}…` : text;
  return `Comment on “${clipped}”`;
}

/**
 * The block, quoted, for a comment that will not be attached to it.
 *
 * A file-level comment arrives on github.com at the top of the file with no
 * prose beside it, so without this it reads as an opinion about nothing. Markdown
 * rather than a plain excerpt because the destination renders Markdown, and an
 * empty line inside a quote ends it unless it carries the marker too.
 */
function blockQuote(text: string): string {
  if (text.trim() === '') return '';
  const quoted = text
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
  return `${quoted}\n\n`;
}

/**
 * Where a comment on this block goes.
 *
 * Two shapes, and the fallback is the interesting one. A rendered view draws
 * the *whole* new document, so on any README worth the name most of what is on
 * screen was never touched by the pull request and has no line GitHub would
 * accept — and a raw `html_block` has no anchor at all, because `markdown-it`
 * returns its content verbatim and the attribute never reaches the output. Both
 * post against the file. A control that is present on three paragraphs and
 * missing on the fourth reads as a defect, and the reviewer has no way to know
 * which of the two reasons they are looking at.
 */
function anchorFor(block: MarkdownBlock, commentable: ReadonlySet<string>): CommentAnchor {
  return block.anchor !== null && isCommentable(commentable, block.anchor)
    ? { subject: 'line', line: block.anchor.line, side: block.anchor.side }
    : fileAnchor();
}

/** What belongs under one block, beside the words it was written about. */
interface BlockComments {
  threads: ReviewThread[];
  posting: PostingComment[];
}

export function MarkdownCompare({ comparison, path, commentable }: MarkdownCompareProps) {
  const session = useReviewSession();

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
   *
   * Still true now that each one is wrapped: React bails out of a subtree whose
   * element is the same object it rendered last time, and the wrapper around it
   * re-rendering does not change that.
   */
  const rendered = useMemo(
    () =>
      blocks.map((block) =>
        block.mermaid !== null ? (
          <MermaidBlock key={block.key} block={block} />
        ) : (
          <div
            key={block.key}
            className="markdown-block-content"
            // eslint-disable-next-line react/no-danger -- sanitised in markdownBlocks,
            // immediately before this, with nothing in between. See the note there.
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ),
      ),
    [blocks],
  );

  /** Which block the composer is open on, by key. One at a time, deliberately. */
  const [writing, setWriting] = useState<string | null>(null);

  /**
   * Which block `J` last stopped on, and therefore which one `c` is about.
   *
   * A ref rather than state: nothing on screen is drawn from it — the browser's
   * own focus is what shows where the reviewer is — and a render per keystroke
   * would re-run the document memo's dependents for a cursor move.
   */
  const cursor = useRef(-1);
  const nodes = useRef(new Map<string, HTMLDivElement>());

  /**
   * The threads and the comments in flight that belong under a block.
   *
   * Placement is gated on `commentable` as well as on the anchor matching, and
   * that gate is what keeps this from drawing a second copy of something the
   * per-file list is already showing. `layoutThreads` demotes a thread into
   * that list when its line falls outside the pull request's hunks, or when
   * the diff on screen numbers its side against a different commit; both of
   * those are lines `commentableLines` does not contain either, because the
   * patch it was built from is the same patch and `RichCompare` empties the
   * set outright for the second. So the two partitions meet, and a thread does
   * not appear twice.
   *
   * **One overlap is known and accepted.** `layoutThreads` has a third
   * demotion — `whitespace-only`, for a thread whose hunk the local
   * whitespace recompute took away — and that verdict is about the *drawn*
   * patch, which nothing here is given: the card is handed GitHub's file
   * deliberately, so that no comment is ever anchored from a patch this page
   * rewrote. Such a thread is listed and also drawn under its block. Closing
   * it would mean carrying the per-file list's verdict into a component that
   * otherwise needs nothing from it, and the failure it costs is a comment
   * read twice rather than a comment not read at all.
   *
   * The scan is linear per thread over the blocks rather than a lookup table.
   * A document has hundreds of blocks and a file has a handful of threads, the
   * whole thing is inside this memo, and the alternative is a second spelling
   * of the key format `lib/review/commentable.ts` deliberately keeps private.
   */
  const comments = useMemo(() => {
    const placed = new Map<string, BlockComments>();
    const threads = session.byPath.get(path) ?? [];
    const posting = session.posting.filter((entry) => entry.path === path);
    if (threads.length === 0 && posting.length === 0) return placed;

    const keyFor = (line: number, side: DiffSide): string | null =>
      blocks.find(
        (block) =>
          block.anchor !== null &&
          block.anchor.line === line &&
          block.anchor.side === side &&
          isCommentable(commentable, block.anchor),
      )?.key ?? null;

    const at = (key: string): BlockComments => {
      const held = placed.get(key);
      if (held !== undefined) return held;
      const made: BlockComments = { threads: [], posting: [] };
      placed.set(key, made);
      return made;
    };

    for (const thread of threads) {
      // An outdated thread has no line at all and a file-level one names no
      // line by design. Both stay in the per-file list, where they say so.
      if (thread.subjectType !== 'LINE' || thread.line === null) continue;
      const key = keyFor(thread.line, thread.diffSide);
      if (key !== null) at(key).threads.push(thread);
    }

    for (const entry of posting) {
      // A comment about the file is drawn below the document by `FileBody`,
      // which is where its thread will land once GitHub answers.
      if (entry.anchor.subject === 'file') continue;
      const key = keyFor(entry.anchor.line, entry.anchor.side);
      if (key !== null) at(key).posting.push(entry);
    }

    return placed;
  }, [blocks, commentable, path, session.byPath, session.posting]);

  /**
   * A changed block is this view's hunk, and this is where that is decided.
   *
   * `J` and `K` are `next-hunk` and `previous-hunk`, and a rendered document
   * has no hunks: the card is handed a diff with none so that no rows are drawn
   * under it. What it has instead is blocks the word diff marked, which is the
   * same thing the reviewer means by "the next change" — the part of the page
   * the pull request altered. So the two actions keep their names and their
   * keys and stop here rather than at the column, which would otherwise send
   * `J` to the first hunk of some other file.
   */
  const marked = useMemo(
    () => blocks.flatMap((block, index) => (block.changed ? [index] : [])),
    [blocks],
  );

  const focusBlock = (index: number): void => {
    cursor.current = index;
    const block = blocks[index];
    if (block !== undefined) nodes.current.get(block.key)?.focus();
  };

  /**
   * Clamped rather than wrapped, which is what `goToHunk` does one file over.
   * Pressing `J` past the last change should stop, not silently start again at
   * the top of a document the reviewer has just finished reading.
   */
  const step = (direction: 1 | -1): void => {
    if (marked.length === 0) return;
    const at = cursor.current;
    const next =
      direction > 0
        ? (marked.find((index) => index > at) ?? marked[marked.length - 1])
        : (marked.findLast((index) => index < at) ?? marked[0]);
    if (next !== undefined) focusBlock(next);
  };

  /**
   * `c` acts on the block `J` last stopped on.
   *
   * With no cursor it takes the first changed block, and failing that the first
   * block of the document — a reviewer who presses `c` having pressed nothing
   * else means "comment on this file", and the alternative is a key that does
   * nothing until some other key has been pressed first.
   */
  const commentOnCurrent = (): void => {
    const index = cursor.current >= 0 ? cursor.current : (marked[0] ?? 0);
    const block = blocks[index];
    if (block === undefined) return;
    focusBlock(index);
    setWriting(block.key);
  };

  const live = blocks.length > 0;
  useShortcutTarget('next-hunk', live ? () => step(1) : null, path);
  useShortcutTarget('previous-hunk', live ? () => step(-1) : null, path);
  useShortcutTarget('comment-on-line', live ? commentOnCurrent : null, path);

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
      <div className="markdown-rendered">
        {blocks.map((block, index) => {
          const anchor = anchorFor(block, commentable);
          const mine = comments.get(block.key);

          return (
            <div
              key={block.key}
              className="markdown-block"
              /* Focusable, and only programmatically. `J` has to be able to put
                 the reviewer on a block so that `c` knows which one they mean;
                 a tab stop per block would make a README of two hundred of them
                 unreachable by keyboard in any other way. */
              tabIndex={-1}
              ref={(node) => {
                if (node !== null) nodes.current.set(block.key, node);
                return () => {
                  nodes.current.delete(block.key);
                };
              }}
            >
              {rendered[index]}

              {/* After the content in source order and drawn beside it, so the
                  first child of a block is still the markup the document wrote
                  — which is what the margin rules in the stylesheet reach for.
                  Out of the tab order for the reason above. */}
              <button
                type="button"
                className="markdown-comment"
                tabIndex={-1}
                aria-label={affordanceLabel(block, index, path)}
                onClick={() => {
                  cursor.current = index;
                  setWriting(block.key);
                }}
              >
                <span aria-hidden="true">+</span>
              </button>

              {mine?.threads.map((thread) => (
                <ThreadCard key={thread.id} threadId={thread.id} />
              ))}
              {mine?.posting.map((entry) => (
                <PostingCard key={entry.id} postId={entry.id} />
              ))}

              {writing === block.key && (
                <Composer
                  path={path}
                  anchor={anchor}
                  rejection={null}
                  /* The patch is not in reach here and a suggestion seeded from
                     nothing proposes deleting the lines it was meant to replace.
                     The button says so rather than being absent. */
                  selectedLines={NO_LINES}
                  seed={anchor.subject === 'file' ? blockQuote(block.text) : ''}
                  onClose={() => setWriting(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
