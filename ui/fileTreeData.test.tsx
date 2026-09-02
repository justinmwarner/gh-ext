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
  DELETION_COLOR,
  NOISE_COLOR,
  gitStatusFor,
  rowDecoration,
  treeGitStatus,
  treePaths,
} from './fileTreeData';
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
      text: '+12 −3',
      title: '12 additions, 3 deletions',
      parts: [
        { text: '+12', color: ADDITION_COLOR },
        { text: ' ' },
        { text: '−3', color: DELETION_COLOR },
      ],
    });
  });

  it('still reads as a decoration when nothing was added or removed', () => {
    expect(rowDecoration(file({ additions: 0, deletions: 0 }))?.text).toBe('+0 −0');
  });

  it('mutes a noise file’s counts and says why', () => {
    const decoration = rowDecoration(
      file({ path: 'package-lock.json', noise: true, additions: 400, deletions: 20 }),
    );

    expect(decoration?.parts.every((part) => part.color === NOISE_COLOR || part.text === ' ')).toBe(
      true,
    );
    expect(decoration?.title).toMatch(/generated|vendored|lock/i);
  });

  it('leaves a directory row undecorated', () => {
    // Directories carry no counts of their own, and the git lane already rolls
    // descendants up into a dot.
    expect(rowDecoration(undefined)).toBeNull();
  });
});
