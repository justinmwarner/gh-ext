import { describe, expect, it } from 'vitest';
import {
  WHITESPACE_BUDGET,
  whitespaceLabel,
  whitespaceNotice,
  withoutWhitespaceChanges,
} from './whitespace';

/** A patch in the shape `parseUnifiedDiff` hands on: git header, then hunks. */
const patch = (...body: string[]): string =>
  ['diff --git a/src/app.ts b/src/app.ts', '--- a/src/app.ts', '+++ b/src/app.ts', ...body].join(
    '\n',
  );

/** Every `@@` header in a patch, which is the whole of its line numbering. */
const headers = (text: string): string[] =>
  text.split('\n').filter((line) => line.startsWith('@@'));

const body = (text: string): string[] =>
  text.split('\n').filter((line) => !line.startsWith('@@') && !line.startsWith('diff ')) ;

describe('withoutWhitespaceChanges', () => {
  it('turns a line that only moved sideways into context', () => {
    // A real change elsewhere in the hunk, so the hunk survives and there is a
    // row left to look at. A hunk with nothing but the reindentation in it is
    // dropped outright, which is a different test.
    const result = withoutWhitespaceChanges(
      patch(
        '@@ -1,5 +1,5 @@',
        ' function f() {',
        '-  return 1;',
        '+    return 1;',
        ' middle',
        '-  const x = 2;',
        '+  const x = 3;',
        ' }',
      ),
    );

    // The reindented line is still on screen — it is still part of the file —
    // but it is no longer being claimed as a change.
    expect(body(result.patch)).toContain('     return 1;');
    expect(body(result.patch)).not.toContain('-  return 1;');
    expect(body(result.patch)).not.toContain('+    return 1;');
  });

  it('keeps a real change beside a reindented one', () => {
    const result = withoutWhitespaceChanges(
      patch(
        '@@ -1,4 +1,4 @@',
        ' function f() {',
        '-  return 1;',
        '-  const x = 2;',
        '+    return 1;',
        '+    const x = 3;',
        ' }',
      ),
    );

    expect(body(result.patch)).toContain('-  const x = 2;');
    expect(body(result.patch)).toContain('+    const x = 3;');
    expect(body(result.patch)).not.toContain('+    return 1;');
  });

  /**
   * The load-bearing test in this file.
   *
   * A comment is posted as a line number in GitHub's diff, and this rewrite is
   * the only thing between the reviewer's gutter click and that number. Merging
   * a `-`/`+` pair into one context line consumes one line on each side, which
   * is exactly what the pair consumed — so every subsequent line keeps the
   * number it had. If that ever stopped being true, comments would land on
   * whatever text happened to occupy the row instead, and nothing on screen
   * would say so.
   */
  it('never moves a line number GitHub gave', () => {
    const original = patch(
      '@@ -1,4 +1,4 @@ function f()',
      ' function f() {',
      '-  return 1;',
      '+    return 1;',
      ' }',
      '@@ -40,4 +40,4 @@ function g()',
      ' function g() {',
      '-  return 2;',
      '+  return 3;',
      ' }',
    );

    const result = withoutWhitespaceChanges(original);

    // Same headers, in the same order, section headings included.
    expect(headers(result.patch)).toEqual(headers(original));
  });

  it('drops a hunk in which nothing but whitespace moved', () => {
    const result = withoutWhitespaceChanges(
      patch(
        '@@ -1,3 +1,3 @@',
        ' a',
        '-  indented',
        '+\tindented',
        ' b',
        '@@ -40,3 +40,3 @@',
        ' c',
        '-old',
        '+new',
        ' d',
      ),
    );

    expect(headers(result.patch)).toEqual(['@@ -40,3 +40,3 @@']);
    expect(result.dropped).toBe(1);
    expect(result.hunks).toBe(1);
  });

  it('reports no hunks at all when the whole file only moved sideways', () => {
    const result = withoutWhitespaceChanges(
      patch('@@ -1,2 +1,2 @@', '-  a', '+\ta', '-  b', '+\tb'),
    );

    expect(result.hunks).toBe(0);
    expect(result.dropped).toBe(1);
    // The file headers survive, so the card still knows which file this is.
    expect(result.patch).toContain('diff --git a/src/app.ts b/src/app.ts');
  });

  it('leaves a patch with no whitespace-only change exactly as it arrived', () => {
    const original = patch('@@ -1,3 +1,3 @@', ' a', '-old', '+new', ' b');
    const result = withoutWhitespaceChanges(original);

    expect(result.patch).toBe(original);
    expect(result.dropped).toBe(0);
    expect(result.partial).toBe(false);
  });

  it('leaves a block with nothing to pair against alone', () => {
    // A pure insertion has no removed line that could turn out to be the same
    // line differently indented, so there is nothing to compute and no budget
    // to spend finding that out.
    const original = patch('@@ -1,1 +1,3 @@', ' a', '+  one', '+  two');
    expect(withoutWhitespaceChanges(original).patch).toBe(original);
  });

  it('shows the head version of a line it merged', () => {
    // The two texts differ, so one of them has to be the one drawn. The head
    // version is what is in the file now and what a suggestion would be built
    // from, so a reviewer reading the row is reading the code that shipped.
    const result = withoutWhitespaceChanges(
      patch('@@ -1,5 +1,5 @@', ' a', '-  x = 1', '+\t\tx = 1', ' b', '-p', '+q', ' c'),
    );

    expect(body(result.patch)).toContain(' \t\tx = 1');
  });

  it('passes a hunk carrying a no-newline marker through untouched', () => {
    // `\ No newline at end of file` attaches to the line above it, and merging
    // that line into context would leave the marker describing a row that no
    // longer exists. Rare enough that declining is better than a patch this
    // rewrote into something malformed.
    // The marker sits after an unchanged final line, so the `-`/`+` pair above
    // it is an ordinary block this would otherwise merge and drop the hunk for.
    // That is what makes this hunk's survival the carve-out's doing and not
    // some other guard's.
    const original = patch(
      '@@ -1,3 +1,3 @@',
      ' a',
      '-  x',
      '+\tx',
      ' b',
      '\\ No newline at end of file',
    );

    const result = withoutWhitespaceChanges(original);
    expect(result.patch).toBe(original);
    expect(result.partial).toBe(true);
    expect(result.dropped).toBe(0);
  });

  it('treats a bare empty line as the context line it is', () => {
    // Git writes an unchanged blank line as `''`, not as `' '`. Reading it as
    // anything else splits one change block into two and loses the pairing
    // across it.
    const result = withoutWhitespaceChanges(
      patch('@@ -1,4 +1,4 @@', ' a', '', '-  x', '+\tx', ' b'),
    );

    expect(headers(result.patch)).toEqual([]);
    expect(result.hunks).toBe(0);
  });

  it('stops when the budget runs out and says so', () => {
    // A budget of one against an edit distance of six. Passed in rather than
    // spread over the real constant, which has no shape to override — what is
    // under test is that the ceiling engages and reports, not the number.
    const original = patch(
      '@@ -1,3 +1,3 @@',
      ...Array.from({ length: 3 }, (_, i) => `-alpha ${i}`),
      ...Array.from({ length: 3 }, (_, i) => `+beta ${i}`),
    );

    const result = withoutWhitespaceChanges(original, 1);

    expect(result.partial).toBe(true);
    // What could not be recomputed is still GitHub's, rather than missing.
    expect(body(result.patch)).toContain('-alpha 0');
    expect(body(result.patch)).toContain('+beta 0');
  });

  it('charges the budget for a block that gave up, not just for one that finished', () => {
    // The ceiling only bounds the file if a block that searched to the cap and
    // found nothing is billed for the search. Otherwise every later block
    // starts again from the full budget and one number stops bounding
    // anything.
    //
    // The second hunk here is a reindentation and nothing else, so it is
    // cheap, would succeed, and would be dropped — if there were any budget
    // left. There is not, because the first hunk spent all of it failing.
    const original = patch(
      '@@ -1,4 +1,4 @@',
      '-alpha 0',
      '-alpha 1',
      '-alpha 2',
      '-alpha 3',
      '+beta 0',
      '+beta 1',
      '+beta 2',
      '+beta 3',
      '@@ -40,1 +40,1 @@',
      '-  reindented',
      '+\treindented',
    );

    const result = withoutWhitespaceChanges(original, 3);

    expect(result.partial).toBe(true);
    // Both hunks still here. The second one is untouched, not merged away.
    expect(headers(result.patch)).toEqual(['@@ -1,4 +1,4 @@', '@@ -40,1 +40,1 @@']);
    expect(result.dropped).toBe(0);
    expect(body(result.patch)).toContain('-  reindented');
  });

  it('keeps GitHub’s hunk when the rewrite would not cover the same lines', () => {
    // The header here lies about how long the hunk is, which is what a
    // malformed patch looks like from in here. The runtime check is the reason
    // no line number can move: it compares what the rewrite covers against
    // what the header claimed, and hands the hunk back untouched when they
    // disagree rather than emitting a patch whose rows have drifted.
    const original = patch('@@ -1,99 +1,99 @@', ' a', '-  x', '+\tx', ' b');
    const result = withoutWhitespaceChanges(original);

    expect(result.patch).toBe(original);
    expect(result.partial).toBe(true);
  });

  it('exposes its budget, so a caller can decide before it calls', () => {
    expect(WHITESPACE_BUDGET).toBeGreaterThan(0);
  });

  it('has nothing to say about a patch with no hunks at all', () => {
    const original = 'diff --git a/x b/x\nsimilarity index 100%\nrename from x\nrename to y';
    const result = withoutWhitespaceChanges(original);

    expect(result.patch).toBe(original);
    expect(result.hunks).toBe(0);
    expect(result.dropped).toBe(0);
  });
});

describe('whitespaceNotice', () => {
  const clean = { patch: '', hunks: 3, dropped: 0, partial: false, changed: true };

  it('always says the diff is ours and the line numbers are GitHub’s', () => {
    // Both halves are load-bearing and neither is optional. Without the first
    // a reviewer can report a line as unchanged that GitHub says changed;
    // without the second they have no reason to trust a comment they leave.
    const text = whitespaceNotice(clean);

    expect(text).toMatch(/recomputed here/i);
    expect(text).toMatch(/not the diff GitHub is showing/i);
    expect(text).toMatch(/GitHub’s line numbers/i);
  });

  it('says how much it took away, when it took anything away', () => {
    expect(whitespaceNotice({ ...clean, dropped: 1 })).toMatch(/One part of this file/);
    expect(whitespaceNotice({ ...clean, dropped: 4 })).toMatch(/4 parts of this file/);
  });

  it('says nothing about parts it did not take away', () => {
    expect(whitespaceNotice(clean)).not.toMatch(/hidden/);
  });

  it('says so when the whole file turned out to be whitespace', () => {
    // Otherwise the card is an empty rectangle with no account of itself.
    expect(whitespaceNotice({ ...clean, hunks: 0, dropped: 2 })).toMatch(
      /Nothing but whitespace changed anywhere/i,
    );
  });

  it('admits it when the ceiling stopped it part way', () => {
    expect(whitespaceNotice({ ...clean, partial: true })).toMatch(
      /still shown as GitHub sent it/i,
    );
  });
});

/**
 * Whether the rewrite is worth mentioning at all.
 *
 * The setting is on for every file in the pull request, so this is what stops
 * eighteen untouched files wearing the same caveat as the one reindented one.
 */
describe('what the rewrite changed', () => {
  it('reports no change when there was nothing to take out', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
    ].join('\n');

    const result = withoutWhitespaceChanges(patch);

    expect(result.changed).toBe(false);
    expect(result.patch).toBe(patch);
  });

  it('reports a change when a line merged away inside a surviving hunk', () => {
    // The case the counters cannot see, and the one this whole feature exists
    // for: the hunk is still here, so `dropped` is 0, but it is two rows
    // shorter than GitHub's.
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '@@ -1,4 +1,4 @@',
      ' one',
      '-  spaced',
      '+    spaced',
      '-two',
      '+TWO',
      ' three',
    ].join('\n');

    const result = withoutWhitespaceChanges(patch);

    expect(result.changed).toBe(true);
    expect(result.dropped).toBe(0);
    expect(result.patch).not.toBe(patch);
  });

  it('reports no change for a patch with no hunks in it at all', () => {
    expect(withoutWhitespaceChanges('').changed).toBe(false);
  });
});

describe('whitespaceLabel', () => {
  const clean = { patch: '', hunks: 3, dropped: 1, partial: false, changed: true };

  it('says what was hidden while there is still a diff to read', () => {
    expect(whitespaceLabel(clean)).toBe('Whitespace hidden');
  });

  it('says the file was nothing else, when the card is left empty', () => {
    // The header is all there is on such a card, so it has to account for the
    // emptiness rather than describe a diff that is not below it.
    expect(whitespaceLabel({ ...clean, hunks: 0 })).toBe('Only whitespace');
  });

  it('stays short enough for the row it sits on', () => {
    // It shares the head row with the path, the counts and the viewed
    // checkbox, and that row is not allowed to wrap or grow.
    for (const hunks of [0, 3]) {
      expect(whitespaceLabel({ ...clean, hunks }).length).toBeLessThanOrEqual(20);
    }
  });
});
