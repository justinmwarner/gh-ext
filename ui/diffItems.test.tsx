/**
 * Turning changed files into what `@pierre/diffs` can render.
 *
 * Three kinds of file have no diff to show — binary blobs, files whose patch
 * GitHub refused to send, and renames that moved without changing. Each has to
 * say so in its own words. A card that renders nothing is indistinguishable
 * from a card that failed.
 */

import { describe, expect, it } from 'vitest';
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

  it('collapses a file that has no diff to show, whatever the reviewer chose', () => {
    const items = codeViewItems(
      [file({ path: 'logo.png', isBinary: true, patch: '' })],
      new Set(),
    );

    expect(items[0]?.collapsed).toBe(true);
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
});
