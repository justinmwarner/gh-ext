/**
 * Which lines a comment can reach, read out of a patch.
 *
 * The cases below are written as patches rather than as fixtures because a
 * patch is what GitHub sends and every shape here is one it sends: a header
 * with its counts omitted, a `\ No newline at end of file`, a hunk that adds to
 * a file with nothing in it. Each is a shape that breaks a walk which trusted
 * the header's counts or treated every non-`+` line as context.
 *
 * A miscount here does not lose a comment, it moves one, which is why the
 * multi-hunk cases assert the numbers after the gap rather than only inside the
 * first hunk.
 */

import { describe, expect, it } from 'vitest';
import { commentableLines, isCommentable } from './commentable';

const PATCH = [
  '@@ -1,3 +1,4 @@',
  ' context one',
  '-removed',
  '+added',
  '+also added',
  ' context two',
].join('\n');

describe('commentableLines', () => {
  it('accepts an added line on the right', () => {
    expect(commentableLines(PATCH).has('RIGHT:2')).toBe(true);
  });

  it('accepts a context line on both sides', () => {
    expect(commentableLines(PATCH).has('RIGHT:1')).toBe(true);
    expect(commentableLines(PATCH).has('LEFT:1')).toBe(true);
  });

  it('accepts a removed line on the left only', () => {
    expect(commentableLines(PATCH).has('LEFT:2')).toBe(true);
    expect(commentableLines(PATCH).has('RIGHT:99')).toBe(false);
  });

  it('is empty for a patch with no hunks', () => {
    expect(commentableLines('').size).toBe(0);
  });

  it('numbers both sides independently through a mixed hunk', () => {
    // The whole walk, asserted as a set rather than a sample, because the bug
    // this guards against is an off-by-one that leaves every individual
    // membership test still passing somewhere.
    expect([...commentableLines(PATCH)].sort()).toEqual(
      ['LEFT:1', 'LEFT:2', 'LEFT:3', 'RIGHT:1', 'RIGHT:2', 'RIGHT:3', 'RIGHT:4'].sort(),
    );
  });

  it('is empty for a patch that is only a header and no hunk', () => {
    expect(commentableLines('diff --git a/x.md b/x.md\n--- a/x.md\n+++ b/x.md').size).toBe(0);
  });
});

describe('the shapes that break a naive walk', () => {
  it('reads a header whose counts are omitted, which means one', () => {
    // `@@ -1 +1 @@` is legal and common on a one-line file.
    const lines = commentableLines(['@@ -1 +1 @@', '-old', '+new'].join('\n'));

    expect(lines.has('LEFT:1')).toBe(true);
    expect(lines.has('RIGHT:1')).toBe(true);
    expect(lines.size).toBe(2);
  });

  it('lets the "no newline" marker advance neither counter', () => {
    const lines = commentableLines(
      [
        '@@ -1,2 +1,2 @@',
        '-old last',
        '\\ No newline at end of file',
        '+new last',
        '\\ No newline at end of file',
        ' after',
      ].join('\n'),
    );

    // Counting the marker as context would have put `after` at 3 on both sides
    // and quietly moved every comment below it.
    expect(lines.has('LEFT:2')).toBe(true);
    expect(lines.has('RIGHT:2')).toBe(true);
    expect(lines.has('LEFT:3')).toBe(false);
    expect(lines.has('RIGHT:3')).toBe(false);
  });

  it('picks up each hunk of a multi-hunk patch at the number its header gives', () => {
    const lines = commentableLines(
      [
        '@@ -1,2 +1,2 @@',
        ' top',
        '-first old',
        '+first new',
        '@@ -40,3 +40,3 @@ function far away() {',
        ' before',
        '-second old',
        '+second new',
        ' after',
      ].join('\n'),
    );

    expect(lines.has('LEFT:2')).toBe(true);
    expect(lines.has('RIGHT:2')).toBe(true);
    // The gap between the hunks is nobody's line, and the second hunk restarts
    // from its own header rather than continuing to count.
    expect(lines.has('RIGHT:3')).toBe(false);
    expect(lines.has('RIGHT:20')).toBe(false);
    expect(lines.has('LEFT:41')).toBe(true);
    expect(lines.has('RIGHT:41')).toBe(true);
    expect(lines.has('RIGHT:42')).toBe(true);
  });

  it('treats a hunk header with trailing section text as a header', () => {
    // git puts the enclosing function after the closing `@@`, and a walk that
    // anchored on the whole line would miss it and number from the wrong place.
    const lines = commentableLines('@@ -7,1 +7,1 @@ ## Heading\n+added');

    expect(lines.has('RIGHT:7')).toBe(true);
  });

  it('reads a hunk that adds to a file with nothing in it', () => {
    const lines = commentableLines('@@ -0,0 +1,2 @@\n+one\n+two');

    expect(lines.has('RIGHT:1')).toBe(true);
    expect(lines.has('RIGHT:2')).toBe(true);
    // Nothing on the left: there is no old file to comment on.
    expect([...lines].some((key) => key.startsWith('LEFT:'))).toBe(false);
  });

  it('reads a blank context line stripped of its leading space as context', () => {
    // Git writes a blank context line as a single space; plenty of things that
    // handle patches on the way here strip trailing whitespace and leave an
    // empty string. Reading it as anything but context desynchronises both
    // counters for the rest of the file.
    const lines = commentableLines(['@@ -1,3 +1,3 @@', ' one', '', '-three', '+four'].join('\n'));

    expect(lines.has('LEFT:2')).toBe(true);
    expect(lines.has('RIGHT:2')).toBe(true);
    expect(lines.has('LEFT:3')).toBe(true);
    expect(lines.has('RIGHT:3')).toBe(true);
  });

  it('does not count the --- and +++ of a second file as changed lines', () => {
    // A `ReviewFile` patch holds one file, but a combined diff is the shape
    // that would silently add a bogus line 1 on each side.
    const lines = commentableLines(
      [
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        'diff --git a/b.md b/b.md',
        '--- a/b.md',
        '+++ b/b.md',
        '@@ -5,1 +5,1 @@',
        '+later',
      ].join('\n'),
    );

    expect(lines.has('RIGHT:1')).toBe(true);
    expect(lines.has('RIGHT:5')).toBe(true);
    expect(lines.has('RIGHT:2')).toBe(false);
    expect(lines.has('LEFT:2')).toBe(false);
  });

  it('ignores a line that merely begins with @@', () => {
    // Every `+` line of a patch is content somebody wrote, and this project
    // already found this shape once: see `hasHunks` in `ui/diffItems.ts`.
    const lines = commentableLines('@@ -1,2 +1,2 @@\n+const x = "@@ -9 +9 @@";\n+after');

    expect(lines.has('RIGHT:1')).toBe(true);
    expect(lines.has('RIGHT:2')).toBe(true);
    expect(lines.has('RIGHT:9')).toBe(false);
  });
});

describe('isCommentable', () => {
  it('reads the set for one side and line', () => {
    const lines = commentableLines(PATCH);
    expect(isCommentable(lines, { side: 'RIGHT', line: 2 })).toBe(true);
    expect(isCommentable(lines, { side: 'RIGHT', line: 400 })).toBe(false);
  });

  it('keeps the two sides apart', () => {
    const lines = commentableLines(PATCH);
    // Line 2 is the removed line on the left and an added line on the right.
    // Both are commentable, and a set that had merged the sides would say the
    // same thing while being wrong about every deletion in the file.
    expect(isCommentable(lines, { side: 'LEFT', line: 2 })).toBe(true);
    expect(isCommentable(lines, { side: 'LEFT', line: 4 })).toBe(false);
    expect(isCommentable(lines, { side: 'RIGHT', line: 4 })).toBe(true);
  });

  it('says no to every block of a document with no patch', () => {
    // The common case on a rendered README: the file is drawn whole and most of
    // it is outside every hunk, which is the reason this predicate exists.
    const lines = commentableLines('');
    expect(isCommentable(lines, { side: 'RIGHT', line: 1 })).toBe(false);
  });
});
