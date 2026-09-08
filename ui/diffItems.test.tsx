/**
 * Turning changed files into what `@pierre/diffs` can render.
 *
 * Three kinds of file have no diff to show — binary blobs, files whose patch
 * GitHub refused to send, and renames that moved without changing. Each has to
 * say so in its own words. A card that renders nothing is indistinguishable
 * from a card that failed.
 */

import { describe, expect, it } from 'vitest';
import { withoutWhitespaceChanges } from '@/lib/review/whitespace';
import { codeViewItems, fileBody, hasHunks, hunkStops } from './diffItems';
import type { ReviewFile } from './reviewFiles';

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
 const a = 1;
-console.log('old');
+console.log('new');
`;

const file = (overrides: Partial<ReviewFile> = {}): ReviewFile => ({
  path: 'src/app.ts',
  oldPath: 'src/app.ts',
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch: PATCH,
  additions: 1,
  deletions: 1,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
  ...overrides,
});

describe('hasHunks', () => {
  it('sees a hunk header', () => {
    expect(hasHunks(PATCH)).toBe(true);
  });

  it('does not mistake a body line beginning with @@ for a hunk header', () => {
    expect(hasHunks('diff --git a/x b/x\n+const at = "@@ -1 +1 @@";\n')).toBe(false);
  });

  it('reports an empty patch honestly', () => {
    expect(hasHunks('')).toBe(false);
  });
});

describe('fileBody', () => {
  it('renders the diff when there is one', () => {
    expect(fileBody(file())).toEqual({ kind: 'diff', message: null });
  });

  it('says a binary file is binary', () => {
    const body = fileBody(file({ path: 'logo.png', isBinary: true }));

    expect(body.kind).toBe('binary');
    expect(body.message).toMatch(/binary/i);
  });

  it('says when GitHub withheld the patch, and why', () => {
    const body = fileBody(
      file({ path: 'huge.sql', patch: '', patchOmitted: true }),
    );

    expect(body.kind).toBe('omitted');
    expect(body.message).toMatch(/github/i);
  });

  it('prefers the withheld-patch message over the binary one', () => {
    // Both are true of a big binary on the fallback path. "We do not have it"
    // is the more actionable of the two, so it wins.
    expect(
      fileBody(file({ isBinary: true, patch: '', patchOmitted: true })).kind,
    ).toBe('omitted');
  });

  it('names both paths when a rename moved nothing else', () => {
    const body = fileBody(
      file({
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        isRename: true,
        patch: 'diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\n',
      }),
    );

    expect(body.kind).toBe('renamed-only');
    expect(body.message).toContain('src/old.ts');
    expect(body.message).toContain('src/new.ts');
  });

  it('renders the diff for a rename that also changed content', () => {
    expect(
      fileBody(file({ path: 'src/new.ts', oldPath: 'src/old.ts', isRename: true })).kind,
    ).toBe('diff');
  });

  it('explains a patch with no hunks that is not a rename', () => {
    const body = fileBody(
      file({ patch: 'diff --git a/x b/x\nold mode 100644\nnew mode 100755\n' }),
    );

    expect(body.kind).toBe('no-content');
    expect(body.message).not.toBeNull();
  });
});

/** One memoized annotation payload, as the column would hand it over. */
const THREAD = { kind: 'thread', threadId: 'PRRT_1' } as const;

describe('codeViewItems', () => {
  it('makes one diff item per file, identified by its path', () => {
    const items = codeViewItems(
      [file({ path: 'src/a.ts' }), file({ path: 'src/b.ts' })],
      new Set(),
    );

    expect(items.map((i) => i.id)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(items.every((i) => i.type === 'diff')).toBe(true);
  });

  it('collapses a file the reviewer collapsed', () => {
    const items = codeViewItems([file({ path: 'src/a.ts' })], new Set(['src/a.ts']));

    expect(items[0]?.collapsed).toBe(true);
  });

  it('changes an item’s version when its collapsed state changes', () => {
    // CodeView reconciles controlled items against `version`. Without a change
    // here the collapse toggle would move our state and not the viewer's.
    const open = codeViewItems([file({ path: 'src/a.ts' })], new Set());
    const shut = codeViewItems([file({ path: 'src/a.ts' })], new Set(['src/a.ts']));

    expect(open[0]?.version).not.toBe(shut[0]?.version);
  });

  it('changes an item’s version when only the comparison mode changed', () => {
    // Between two rich modes nothing else about the item moves — same diff,
    // same annotations, still collapsed — and the whole body of the card has
    // been replaced. `SlotPortals` also memoizes on the identity of
    // `renderCustomHeader`, which the column passes inline, so today this would
    // repaint anyway; memoizing that callback is a natural optimization and the
    // day somebody makes it the mode buttons stop working silently.
    const csv = file({ path: 'data/rows.csv' });
    const grid = codeViewItems([csv], new Set(), new Map(), new Map([[csv.path, 'table:grid']]));
    const rows = codeViewItems(
      [csv],
      new Set(),
      new Map(),
      new Map([[csv.path, 'table:changed-rows']]),
    );

    expect(grid[0]?.collapsed).toBe(false);
    expect(rows[0]?.collapsed).toBe(false);
    expect(grid[0]?.version).not.toBe(rows[0]?.version);
  });

  it('gives a file whose body is a comparison nothing to draw underneath it', () => {
    // The card would otherwise carry Pierre's line-by-line diff of the same
    // file underneath the grid the reviewer chose instead of it. Collapsing was
    // how that used to be prevented, and an expanded item is now required —
    // only an expanded one hosts the annotation the comparison arrives in — so
    // the emptiness has to come from the contents instead.
    const csv = file({ path: 'data/rows.csv' });
    const items = codeViewItems(
      [csv],
      new Set(),
      new Map(),
      new Map([[csv.path, 'table:grid']]),
    );
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.hunks).toHaveLength(0);
    expect(item.collapsed).toBe(false);
  });

  it('ignores the reviewer’s collapse on a file that has no diff to show', () => {
    // There is nothing to collapse, and collapsing would take away the one
    // thing the card has: a collapsed item hosts no annotation, so the sentence
    // explaining the absent diff would go with it.
    const binary = file({ path: 'logo.png', isBinary: true, patch: '' });
    const items = codeViewItems([binary], new Set(['logo.png']));

    expect(items[0]?.collapsed).toBe(false);
  });

  it('still produces an item for a file whose patch never arrived', () => {
    const items = codeViewItems(
      [file({ path: 'huge.sql', patch: '', patchOmitted: true })],
      new Set(),
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('huge.sql');
  });

  it('names the file in the metadata it hands the renderer', () => {
    const items = codeViewItems([file({ path: 'src/app.ts' })], new Set());
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.name).toBe('src/app.ts');
  });

  it('hands back the same metadata object for a file that did not change', () => {
    // CodeView compares controlled items by content. A freshly parsed metadata
    // for an unchanged file reads as new content and discards the render it
    // already has — so collapsing one card would re-render every other one.
    const files = [file({ path: 'src/a.ts' })];
    const first = codeViewItems(files, new Set());
    const second = codeViewItems(files, new Set(['src/a.ts']));

    if (first[0]?.type !== 'diff' || second[0]?.type !== 'diff') {
      throw new Error('expected diff items');
    }
    expect(second[0].fileDiff).toBe(first[0].fileDiff);
  });

  it('hands the annotations for a file through to its item', () => {
    const annotations = new Map([
      ['src/a.ts', [{ side: 'additions' as const, lineNumber: 2, metadata: THREAD }]],
    ]);

    const items = codeViewItems([file({ path: 'src/a.ts' })], new Set(), annotations);
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.annotations).toBe(annotations.get('src/a.ts'));
  });

  it('keeps an item’s version steady while its annotations are the same array', () => {
    // The column memoizes one annotation array per file and only rebuilds it
    // when something that affects anchoring moved. A version that changed on
    // every render would re-render every mounted diff — including on a resolve
    // in some other file.
    const annotations = new Map([
      ['src/a.ts', [{ side: 'additions' as const, lineNumber: 2, metadata: THREAD }]],
    ]);
    const files = [file({ path: 'src/a.ts' })];

    const first = codeViewItems(files, new Set(), annotations);
    const second = codeViewItems(files, new Set(), annotations);

    expect(second[0]?.version).toBe(first[0]?.version);
  });

  it('changes an item’s version when its annotations do', () => {
    // Without this, a thread that was just posted would never appear: CodeView
    // keeps the record it already measured.
    const files = [file({ path: 'src/a.ts' })];
    const before = codeViewItems(files, new Set(), new Map());
    const after = codeViewItems(
      files,
      new Set(),
      new Map([
        ['src/a.ts', [{ side: 'additions' as const, lineNumber: 2, metadata: THREAD }]],
      ]),
    );

    expect(after[0]?.version).not.toBe(before[0]?.version);
  });

  it('carries the previous path for a rename into the metadata', () => {
    const items = codeViewItems(
      [
        file({
          path: 'src/new.ts',
          oldPath: 'src/old.ts',
          isRename: true,
          patch: 'diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\n',
        }),
      ],
      new Set(),
    );
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.prevName).toBe('src/old.ts');
  });
});

describe('hunkStops', () => {
  const twoHunks = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
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

  const pureDeletion = [
    'diff --git a/b.ts b/b.ts',
    '--- a/b.ts',
    '+++ b/b.ts',
    '@@ -5,2 +4,0 @@',
    '-gone',
    '-also gone',
  ].join('\n');

  it('names the first line of every hunk, in reading order', () => {
    const stops = hunkStops([
      file({ path: 'a.ts', patch: twoHunks }),
      file({ path: 'b.ts', patch: twoHunks }),
    ]);

    expect(stops).toEqual([
      { path: 'a.ts', side: 'additions', line: 1 },
      { path: 'a.ts', side: 'additions', line: 20 },
      { path: 'b.ts', side: 'additions', line: 1 },
      { path: 'b.ts', side: 'additions', line: 20 },
    ]);
  });

  it('lands on the deletion side for a hunk that only removes lines', () => {
    // There is no addition line to scroll to. Naming one would scroll to a row
    // that is not there.
    expect(hunkStops([file({ path: 'b.ts', patch: pureDeletion })])).toEqual([
      { path: 'b.ts', side: 'deletions', line: 5 },
    ]);
  });

  it('has nothing to offer for a file with no patch', () => {
    expect(hunkStops([file({ path: 'logo.png', patch: '', isBinary: true })])).toEqual([]);
  });

  it('offers no stop on a hunk the whitespace rewrite took away', () => {
    // `J` moves between hunks that are *drawn*, so the column asks this over
    // the rewritten patches rather than over GitHub's. A stop on a hunk that
    // is no longer on screen scrolls to a row that does not exist — the same
    // failure as naming an addition line in a pure deletion, one line above.
    const reindented = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-  spaced',
      '+    spaced',
      ' three',
      '@@ -20,3 +20,3 @@',
      ' twenty',
      '-old',
      '+new',
      ' twentytwo',
    ].join('\n');

    const drawn = withoutWhitespaceChanges(reindented);

    expect(hunkStops([file({ path: 'a.ts', patch: reindented })])).toHaveLength(2);
    expect(hunkStops([file({ path: 'a.ts', patch: drawn.patch })])).toEqual([
      { path: 'a.ts', side: 'additions', line: 20 },
    ]);
  });
});

/**
 * Where a card's variable-height parts live.
 *
 * `CodeView` sizes an item's header from one global metric and never measures
 * it, so anything variable in the header is scroll range the viewer does not
 * know about. It *does* measure a file-level annotation. `lib/review/columnTail.ts`
 * has the two library facts and the numbers; these pin the shape that follows
 * from them.
 */
describe('codeViewItems: the measured half of a card', () => {
  const csv = () => file({ path: 'data/rows.csv' });
  const grid = new Map([['data/rows.csv', 'table:grid']]);

  it('gives a file with no text diff nothing to draw', () => {
    // No hunks, so no rows: the card is its header and its annotation, which is
    // what it looked like when these were collapsed. A `file` item was tried
    // and is wider in split view; it also renders one blank row with a `1` in
    // its gutter, because even empty contents are one line.
    const items = codeViewItems([csv()], new Set(), new Map(), grid);
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.hunks).toHaveLength(0);
  });

  it('leaves that item expanded, because a collapsed one hosts no annotation', () => {
    // `computeApproximateSize` returns at the header region when the item is
    // collapsed, and no annotation host is rendered at all. Expanded is the
    // only state in which the body can be measured.
    const items = codeViewItems([csv()], new Set(), new Map(), grid);

    expect(items[0]?.collapsed).toBe(false);
  });

  it('carries the card body as a file-level annotation', () => {
    const items = codeViewItems([csv()], new Set(), new Map(), grid);

    expect(items[0]?.annotations).toEqual([
      { side: 'additions', lineNumber: 0, metadata: { kind: 'body' } },
    ]);
  });

  it('gives a text diff no body annotation when it has nothing to put in one', () => {
    // The common card by a wide margin. An annotation host it never fills is a
    // row of empty space between every header and its first hunk.
    const items = codeViewItems([file({ path: 'src/a.ts' })], new Set());

    expect(items[0]?.annotations).toBeUndefined();
  });

  it('gives a text diff a body annotation when it has something to say', () => {
    const items = codeViewItems(
      [file({ path: 'src/a.ts' })],
      new Set(),
      new Map(),
      new Map(),
      new Set(['src/a.ts']),
    );
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    // On a side, because that is the only shape a diff item's annotations take.
    expect(item.annotations).toEqual([
      { side: 'additions', lineNumber: 0, metadata: { kind: 'body' } },
    ]);
  });

  it('keeps the body annotation last, after the threads anchored in the diff', () => {
    const thread = { side: 'additions', lineNumber: 4, metadata: THREAD } as const;
    const items = codeViewItems(
      [file({ path: 'src/a.ts' })],
      new Set(),
      new Map([['src/a.ts', [thread]]]),
      new Map(),
      new Set(['src/a.ts']),
    );
    const item = items[0];

    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.annotations?.map((one) => one.lineNumber)).toEqual([4, 0]);
  });

  it('drops the body annotation from a card the reviewer collapsed', () => {
    // Collapsed means header only, and a collapsed item has no host to put an
    // annotation in. The alternative is putting it back in the header, which is
    // the unmeasured slot this whole shape exists to empty.
    const items = codeViewItems(
      [file({ path: 'src/a.ts' })],
      new Set(['src/a.ts']),
      new Map(),
      new Map(),
      new Set(['src/a.ts']),
    );

    expect(items[0]?.annotations).toBeUndefined();
  });

  it('hands back the same empty metadata for a file that did not change', () => {
    // Same reason as the parsed diffs above: CodeView compares controlled items
    // by content, and a fresh object reads as a new file to render.
    const files = [csv()];
    const first = codeViewItems(files, new Set(), new Map(), grid);
    const second = codeViewItems(files, new Set(), new Map(), grid);

    if (first[0]?.type !== 'diff' || second[0]?.type !== 'diff') {
      throw new Error('expected diff items');
    }
    expect(second[0].fileDiff).toBe(first[0].fileDiff);
  });

  it('keeps the real parse for the same file’s raw view', () => {
    // Two different metadata objects for one file, and both are needed: the
    // comparison must render over nothing, and the raw view must render the
    // actual patch. Handing the empty one to the raw view would blank the card.
    const file = csv();
    const rich = codeViewItems([file], new Set(), new Map(), grid)[0];
    const raw = codeViewItems([file], new Set())[0];

    if (rich?.type !== 'diff' || raw?.type !== 'diff') {
      throw new Error('expected diff items');
    }
    expect(rich.fileDiff.hunks).toHaveLength(0);
    expect(raw.fileDiff.hunks.length).toBeGreaterThan(0);
  });
});
