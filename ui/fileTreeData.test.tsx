/**
 * What the file tree is handed.
 *
 * `@pierre/trees` gives a row two places to say anything: a fixed-width git
 * lane and one decoration that is *either* text *or* an icon. Everything the
 * tree shows therefore has to be decided here, before it goes in.
 */

import { describe, expect, it } from 'vitest';
import type { PatchStatus } from '@/lib/github/types';
import {
  ADDITION_COLOR,
  COMMENT_COLOR,
  DELETION_COLOR,
  NOISE_COLOR,
  SEPARATOR,
  UNVIEWED_BOX,
  VIEWED_BOX,
  fileComments,
  isViewedBox,
  gitStatusFor,
  rowDecoration,
  treeGitStatus,
  treePaths,
} from './fileTreeData';
import { reviewThread } from './prPayload.fixture';
import type { ReviewFile } from './reviewFiles';

const file = (overrides: Partial<ReviewFile> = {}): ReviewFile => ({
  path: 'src/app.ts',
  oldPath: 'src/app.ts',
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch: '',
  additions: 12,
  deletions: 3,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
  ...overrides,
});

describe('gitStatusFor', () => {
  it.each<[PatchStatus, string]>([
    ['ADDED', 'added'],
    ['DELETED', 'deleted'],
    ['RENAMED', 'renamed'],
    ['COPIED', 'added'],
    ['MODIFIED', 'modified'],
    ['CHANGED', 'modified'],
  ])('maps %s onto the tree’s %s lane', (changeType, status) => {
    expect(gitStatusFor(file({ changeType }))).toBe(status);
  });

  it('greys a noise file with the tree’s own ignored presentation', () => {
    // `ignored` is the only status that dims the row name itself, and it is
    // the honest label for a lockfile: present, reachable, not worth reading.
    expect(gitStatusFor(file({ path: 'package-lock.json', noise: true }))).toBe(
      'ignored',
    );
  });
});

describe('treeGitStatus', () => {
  it('produces one entry per file, keyed by path', () => {
    expect(
      treeGitStatus([
        file({ path: 'src/a.ts', changeType: 'ADDED' }),
        file({ path: 'yarn.lock', changeType: 'MODIFIED', noise: true }),
      ]),
    ).toEqual([
      { path: 'src/a.ts', status: 'added' },
      { path: 'yarn.lock', status: 'ignored' },
    ]);
  });
});

describe('treePaths', () => {
  it('hands over every changed path, noise included', () => {
    expect(
      treePaths([
        file({ path: 'src/a.ts' }),
        file({ path: 'package-lock.json', noise: true }),
      ]),
    ).toEqual(['src/a.ts', 'package-lock.json']);
  });
});

describe('rowDecoration', () => {
  it('composes the counts into one decoration rather than three elements', () => {
    // The renderer returns a single FileTreeRowDecoration. Additions and
    // deletions have to share it, which is exactly what `parts` is for.
    const decoration = rowDecoration(file({ additions: 12, deletions: 3 }));

    expect(decoration).toEqual({
      text: `+12 −3 ${UNVIEWED_BOX}`,
      title: '12 additions, 3 deletions — not viewed',
      parts: [
        { text: '+12', color: ADDITION_COLOR },
        { text: SEPARATOR },
        { text: '−3', color: DELETION_COLOR },
        { text: SEPARATOR },
        { text: UNVIEWED_BOX, color: NOISE_COLOR },
      ],
    });
  });

  it('separates the runs with a space that cannot collapse', () => {
    // Each part is rendered as its own `<span>` inside a **flex** container, so
    // a part holding an ordinary space is a flex item whose only content is
    // collapsible whitespace — it lays out at zero width and the counts run
    // together as `+12−3`.
    const parts = rowDecoration(file())?.parts ?? [];

    expect(parts.map((part) => part.text)).toEqual([
      '+12',
      ' ',
      '−3',
      ' ',
      UNVIEWED_BOX,
    ]);
  });

  it('still reads as a decoration when nothing was added or removed', () => {
    expect(rowDecoration(file({ additions: 0, deletions: 0 }))?.text).toBe(
      `+0 −0 ${UNVIEWED_BOX}`,
    );
  });

  it('mutes a noise file’s counts and says why', () => {
    const decoration = rowDecoration(
      file({ path: 'package-lock.json', noise: true, additions: 400, deletions: 20 }),
    );

    expect(
      decoration?.parts.every(
        (part) => part.color === NOISE_COLOR || part.text === SEPARATOR,
      ),
    ).toBe(true);
    expect(decoration?.title).toMatch(/generated|vendored|lock/i);
  });

  it('leaves a directory row undecorated', () => {
    // Directories carry no counts of their own, and the git lane already rolls
    // descendants up into a dot.
    expect(rowDecoration(undefined)).toBeNull();
  });
});

describe('fileComments', () => {
  it('counts a file’s threads and how many are still open', () => {
    const tally = fileComments([
      reviewThread({ path: 'src/a.ts', line: 4 }),
      reviewThread({ path: 'src/a.ts', line: 9, isResolved: true }),
    ]);

    expect(tally.get('src/a.ts')).toEqual({ total: 2, unresolved: 1 });
  });

  it('keeps a file whose threads are all resolved', () => {
    // The row still has something to say: this is where the discussion was.
    const tally = fileComments([
      reviewThread({ path: 'src/a.ts', isResolved: true }),
    ]);

    expect(tally.get('src/a.ts')).toEqual({ total: 1, unresolved: 0 });
  });

  it('leaves a file nobody commented on out of the map entirely', () => {
    // Absence is the signal `rowDecoration` reads; a zeroed entry would draw a
    // dot on every row in the tree.
    expect(fileComments([]).has('src/a.ts')).toBe(false);
  });
});

describe('rowDecoration with comments', () => {
  it('marks an open conversation with a filled dot after the counts', () => {
    const decoration = rowDecoration(file(), { total: 2, unresolved: 1 });

    expect(decoration?.text).toBe(`+12 −3 ● ${UNVIEWED_BOX}`);
    expect(decoration?.parts.at(-3)).toEqual({ text: '●', color: COMMENT_COLOR });
    expect(decoration?.title).toContain('1 unresolved comment');
  });

  it('marks a settled conversation with a hollow dot instead', () => {
    // Shape as well as colour. A reader who cannot tell the two colours apart
    // can still tell a ring from a disc.
    const decoration = rowDecoration(file(), { total: 3, unresolved: 0 });

    expect(decoration?.text).toBe(`+12 −3 ○ ${UNVIEWED_BOX}`);
    expect(decoration?.parts.at(-3)).toEqual({ text: '○', color: NOISE_COLOR });
    expect(decoration?.title).toContain('3 comments, all resolved');
  });

  it('orders the cell so a narrow rail clips the least important run first', () => {
    // The lane is right-aligned with overflow hidden, so it is the start of the
    // cell that disappears. Counts first — they are already on the row twice
    // over — then the conversation mark, then the box, which is the only part
    // of this cell anyone can click.
    const decoration = rowDecoration(file(), { total: 1, unresolved: 1 }, 'UNVIEWED');

    expect(decoration?.parts.map((part) => part.text).filter((t) => t !== SEPARATOR)).toEqual(
      ['+12', '−3', '●', UNVIEWED_BOX],
    );
  });

  it('says nothing extra about a file with no conversations', () => {
    expect(rowDecoration(file(), undefined)?.text).toBe(`+12 −3 ${UNVIEWED_BOX}`);
  });

  it('dots a noise file too, because a comment on one still matters', () => {
    const decoration = rowDecoration(
      file({ path: 'package-lock.json', noise: true }),
      { total: 1, unresolved: 1 },
    );

    expect(decoration?.parts.at(-3)).toEqual({ text: '●', color: COMMENT_COLOR });
  });
});

describe('rowDecoration with a viewed state', () => {
  it('offers an empty box for a file the reviewer has not looked at', () => {
    const decoration = rowDecoration(file(), undefined, 'UNVIEWED');

    expect(decoration?.parts.at(-1)).toEqual({
      text: UNVIEWED_BOX,
      color: NOISE_COLOR,
    });
    expect(decoration?.title).toMatch(/not viewed$/);
  });

  it('ticks the box for a file the reviewer has marked', () => {
    const decoration = rowDecoration(file(), undefined, 'VIEWED');

    expect(decoration?.parts.at(-1)).toEqual({ text: VIEWED_BOX, color: NOISE_COLOR });
    expect(decoration?.title).toMatch(/viewed$/);
  });

  it('un-ticks a file that changed after the reviewer marked it', () => {
    // DISMISSED is the state that matters. Drawn ticked it would claim they
    // have seen the current version; drawn as a plain empty box it would lose
    // that they ever looked. Empty, in the colour that means "look again".
    const decoration = rowDecoration(file(), undefined, 'DISMISSED');

    expect(decoration?.parts.at(-1)).toEqual({
      text: UNVIEWED_BOX,
      color: COMMENT_COLOR,
    });
    expect(decoration?.title).toMatch(/changed since/i);
  });

  it('falls back to the file’s own state when nothing overrides it', () => {
    expect(rowDecoration(file({ viewedState: 'VIEWED' }))?.parts.at(-1)?.text).toBe(
      VIEWED_BOX,
    );
  });

  it('puts the box last, after the counts and the conversation mark', () => {
    // Last because it is the one part of this cell you can click: the lane is
    // right-aligned with its overflow hidden, so a narrow rail eats the start.
    const decoration = rowDecoration(file(), { total: 1, unresolved: 1 }, 'UNVIEWED');

    expect(decoration?.text).toBe(`+12 −3 ● ${UNVIEWED_BOX}`);
  });

  it('recognizes its own box, whichever state it is in', () => {
    // How the click handler tells a tick from the counts beside it. Matching on
    // the glyph rather than on a position in the DOM, because the glyph is ours
    // and the DOM is the library's.
    expect(isViewedBox(UNVIEWED_BOX)).toBe(true);
    expect(isViewedBox(VIEWED_BOX)).toBe(true);
    expect(isViewedBox('+12')).toBe(false);
    expect(isViewedBox('●')).toBe(false);
  });
});
