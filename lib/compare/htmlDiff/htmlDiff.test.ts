/**
 * The word diff over two rendered documents.
 *
 * This is the piece that makes a rendered Markdown view worth having at all. A
 * rendered before and after, side by side, is *harder* to read than the source
 * diff — the source diff at least paints the words that moved. This puts those
 * marks back, inside the formatting, which is the only version of the idea that
 * beats the text it replaces.
 *
 * The properties asserted here are the ones the renderer downstream depends on:
 * the marks are `<ins>` and `<del>` with known classes, the surrounding
 * structure survives untouched, and the same two documents always produce the
 * same answer. That last one is not idle — see the note about the global regex
 * in the port.
 */

import { describe, expect, it } from 'vitest';
import { HTML_DIFF_BUDGET, diffHtml } from './htmlDiff';

describe('marking what moved', () => {
  it('returns an unchanged document exactly as it arrived', () => {
    const html = '<h1>Title</h1>\n<p>A paragraph.</p>';

    expect(diffHtml(html, html)).toBe(html);
  });

  it('marks a replaced word in place, leaving the sentence around it alone', () => {
    const out = diffHtml('<p>the quick brown fox</p>', '<p>the quick red fox</p>');

    expect(out).toContain('<del class="diffmod">brown</del>');
    expect(out).toContain('<ins class="diffmod">red</ins>');
    // The words either side are untouched, which is the whole point: a reader
    // sees one changed word rather than a repainted paragraph.
    expect(out).toContain('quick');
    expect(out).not.toContain('<ins class="diffmod">quick</ins>');
  });

  it('marks an addition as an insertion and nothing else', () => {
    const out = diffHtml('<p>one</p>', '<p>one</p><p>two</p>');

    expect(out).toContain('<ins class="diffins">');
    expect(out).toContain('two');
    expect(out).not.toContain('diffdel');
  });

  it('marks a removal as a deletion and keeps the removed words visible', () => {
    const out = diffHtml('<p>one</p><p>two</p>', '<p>one</p>');

    expect(out).toContain('<del class="diffdel">');
    // The removed text is still in the output. A rendered diff that dropped it
    // would be a rendered preview, which is the thing this exists instead of.
    expect(out).toContain('two');
  });

  it('keeps the block structure the renderer produced', () => {
    const out = diffHtml(
      '<h1>Guide</h1><ul><li>alpha</li><li>beta</li></ul>',
      '<h1>Guide</h1><ul><li>alpha</li><li>gamma</li></ul>',
    );

    expect(out).toContain('<h1>Guide</h1>');
    expect(out).toContain('<li>');
    expect(out).toContain('gamma');
    expect(out).toContain('beta');
  });
});

describe('the defects the port had to fix', () => {
  it('gives the same answer every time it is asked', () => {
    // Upstream tests a module-level `/…/ig` regex with `.test()`, and a global
    // regex resumes from the `lastIndex` the previous call left behind — so
    // the same two documents diffed twice give two different answers. Measured
    // against the real package: 107 of 40,000 random pairs of short formatted
    // paragraphs change between two back-to-back calls, and this is one of
    // them. A comparison that moves when you look at it twice is not one.
    //
    // Only runs that *begin* with an inline formatting tag reach the regex at
    // all, which is why the pair below is two whole tagged words rather than
    // an edit inside a sentence.
    const before = '<p><i>gamma</i></p>';
    const after = '<p><sup>delta</sup></p>';

    const answers = new Set([
      diffHtml(before, after),
      diffHtml(before, after),
      diffHtml(before, after),
      diffHtml(before, after),
    ]);

    expect(answers.size).toBe(1);
  });

  it('is not disturbed by an unrelated document diffed in between', () => {
    // The sharper half of the same defect: upstream's leftover `lastIndex`
    // crosses call boundaries, so diffing somebody else's file changes the
    // answer for a file already on screen. 77 of 40,000 random triples.
    const before = '<p>beta</p>';
    const after = '<p>y gamma x <u>beta</u></p>';

    const first = diffHtml(before, after);
    diffHtml(
      '<p><strong>delta</strong> <b>delta</b> <em>beta</em></p>',
      '<p><b>beta</b> <em>delta</em> <em>y</em></p>',
    );

    expect(diffHtml(before, after)).toBe(first);
  });

  it('survives a lone angle bracket pair rather than throwing', () => {
    // `< >` satisfies the "is this a tag" test and then fails the "what is its
    // name" test, so upstream indexes `null[0]` and takes the whole card down.
    // Nothing upstream of here guarantees it never arrives.
    expect(() => diffHtml('<p>use < > here</p>', '<p>use < > there</p>')).not.toThrow();
  });

  it('keeps a non-breaking space glued to the whitespace beside it', () => {
    // Upstream behaviour, preserved rather than fixed, and worth a test of its
    // own because it is easy to read as dead weight and delete. A `&nbsp;` next
    // to a real space becomes one whitespace token; separately, a run that is
    // marked up gets its *leading* bare space rewritten to `&nbsp;` so it does
    // not collapse against the tag written before it. Remove the merge and
    // those two rules meet: the space at the front of this deletion is now its
    // own token, gets rewritten, and the reader is shown `&nbsp;&nbsp;` where
    // the document said space-nbsp-space.
    //
    // Changing text while claiming to mark it is the one thing this must not
    // do, so the assertion is that the whitespace survives verbatim.
    const out = diffHtml('<p>x &nbsp; 42</p>', '<p>42 x</p>');

    expect(out).toContain(' &nbsp; ');
    expect(out).not.toContain('&nbsp;&nbsp;');
  });

  it('is the same shape as upstream even where the port spells it differently', () => {
    // The merged token is built as a string; upstream builds it as
    // `[(w1 + w2).split()]`, an array inside an array. That is a *typing*
    // correction and nothing more — `join` stringifies the nested array to the
    // same characters — and putting upstream's shape back changes nothing any
    // test here can see. Recorded so nobody re-derives it as a defect.
    const out = diffHtml('<p>a&nbsp; b</p>', '<p>a&nbsp; c</p>');

    expect(out).toContain('&nbsp;');
    expect(out).not.toContain(',');
  });
});

describe('the work budget', () => {
  it('declines rather than freezing on a document built to collide', () => {
    // Every block index key is identical, so each position on one side walks
    // every position on the other. Unbounded, 8,000 of these words took eleven
    // seconds of main thread and 32,000 took three and a half minutes — the
    // cost is in the collisions, not the size, which is why no character count
    // could have caught it.
    const before = `<p>${'word '.repeat(8000)}</p>`;
    const after = `<p>${'word '.repeat(8000)}x</p>`;

    const started = Date.now();
    expect(diffHtml(before, after)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns nothing rather than a document with only some marks on it', () => {
    // The failure a reviewer cannot see: half a marked-up document reads
    // exactly like a document in which only those things changed.
    const before = '<p>alpha beta gamma delta</p>';
    const after = '<p>alpha epsilon gamma zeta</p>';

    expect(diffHtml(before, after, 1)).toBeNull();
  });

  it('spends nothing at all on two identical documents', () => {
    // The equality short-circuit is above the budget, and needs to stay there:
    // an unchanged file is the common case in a large pull request.
    const html = `<p>${'word '.repeat(8000)}</p>`;

    expect(diffHtml(html, html, 1)).toBe(html);
  });

  it('gives a real document room to finish, with most of the budget unspent', () => {
    // The bound is only worth having if it never fires on the files the mode
    // exists for. This is README-shaped — varied prose rather than one sentence
    // repeated, which is the difference between the cheap case and the case
    // the budget exists for. Measured against real files, this repository's
    // README needs 21,829 of the two million and its comparison spec 92,840.
    const lines = [
      'The loader reads both sides of the change from the worker',
      'Nothing here persists and that is deliberate rather than unfinished',
      'A mode that cannot answer honestly is not offered at all',
      'Every budget is an exported constant so that it can be argued with',
      'Raw sits on every file and it is always last in the row',
      'Two versions of a picture have no lines between them to compare',
      'Reindenting a document rewrites every line while changing nothing',
      'The sanitiser runs after the diff and never before it',
    ];
    // Every section differs from every other one. That is the property being
    // tested, not the length: sixty *identical* sections cost more than six
    // hundred varied ones, which is the whole reason the bound counts
    // comparisons rather than characters.
    const document = (swap: boolean): string => {
      let out = '';
      for (let s = 0; s < 60; s += 1) {
        const line = lines[s % lines.length] ?? '';
        const body = swap && s % 5 === 0 ? line.replace('the', 'a certain') : line;
        out += `<h2>Chapter ${s} of the guide</h2><p>${body}, numbered ${s} for reference ${s * 7}.</p>`;
      }
      return out;
    };

    // A tenth of the budget is enough, which is the headroom worth asserting:
    // a test that only checked the default would still pass with the bound an
    // order of magnitude too tight.
    expect(diffHtml(document(false), document(true), HTML_DIFF_BUDGET / 10)).not.toBeNull();
  });
});

describe('what it does not do', () => {
  it('does not sanitise, and is not the place that will', () => {
    // Stated as a test because the security of this feature rests on it being
    // false. Sanitising here would let the diff step below reintroduce
    // structure afterwards; the sanitiser runs last, in `ui/`, on the finished
    // string. If this ever starts passing the other way, that seam has moved
    // and the reason it exists has been forgotten.
    const out = diffHtml('<p>safe</p>', '<p>safe<script>alert(1)</script></p>');

    expect(out).toContain('<script>');
  });
});
