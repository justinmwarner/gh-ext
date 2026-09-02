/**
 * Deciding what Pierre can be trusted to draw, and what has to be listed.
 *
 * The whole point of this module is the demotion: `partitionThreads` knows a
 * thread has a line number, but it does not know which lines the renderer will
 * actually put on screen. Pierre drops an annotation outside a rendered hunk
 * with no error at all, so a thread reported as `anchored` here and then not
 * rendered is a comment the reviewer never learns exists.
 */

import { parsePatchFiles } from '@pierre/diffs';
import type { FileDiffMetadata } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import {
  isRenderedLine,
  layoutThreads,
  orderedThreads,
  renderedLines,
  sourceLines,
  threadPosition,
  unresolvedJumps,
} from './reviewThreads';
import { reviewThread } from './prPayload.fixture';

/**
 * Two hunks with a gap between them, so lines 4–19 exist in the file and are
 * not rendered. That gap is the case the cross-check exists for.
 */
const TWO_HUNKS = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-before',
  '+after',
  ' three',
  '@@ -20,3 +20,3 @@',
  ' twenty',
  '-old',
  '+new',
  ' twentytwo',
].join('\n');

function parse(patch: string): FileDiffMetadata {
  const file = parsePatchFiles(patch)[0]?.files[0];
  if (file === undefined) throw new Error('the fixture patch did not parse');
  return file;
}

const twoHunks = (): FileDiffMetadata => parse(TWO_HUNKS);

describe('renderedLines', () => {
  it('reports the line span of every hunk on both sides', () => {
    expect(renderedLines(twoHunks())).toEqual({
      additions: [
        { start: 1, end: 3 },
        { start: 20, end: 22 },
      ],
      deletions: [
        { start: 1, end: 3 },
        { start: 20, end: 22 },
      ],
    });
  });

  it('reports nothing for a file with no hunks', () => {
    expect(renderedLines({ ...twoHunks(), hunks: [] })).toEqual({
      additions: [],
      deletions: [],
    });
  });
});

describe('isRenderedLine', () => {
  const lines = renderedLines(twoHunks());

  it('accepts a line inside a hunk', () => {
    expect(isRenderedLine(lines, 'additions', 2)).toBe(true);
    expect(isRenderedLine(lines, 'additions', 20)).toBe(true);
  });

  it('rejects a line in the collapsed gap between hunks', () => {
    expect(isRenderedLine(lines, 'additions', 10)).toBe(false);
  });

  it('rejects a line past the last hunk', () => {
    expect(isRenderedLine(lines, 'deletions', 99)).toBe(false);
  });
});

describe('layoutThreads', () => {
  it('anchors a thread that lands inside a rendered hunk', () => {
    const thread = reviewThread({ path: 'src/app.ts', line: 2 });

    const layout = layoutThreads([thread], twoHunks());

    expect(layout.annotations).toHaveLength(1);
    expect(layout.annotations[0]?.side).toBe('additions');
    expect(layout.annotations[0]?.lineNumber).toBe(2);
    expect(layout.listed).toHaveLength(0);
  });

  it('demotes a thread whose line exists in the file but not in any hunk', () => {
    // The failure this module exists to prevent. `partitionThreads` calls this
    // thread anchored — it has a line — and Pierre would then drop it without
    // a word, so the reviewer would never see the comment at all.
    const thread = reviewThread({ path: 'src/app.ts', line: 10 });

    const layout = layoutThreads([thread], twoHunks());

    expect(layout.annotations).toHaveLength(0);
    expect(layout.listed).toEqual([{ thread, reason: 'out-of-hunk' }]);
  });

  it('lists an outdated thread, which carries no line at all', () => {
    const thread = reviewThread({
      path: 'src/app.ts',
      line: null,
      startLine: null,
      originalLine: 194,
      isOutdated: true,
    });

    const layout = layoutThreads([thread], twoHunks());

    expect(layout.annotations).toHaveLength(0);
    expect(layout.listed).toEqual([{ thread, reason: 'outdated' }]);
  });

  it('lists a file-level thread, which has no line to anchor to', () => {
    const thread = reviewThread({ path: 'src/app.ts', subjectType: 'FILE' });

    const layout = layoutThreads([thread], twoHunks());

    expect(layout.annotations).toHaveLength(0);
    expect(layout.listed).toEqual([{ thread, reason: 'file-level' }]);
  });

  it('anchors a LEFT-side thread to the deletions column', () => {
    const thread = reviewThread({ path: 'src/app.ts', line: 2, diffSide: 'LEFT' });

    const layout = layoutThreads([thread], twoHunks());

    expect(layout.annotations[0]?.side).toBe('deletions');
  });

  it('anchors a multi-line thread to its end line, as Pierre requires', () => {
    const thread = reviewThread({
      path: 'src/app.ts',
      line: 22,
      startLine: 20,
      startDiffSide: 'RIGHT',
    });

    const layout = layoutThreads([thread], twoHunks());

    expect(layout.annotations[0]?.lineNumber).toBe(22);
  });

  it('hands back the same metadata object for the same thread id', () => {
    // Pierre compares annotation metadata by reference. A fresh object each
    // time reads as a changed annotation and rebuilds the row's DOM.
    const memo = new Map<string, { kind: 'thread'; threadId: string }>();
    const thread = reviewThread({ path: 'src/app.ts', line: 2 });

    const first = layoutThreads([thread], twoHunks(), memo);
    const second = layoutThreads(
      [{ ...thread, isResolved: true }],
      twoHunks(),
      memo,
    );

    expect(first.annotations[0]?.metadata).toBe(second.annotations[0]?.metadata);
  });
});

describe('threadPosition', () => {
  it('names the single line a thread sits on', () => {
    expect(threadPosition(reviewThread({ path: 'a.ts', line: 12 }))).toBe('Line 12');
  });

  it('names both ends of a multi-line thread', () => {
    // `anchorThread` collapses the range to its end line because Pierre cannot
    // express one. Without this the range is invisible and a comment on five
    // lines reads as a comment on the last of them.
    const thread = reviewThread({
      path: 'a.ts',
      line: 9,
      startLine: 5,
      startDiffSide: 'RIGHT',
    });

    expect(threadPosition(thread)).toBe('Lines 5-9');
  });

  it('says where an outdated thread used to be', () => {
    // `line` is null on an outdated thread but `originalLine` is populated, so
    // "somewhere in this file" is never the best that can be said.
    const thread = reviewThread({
      path: 'a.ts',
      line: null,
      startLine: null,
      originalLine: 194,
      isOutdated: true,
    });

    expect(threadPosition(thread)).toBe('was on line 194');
  });

  it('says where an outdated multi-line thread used to be', () => {
    const thread = reviewThread({
      path: 'a.ts',
      line: null,
      startLine: null,
      originalLine: 194,
      originalStartLine: 190,
      isOutdated: true,
    });

    expect(threadPosition(thread)).toBe('was on lines 190-194');
  });

  it('names a file-level thread as covering the file', () => {
    expect(threadPosition(reviewThread({ path: 'a.ts', subjectType: 'FILE' }))).toBe(
      'Whole file',
    );
  });
});

describe('sourceLines', () => {
  it('reads the new-file text a suggestion would replace', () => {
    expect(sourceLines(twoHunks(), 'RIGHT', 20, 22)).toEqual([
      'twenty',
      'new',
      'twentytwo',
    ]);
  });

  it('reads the old-file text for a LEFT-side selection', () => {
    expect(sourceLines(twoHunks(), 'LEFT', 2, 2)).toEqual(['before']);
  });

  it('returns nothing for lines the patch does not carry', () => {
    expect(sourceLines(twoHunks(), 'RIGHT', 10, 12)).toEqual([]);
  });
});

describe('unresolvedJumps', () => {
  it('lists only unresolved threads', () => {
    const jumps = unresolvedJumps(
      [
        reviewThread({ path: 'src/app.ts', line: 2 }),
        reviewThread({ path: 'src/app.ts', line: 9, isResolved: true }),
      ],
      ['src/app.ts'],
    );

    expect(jumps.map((jump) => jump.threadId)).toEqual(['PRRT_src/app.ts:2']);
  });

  it('orders by the column, then by line within a file', () => {
    const jumps = unresolvedJumps(
      [
        reviewThread({ path: 'src/app.ts', line: 9 }),
        reviewThread({ path: 'README.md', line: 1 }),
        reviewThread({ path: 'src/app.ts', line: 2 }),
      ],
      ['README.md', 'src/app.ts'],
    );

    expect(jumps.map((jump) => jump.threadId)).toEqual([
      'PRRT_README.md:1',
      'PRRT_src/app.ts:2',
      'PRRT_src/app.ts:9',
    ]);
  });

  it('keeps a thread whose file is not in the diff, and says so', () => {
    // `files` is capped and threads are not, so a large pull request really can
    // carry comments on files the column never received. Dropping them here
    // would make them invisible: this list is the only global index of threads.
    const jumps = unresolvedJumps(
      [reviewThread({ path: 'lib/dropped.ts', line: 3 })],
      ['src/app.ts'],
    );

    expect(jumps.length).toBe(1);
    expect(jumps[0]?.path).toBe('lib/dropped.ts');
    expect(jumps[0]?.inDiff).toBe(false);
  });

  it('puts files the column knows about first', () => {
    const jumps = unresolvedJumps(
      [
        reviewThread({ path: 'zzz/absent.ts', line: 1 }),
        reviewThread({ path: 'src/app.ts', line: 1 }),
      ],
      ['src/app.ts'],
    );

    expect(jumps.map((jump) => jump.path)).toEqual(['src/app.ts', 'zzz/absent.ts']);
  });

  it('carries something to recognize the thread by', () => {
    const jumps = unresolvedJumps([reviewThread({ path: 'src/app.ts', line: 2 })], [
      'src/app.ts',
    ]);

    expect(jumps[0]?.position).toBe('Line 2');
    expect(jumps[0]?.excerpt).toContain('This allocates');
  });

  it('sorts an outdated thread with no line last within its file', () => {
    const jumps = unresolvedJumps(
      [
        reviewThread({
          path: 'src/app.ts',
          line: null,
          startLine: null,
          originalLine: 4,
          isOutdated: true,
        }),
        reviewThread({ path: 'src/app.ts', line: 9 }),
      ],
      ['src/app.ts'],
    );

    expect(jumps.map((jump) => jump.threadId)).toEqual([
      'PRRT_src/app.ts:9',
      'PRRT_src/app.ts:none',
    ]);
  });
});

describe('orderedThreads', () => {
  it('reads in the column’s file order, then by line', () => {
    // The order `n` and `p` step through. It has to be the column's order, not
    // the payload's, or the keyboard walks the review out of sequence.
    const ordered = orderedThreads(
      [
        reviewThread({ path: 'b.ts', line: 5 }),
        reviewThread({ path: 'a.ts', line: 9 }),
        reviewThread({ path: 'a.ts', line: 2 }),
      ],
      ['a.ts', 'b.ts'],
    );

    expect(ordered.map(({ thread }) => thread.id)).toEqual([
      'PRRT_a.ts:2',
      'PRRT_a.ts:9',
      'PRRT_b.ts:5',
    ]);
  });

  it('keeps a resolved thread, because `n` walks all of them', () => {
    const ordered = orderedThreads(
      [reviewThread({ path: 'a.ts', line: 2, isResolved: true })],
      ['a.ts'],
    );

    expect(ordered).toHaveLength(1);
  });

  it('puts a thread on a file the column never got last, and says so', () => {
    const ordered = orderedThreads(
      [
        reviewThread({ path: 'dropped.ts', line: 1 }),
        reviewThread({ path: 'a.ts', line: 2 }),
      ],
      ['a.ts'],
    );

    expect(ordered.map(({ thread, inDiff }) => [thread.path, inDiff])).toEqual([
      ['a.ts', true],
      ['dropped.ts', false],
    ]);
  });

  it('sorts an outdated thread to the end of its file rather than the top', () => {
    // It has no `line` at all. Treating that as zero would put every stale
    // comment first.
    const ordered = orderedThreads(
      [
        reviewThread({ path: 'a.ts', line: null, isOutdated: true, id: 'stale' }),
        reviewThread({ path: 'a.ts', line: 2 }),
      ],
      ['a.ts'],
    );

    expect(ordered.map(({ thread }) => thread.id)).toEqual(['PRRT_a.ts:2', 'stale']);
  });
});
