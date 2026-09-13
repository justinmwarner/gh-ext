/**
 * Which lines of a file a comment can actually be attached to.
 *
 * A text diff never had to ask. The gutter only exists beside rows the patch
 * drew, so every line a reviewer could click was, by construction, a line
 * inside a hunk. The rendered Markdown mode broke that correspondence: it draws
 * the *whole* new document, so on any README worth the name most of what is on
 * screen was never touched by the pull request, and a block the reviewer can
 * see is no longer evidence that GitHub will take a comment on it.
 *
 * **UNVERIFIED, and it is the premise.** That GitHub's
 * `addPullRequestReviewThread` rejects a `line` outside the diff is asserted
 * from general knowledge of the API. It is not recorded in
 * `docs/reference/github-review-api.md`, which was written against the live
 * schema, and it has not been executed. It must be, and that file updated,
 * before any message shown to a reviewer claims it as a fact.
 *
 * The predicate is worth having either way, because it decides which of two
 * shapes a comment takes rather than whether a comment is possible at all. A
 * block inside a hunk posts as an ordinary line comment; a block outside every
 * hunk posts with `subjectType: FILE`, against the file rather than a line. If
 * the premise turns out to be wrong, the second path is still the honest one —
 * a line comment on a line nobody changed shows up on github.com attached to
 * context the reader has to go looking for. And if the premise is right, the
 * alternative is an affordance that invites a reviewer to write a paragraph and
 * then loses it to a 422, which is the worst of the three outcomes by some
 * distance.
 *
 * Computed from the patch rather than guessed from the file's size or the
 * hunk headers' declared counts. The counts in a header are what the header
 * *claims*; the body is what the patch *contains*, and where they disagree the
 * body is what GitHub numbered its own diff from.
 *
 * Pure, like the rest of `lib/`. The patch arrives as a string from
 * `ReviewFile.patch`, which is what the files endpoint sent.
 */

import type { BlockAnchor } from '../compare/markdownAnchors';
import type { DiffSide } from '../github/types';

/**
 * The same expression `search.ts` and `whitespace.ts` carry, for the third
 * time, and deliberately not shared.
 *
 * Extracting it would couple three walks that want different things out of a
 * patch — changed lines with their text, a rewritten body, and a set of
 * numbers — and the shared thing would be four capture groups and no
 * behaviour.
 *
 * Two of those groups are matched and never read. A header's counts are its own
 * claim about how many lines follow; this walk counts the lines that actually
 * do, so the header contributes only the two numbers to start from. They stay
 * in the expression because both are optional — `@@ -1 +1 @@` is legal and
 * means a count of one — and an expression that did not allow for them would
 * skip the hunk entirely and number everything after it from the hunk before.
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * One side and line, as a key.
 *
 * A `Set` of strings rather than a pair of `Set<number>`, or a map of side to
 * set, because every caller asks the same question — may this one block be
 * commented on — and one lookup answers it. The two-set shape makes the caller
 * choose a set before it can ask, which is a branch at every call site instead
 * of a template string here.
 *
 * Not exported. `isCommentable` and `firstCommentableLine` are the whole of the
 * read side between them, so nothing outside this file has ever needed to spell
 * a key — and a key spelled elsewhere is a second definition of the format.
 */
const lineKey = (side: DiffSide, line: number): string => `${side}:${line}`;

/**
 * Every line in this patch that a comment can name, on the side that names it.
 *
 * The walk is the ordinary one and the interesting part is what each marker
 * does to the two counters:
 *
 * - `+` is a line that exists only in the new file, so it advances the new
 *   counter and is commentable on `RIGHT` alone.
 * - `-` exists only in the old file: the old counter, `LEFT` alone.
 * - a leading space is context, present in both files at different numbers, and
 *   commentable on either.
 * - `\`, the `\ No newline at end of file` marker, is a note about the line
 *   above it rather than a line of either file, and advances neither. Counting
 *   it would shift every subsequent line by one, which is the failure mode that
 *   silently moves a reviewer's comment rather than losing it.
 *
 * A bare empty string is git's context line for a blank line, whose single
 * trailing space some tooling strips, and it is treated as context for the same
 * reason: reading it as anything else desynchronises both counters from
 * GitHub's numbering for the rest of the file.
 *
 * Lines before the first header are skipped and a `diff --git` resets the walk,
 * which is `changedLines` in `./search.ts` making the same two provisions: a
 * `ReviewFile` patch holds one file and starts at a hunk header, but the `---`
 * and `+++` of a combined diff would otherwise be counted as a deletion and an
 * addition, and correctness for both shapes costs two lines.
 */
export function commentableLines(patch: string): ReadonlySet<string> {
  const lines = new Set<string>();
  if (patch === '') return lines;

  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header !== null) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      inHunk = true;
      continue;
    }

    if (raw.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }

    if (!inHunk) continue;

    const marker = raw.slice(0, 1);

    if (marker === '+') {
      lines.add(lineKey('RIGHT', newLine));
      newLine += 1;
    } else if (marker === '-') {
      lines.add(lineKey('LEFT', oldLine));
      oldLine += 1;
    } else if (marker === '\\') {
      continue;
    } else {
      lines.add(lineKey('LEFT', oldLine));
      lines.add(lineKey('RIGHT', newLine));
      oldLine += 1;
      newLine += 1;
    }
  }

  return lines;
}

/**
 * May a comment name this exact line, on this side?
 *
 * Takes the set rather than the patch, so that a document with several hundred
 * blocks walks the patch once instead of once per block. The set is the thing
 * worth memoizing and this function is the thing worth calling in a loop.
 *
 * **This is not the question to ask about a block.** A block occupies a range
 * of source lines, and one asked about the line it happens to begin on answers
 * for a paragraph's first line while the pull request changed its third. Ask
 * `firstCommentableLine` instead, which is the reason this one takes a bare
 * side and line rather than a `BlockAnchor`: the type no longer offers a block
 * to whoever reaches for the convenient answer. What it is still exactly right
 * for is a line somebody already named — a thread's, a draft's — where there
 * is no range to consider.
 */
export function isCommentable(
  lines: ReadonlySet<string>,
  side: DiffSide,
  line: number,
): boolean {
  return lines.has(lineKey(side, line));
}

/**
 * Which line a comment on this block would actually be posted against, or null.
 *
 * A block is commentable if **any** line it occupies is inside a hunk, and it
 * anchors to the first such line. Both halves matter and they were both wrong
 * when a block knew only where it began: a paragraph whose second line was the
 * one the pull request touched was judged to be outside the diff altogether, so
 * every comment on it quietly became a file-level comment — correct on the wire,
 * and the reviewer loses the anchor they were looking at with nothing saying
 * why.
 *
 * **The line and the verdict are one answer, not two.** The obvious shape was a
 * predicate beside the existing one, leaving the caller to work out which line
 * it had just been told yes about; that is two walks of the same range and two
 * chances to disagree, and the way it disagrees is by posting a comment against
 * a line the reviewer did not choose. Returning the line makes `!== null` the
 * predicate and leaves nothing to derive.
 *
 * The *first* line in the range rather than, say, the one nearest the middle of
 * the block: it is the one a reviewer reading the patch beside this page would
 * pick, it is stable as the block's later lines change, and where the whole
 * block is inside a hunk — the common case — it is the block's own start, which
 * is what this anchored to before the range existed.
 *
 * Linear in the block's length and called once per block per render. A
 * paragraph is a handful of lines; the alternative, indexing the set by range,
 * costs more to build than the whole document costs to scan.
 */
export function firstCommentableLine(
  lines: ReadonlySet<string>,
  anchor: BlockAnchor,
): number | null {
  for (let line = anchor.line; line <= anchor.endLine; line += 1) {
    if (isCommentable(lines, anchor.side, line)) return line;
  }
  return null;
}
