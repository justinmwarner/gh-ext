/**
 * Where a rendered block came from, written on the block itself.
 *
 * The rendered Markdown mode draws a document, not a diff of lines, so nothing
 * on screen knows what line it is. That is why the mode has never been able to
 * carry a comment: GitHub's review API takes a path, a line and a side, and a
 * paragraph of formatted prose offers none of the three. `markdown-it` knows —
 * every block token carries `map`, the source line range it was parsed from —
 * and this module is the format that carries that knowledge through the word
 * diff, the sanitiser and the DOM to the place a comment is composed.
 *
 * It is deliberately a string in an attribute rather than a side table keyed by
 * element, because the two steps in the middle do not preserve element
 * identity: `htmlDiff` treats every tag as an opaque token and reassembles a
 * new document out of both sides, and the sanitiser parses and reprints. An
 * attribute survives both — verified — and nothing else does.
 *
 * **The security argument, which is the whole of the design.** An attribute a
 * pull request can write is an attribute a pull request can forge. A `.md` file
 * may contain raw HTML, that HTML reaches the renderer untouched, and the
 * sanitiser is configured to let this one attribute name through; so a
 * document can absolutely arrive at the page carrying
 * `data-md-anchor="something"` that nothing in this codebase wrote. If that
 * were believed, a reviewer who pressed the comment button beside one paragraph
 * would post their comment against a line the *author of the pull request*
 * chose — their words, attributed to them, pointing at a line they never read.
 *
 * The defence is that the value has to bear a nonce minted at render time,
 * after the document was authored and never sent anywhere, so it cannot be
 * guessed and cannot have been written into the file in advance. Everything
 * else in the value is checked strictly; a value that fails any check is
 * ignored rather than repaired. The cost of that is one paragraph somewhere
 * losing its comment button. The cost of the alternative is a comment posted to
 * a line the reviewer did not choose, and those two are not comparable.
 *
 * Rejected: signing the value, which needs a secret and a hash and defends
 * against nothing more, since the nonce is already unguessable and lives only
 * as long as the render it belongs to. Also rejected: trusting the attribute
 * and validating the line against the patch later, because a forged line inside
 * a hunk is exactly the forgery that matters and validation would pass it.
 *
 * Line numbers here are one-based, as GitHub counts them and as the rest of
 * `lib/review/` does, and a range is inclusive at both ends. `markdown-it`'s
 * `map` agrees with neither: it is zero-based and its end is exclusive, so the
 * two ends of a range do not convert the same way. The one place either
 * conversion happens is the caller in `./markdown.ts`, which sets out the
 * arithmetic; nothing downstream of here should be doing it a second time.
 */

import type { DiffSide } from '../github/types';

/**
 * The attribute name, in one place because three files depend on it agreeing:
 * the renderer that writes it, the sanitiser's allow-list, and whatever reads
 * it back off the DOM. A literal spelled a second time in the sanitiser would
 * be a hole that opened silently the day this one was renamed.
 */
export const ANCHOR_ATTRIBUTE = 'data-md-anchor';

/**
 * One block's origin: which of the two documents, and which lines of it.
 *
 * A range rather than a line, and inclusive at both ends. A block carrying only
 * its first line was the shape this started as and it lost comments twice over:
 * a thread written on the second line of a wrapped paragraph matched no block
 * and was drawn nowhere at all, and a paragraph whose *later* lines were the
 * ones the pull request touched was judged to be outside the diff entirely. A
 * README is wrapped prose, so both are the ordinary case rather than the edge.
 *
 * `endLine` is never less than `line`; a block that occupies one line has the
 * two equal. That invariant is enforced where anchors are read as well as where
 * they are written, because the reader's input is a string a pull request may
 * have chosen.
 */
export interface BlockAnchor {
  side: DiffSide;
  line: number;
  endLine: number;
}

/**
 * `L` and `R` rather than `LEFT` and `RIGHT`.
 *
 * The value is repeated on every block of the document, which on a large README
 * is several hundred copies of it, and the short form is unambiguous in a
 * position where only two values are legal. `parseAnchor` is the only reader.
 */
const MARKER: Record<DiffSide, string> = { LEFT: 'L', RIGHT: 'R' };

/**
 * A line number as it may appear in an anchor: one or more digits, no leading
 * zero, no sign, no exponent, nothing around it.
 *
 * `Number` was the obvious test and is wrong in five separate ways that matter
 * here — it accepts `'1e3'`, `' 1'`, `'0x10'`, `'+1'` and `''` — and every one
 * of those is a string a hostile document can put in an attribute. There is a
 * test for each.
 */
const LINE_NUMBER = /^[1-9][0-9]*$/;

/**
 * The value a block carries: a nonce, a side, and the range it occupies.
 *
 * `<nonce>-R3-5` for a block on lines three to five, and `<nonce>-R3-3` for one
 * on line three alone. The second is not abbreviated to `<nonce>-R3`, tempting
 * though it is on a document where most blocks are one line: a format with two
 * shapes needs two parsers, and the reader of this one runs over markup a
 * stranger wrote.
 */
export function anchorValue(
  nonce: string,
  side: DiffSide,
  line: number,
  endLine: number,
): string {
  return `${nonce}-${MARKER[side]}${line}-${endLine}`;
}

/**
 * Read an anchor, or refuse it.
 *
 * Total by construction: every branch returns, nothing throws, and the two
 * operations performed on the input — `startsWith` and `slice` — are defined
 * for every string. That is not fastidiousness. This runs over every block of a
 * document a stranger wrote, during a render, and an exception raised here does
 * not lose one anchor; it takes the review page down with it.
 *
 * Null for every failure, including the interesting one where the value is
 * well-formed but bears a nonce this render did not mint. Distinguishing "not
 * an anchor" from "somebody else's anchor" in the return type was considered
 * and dropped: no caller can do anything different with the second, and a
 * shape that invites a caller to handle it is a shape that invites a caller to
 * handle it wrongly.
 *
 * The range is split at the first hyphen after the marker rather than the last,
 * which is unambiguous because `LINE_NUMBER` admits no hyphen on either side of
 * it — so `R1-2-3` is refused rather than read as either of the two ranges it
 * could be mistaken for.
 */
export function parseAnchor(value: string, nonce: string): BlockAnchor | null {
  // An empty nonce would make the prefix a bare `-`, which is to say it would
  // make every hand-written anchor in the document valid. The renderer requires
  // a nonce, so this is unreachable from here — but it is the one input that
  // turns the check into its opposite, and it costs a line to refuse.
  if (nonce === '') return null;

  const prefix = `${nonce}-`;
  if (!value.startsWith(prefix)) return null;

  const rest = value.slice(prefix.length);
  const marker = rest.slice(0, 1);
  const range = rest.slice(1);

  if (marker !== MARKER.LEFT && marker !== MARKER.RIGHT) return null;

  const divider = range.indexOf('-');
  if (divider === -1) return null;

  const start = range.slice(0, divider);
  const end = range.slice(divider + 1);
  if (!LINE_NUMBER.test(start) || !LINE_NUMBER.test(end)) return null;

  const line = Number(start);
  const endLine = Number(end);
  // A range that ends before it begins is a range containing nothing. Nothing
  // in this codebase mints one, so a value carrying one came from the document
  // — and refusing rather than repairing is the rule the rest of this file
  // follows. It also lets every caller take `line <= endLine` as given, which
  // is what keeps a containment test from silently matching nothing.
  if (endLine < line) return null;

  return { side: marker === MARKER.LEFT ? 'LEFT' : 'RIGHT', line, endLine };
}
