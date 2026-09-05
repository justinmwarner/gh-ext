/**
 * Reading a diff with the whitespace taken out of it.
 *
 * A pull request that reindents a function shows every line of it as changed,
 * and the reviewer has to read all of them to find the one that is not just
 * indentation. GitHub's web UI answers this with `?w=1`; the REST API's `.diff`
 * has no equivalent and we take the API's, so the only way to have it is to
 * work it out here.
 *
 * **This rewrites GitHub's patch rather than re-diffing the two files.** That
 * is the whole design, and it is not a shortcut. A line that differs only in
 * whitespace is by definition a line git already called changed, so both
 * versions of it are already in the patch, inside the same hunk — there is
 * nothing to fetch. Two properties follow that a blob-reading recompute could
 * not have offered:
 *
 * - **No line number can move.** Merging a `-`/`+` pair into one context line
 *   consumes one line on each side, exactly as the pair did, so every line
 *   after it keeps the number it had and every `@@` header is copied verbatim.
 *   Comments are posted as line numbers in GitHub's diff and nothing on screen
 *   would say if one had drifted, so this is the property that matters most,
 *   and it is checked at runtime rather than trusted: a hunk whose rewrite
 *   would cover a different number of lines is thrown away and GitHub's kept.
 * - **What is drawn is always a subset of what GitHub drew.** Hunks lose rows
 *   or disappear; none is ever added. So a comment this hides is a comment the
 *   column already knows how to list rather than one it loses.
 *
 * It costs no request, so it is instant, and it works just as well on a diff
 * narrowed to two commits — whatever patch is on screen is what it rewrites.
 *
 * `diff` (jsdiff) does the comparing. It is already in the tree under
 * `@pierre/diffs`, so it costs no new bytes. `lib/compare/rows.ts` considered
 * it for row alignment and turned it down because `diffArrays` has no budget of
 * any kind — the objection does not apply here, because `diffLines` takes
 * `maxEditLength`, which is precisely the ceiling that was missing.
 *
 * Pure by contract: no DOM, no `chrome.*`, no transport.
 */

import { diffLines } from 'diff';

/**
 * How much edit distance one file may spend having its whitespace ignored.
 *
 * In lines that genuinely differ, summed over the file. This is the only
 * ceiling here because it is the only thing the cost depends on: jsdiff walks a
 * band around the diagonal, so a block of 20,000 lines and a block of 2,000
 * cost the same at the same edit distance — measured at 188 ms and 174 ms with
 * this budget, against 12 ms for the 20,000-line reindentation this feature
 * actually exists for, whose edit distance is nearly zero.
 *
 * One number rather than a cap per hunk because the cost is superlinear in the
 * distance: eight blocks sharing a budget of 1,000 measured 39 ms where a
 * single block spending all of it measured 201 ms. So the worst case for the
 * whole file is one call at the full budget, and a per-hunk cap would instead
 * multiply that by the number of hunks, which nothing here would bound.
 *
 * A thousand differing lines in one block is far past a reindentation and well
 * into a rewrite — which is the happy part of this trade. The case that costs
 * the most is exactly the case where ignoring whitespace had nothing to offer,
 * so giving up early takes nothing from the reviewer. Past the budget the rest
 * of the file is shown as GitHub sent it, and the card says so.
 */
export const WHITESPACE_BUDGET = 1_000;

export interface WhitespaceDiff {
  /** The rewritten patch, in the same unified-diff shape it arrived in. */
  patch: string;
  /** Hunks left. Zero means every change in this file was whitespace. */
  hunks: number;
  /** Hunks gone, because nothing but whitespace moved inside them. */
  dropped: number;
  /**
   * Some of the patch is still GitHub's — the budget ran out, or a hunk was
   * not safe to rewrite. What is on screen is then a mixture, and the reviewer
   * has to be told, because the whole point of the mode is that what it hides
   * did not matter.
   */
  partial: boolean;
}

/**
 * What the card says while this is on.
 *
 * The first sentence is not a nicety and not a status line — it is the whole
 * licence for the mode existing. Every other person on this pull request is
 * looking at a different diff, and a reviewer who forgets that can report that
 * a line is unchanged when GitHub says it changed. The second half is the
 * reassurance that makes the first half liveable: the numbers underneath are
 * still GitHub's, so a comment left here lands where it reads.
 *
 * The rest is only added when it is true, because a notice that always says
 * four things is a notice nobody finishes reading.
 */
export function whitespaceNotice(diff: WhitespaceDiff): string {
  const parts = [
    'Whitespace ignored. This diff was recomputed here and is not the diff ' +
      'GitHub is showing on this pull request — comments still attach to ' +
      'GitHub’s line numbers.',
  ];

  if (diff.hunks === 0) {
    parts.push('Nothing but whitespace changed anywhere in this file.');
  } else if (diff.dropped > 0) {
    parts.push(
      diff.dropped === 1
        ? 'One part of this file is hidden, where nothing but whitespace moved.'
        : `${diff.dropped} parts of this file are hidden, where nothing but whitespace moved.`,
    );
  }

  if (diff.partial) {
    parts.push(
      'Too much of it changed to finish, so the rest is still shown as GitHub sent it.',
    );
  }

  return parts.join(' ');
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** What a line in a hunk body is. A bare `''` is git's empty context line. */
const isRemoval = (line: string): boolean => line.startsWith('-');
const isAddition = (line: string): boolean => line.startsWith('+');

/**
 * One hunk's body, rewritten, or null to keep GitHub's.
 *
 * Null is returned rather than a partial answer for the two cases that cannot
 * be made safe: a hunk carrying a `\ No newline at end of file` marker, which
 * attaches to the line above it and would end up describing a row that no
 * longer exists, and a rewrite that came out covering a different number of
 * lines, which is the one failure that would move a comment.
 */
function rewriteBody(
  header: RegExpMatchArray,
  body: readonly string[],
  budget: { left: number; spent: boolean },
): string[] | null {
  if (body.some((line) => line.startsWith('\\'))) return null;

  const out: string[] = [];
  let at = 0;

  while (at < body.length) {
    const line = body[at];
    if (line === undefined) break;

    if (!isRemoval(line) && !isAddition(line)) {
      out.push(line);
      at += 1;
      continue;
    }

    // One maximal run of changed lines. Everything inside it is a candidate to
    // be paired off against everything else inside it, and nothing outside is.
    const start = at;
    while (at < body.length) {
      const next = body[at];
      if (next === undefined || (!isRemoval(next) && !isAddition(next))) break;
      at += 1;
    }
    const block = body.slice(start, at);
    if (block.length === 0) {
      // Only reachable if the two tests above ever stop agreeing about what a
      // changed line is, and then this loop would never advance. Guaranteeing
      // progress costs a line; relying on it costs a hung tab.
      out.push(line);
      at += 1;
      continue;
    }

    const removed = block.filter(isRemoval).map((l) => l.slice(1));
    const added = block.filter(isAddition).map((l) => l.slice(1));

    // A pure insertion or a pure deletion has nothing that could turn out to be
    // the same line differently indented, so there is no budget to spend on it.
    if (removed.length === 0 || added.length === 0) {
      out.push(...block);
      continue;
    }

    if (budget.left <= 0) {
      budget.spent = true;
      out.push(...block);
      continue;
    }

    const changes = diffLines(`${removed.join('\n')}\n`, `${added.join('\n')}\n`, {
      ignoreWhitespace: true,
      maxEditLength: budget.left,
    });

    if (changes === undefined) {
      // It searched to the cap and did not finish. Charge the whole of it: the
      // work was done, and letting the next block start over from the same
      // budget is how one number stops bounding the file.
      budget.left = 0;
      budget.spent = true;
      out.push(...block);
      continue;
    }

    for (const change of changes) {
      // Every side was given a trailing newline, so the split always ends in an
      // empty string that is not a line.
      const lines = change.value.split('\n');
      lines.pop();

      const marker = change.added ? '+' : change.removed ? '-' : ' ';
      // Non-identical lines that compared equal come back as the *new* string's
      // version, which is the one that is in the file now and the one a
      // suggestion would be built from.
      for (const text of lines) out.push(`${marker}${text}`);
      if (change.added === true || change.removed === true) budget.left -= change.count;
    }
  }

  // The check that makes the line numbering safe by construction rather than by
  // argument. A context line covers a line on each side where the `-` and the
  // `+` it replaced covered one each, so these should be exactly what GitHub's
  // header said — and if they are not, this hunk is not worth the risk.
  //
  // A `\ No newline at end of file` marker is a note about the line above it
  // and not a line of either file, so it is not counted. Nothing reaches here
  // carrying one today — the carve-out above declines those hunks first — but
  // a counter that would misread them is a trap for whoever relaxes that.
  const counted = out.filter((l) => !l.startsWith('\\'));
  const oldLines = counted.filter((l) => !isAddition(l)).length;
  const newLines = counted.filter((l) => !isRemoval(l)).length;
  if (oldLines !== Number(header[2] ?? '1') || newLines !== Number(header[4] ?? '1')) {
    return null;
  }

  return out;
}

/**
 * GitHub's patch for one file, with its whitespace-only changes taken out.
 *
 * The header block and every `@@` line are copied through untouched; only the
 * markers in the bodies move, and only ever from a `-`/`+` pair to a single
 * context line. A hunk left with nothing changed in it is dropped, which is
 * what makes the mode worth having and is also the only way a line GitHub drew
 * can stop being drawn.
 */
export function withoutWhitespaceChanges(
  patch: string,
  budget: number = WHITESPACE_BUDGET,
): WhitespaceDiff {
  const lines = patch.split('\n');
  const first = lines.findIndex((line) => HUNK_HEADER.test(line));
  if (first === -1) {
    return { patch, hunks: 0, dropped: 0, partial: false };
  }

  const out: string[] = lines.slice(0, first);
  const spend = { left: budget, spent: false };
  let hunks = 0;
  let dropped = 0;

  let at = first;
  while (at < lines.length) {
    const headerLine = lines[at];
    const header = headerLine?.match(HUNK_HEADER);
    if (headerLine === undefined || header === null || header === undefined) {
      // Not reachable from a well-formed patch, and dropping the line silently
      // would be the wrong answer if it ever were.
      out.push(headerLine ?? '');
      at += 1;
      continue;
    }

    let end = at + 1;
    while (end < lines.length && !HUNK_HEADER.test(lines[end] ?? '')) end += 1;

    const body = lines.slice(at + 1, end);
    const rewritten = rewriteBody(header, body, spend);

    if (rewritten === null) {
      spend.spent = true;
      out.push(headerLine, ...body);
      hunks += 1;
    } else if (rewritten.some((l) => isRemoval(l) || isAddition(l))) {
      out.push(headerLine, ...rewritten);
      hunks += 1;
    } else {
      dropped += 1;
    }

    at = end;
  }

  return { patch: out.join('\n'), hunks, dropped, partial: spend.spent };
}
