/**
 * Which files a filtered review shows.
 *
 * The rules worth pinning hardest are the ones a reviewer cannot see being
 * applied: what counts as a file's *type*, which of GitHub's six change types
 * fold into which of the tree's four words, and that a file which was renamed
 * and edited is not "only moved" just because its edit was to bytes rather than
 * lines.
 */

import { describe, expect, it } from 'vitest';
import type { PatchStatus } from '../github/types';
import {
  type FileFacts,
  type FileFilters,
  type FilterableFile,
  NO_FILTERS,
  changeKind,
  compoundType,
  fileFacets,
  fileType,
  hiddenPaths,
  isFiltering,
  isMoved,
  nearestShown,
  passes,
  typeMatches,
} from './fileFilters';

const file = (
  path: string,
  changeType: PatchStatus = 'MODIFIED',
  counts: Partial<Pick<FilterableFile, 'additions' | 'deletions' | 'isBinary'>> = {},
): FilterableFile => ({
  path,
  changeType,
  additions: counts.additions ?? 1,
  deletions: counts.deletions ?? 1,
  isBinary: counts.isBinary ?? false,
});

/** Nothing is viewed, discussed, generated or owned: every toggle is inert. */
const NO_FACTS: FileFacts = {
  isViewed: () => false,
  hasUnresolved: () => false,
  isGenerated: () => false,
  isOwned: null,
};

const filters = (overrides: Partial<FileFilters>): FileFilters => ({
  ...NO_FILTERS,
  ...overrides,
});

describe('a file’s type', () => {
  it.each([
    ['src/app.ts', '.ts'],
    ['src/app.test.ts', '.ts'],
    ['README.md', '.md'],
    ['archive.tar.gz', '.gz'],
    ['config/.eslintrc.json', '.json'],
  ])('reads %s as %s: the last extension of the name', (path, type) => {
    expect(fileType(path)).toBe(type);
  });

  it('ignores case, so a PNG and a png are one type', () => {
    expect(fileType('assets/Logo.PNG')).toBe('.png');
    expect(fileType('assets/icon.png')).toBe('.png');
  });

  it('reads a dot in a directory name as part of the directory, not the file', () => {
    expect(fileType('v1.2/Makefile')).toBe('none');
  });

  it.each(['Makefile', 'bin/run', 'LICENSE'])('calls %s a file with no extension', (path) => {
    expect(fileType(path)).toBe('none');
  });

  it.each(['.gitignore', 'web/.env', '.github/.keep'])('calls %s a dotfile', (path) => {
    expect(fileType(path)).toBe('dotfile');
  });

  it('calls a name that ends in a dot a file with no extension, not one called “.”', () => {
    expect(fileType('notes.')).toBe('none');
  });
});

/**
 * The longer type: the word before the extension, and the extension.
 *
 * What lets a reviewer say "the spec files" rather than "the TypeScript files".
 * The word has to look like a kind of file rather than part of a name, which is
 * why a number (a version) or a dotfile's own name does not count.
 */
describe('a file’s longer type', () => {
  it.each([
    ['src/Button.spec.tsx', '.spec.tsx'],
    ['src/app.test.ts', '.test.ts'],
    ['types/index.d.ts', '.d.ts'],
    ['vendor/jquery-3.6.0.min.js', '.min.js'],
    ['archive.tar.gz', '.tar.gz'],
    ['__snapshots__/Card.test.tsx.snap', '.tsx.snap'],
    ['src/Card.Stories.TSX', '.stories.tsx'],
  ])('reads %s as %s', (path, type) => {
    expect(compoundType(path)).toBe(type);
  });

  it.each([
    ['src/app.ts', 'a single extension'],
    ['notes/v1.2.3.txt', 'a version number before the extension'],
    ['config/.eslintrc.json', 'a dotfile whose own name comes before the extension'],
    ['draft.md.', 'a name that ends in a dot'],
    ['a..ts', 'an empty word'],
    ['Makefile', 'no extension at all'],
  ])('gives %s none: %s', (path) => {
    expect(compoundType(path)).toBeNull();
  });

  it('matches a file by its extension or by its longer type', () => {
    expect(typeMatches('src/Button.spec.tsx', '.tsx')).toBe(true);
    expect(typeMatches('src/Button.spec.tsx', '.spec.tsx')).toBe(true);
    expect(typeMatches('src/Button.tsx', '.spec.tsx')).toBe(false);
  });
});

describe('a file’s change kind', () => {
  it.each<[PatchStatus, string]>([
    ['ADDED', 'added'],
    ['MODIFIED', 'modified'],
    ['RENAMED', 'renamed'],
    ['DELETED', 'deleted'],
    // A copy is a new file at its destination, and GitHub's CHANGED is a
    // content change it declined to classify: the tree's letters already say
    // so, and the filter has to agree with the letter on the row.
    ['COPIED', 'added'],
    ['CHANGED', 'modified'],
  ])('files %s under %s', (status, kind) => {
    expect(changeKind(status)).toBe(kind);
  });
});

describe('only moved', () => {
  it('is a rename with no line added or removed', () => {
    expect(isMoved(file('src/new.ts', 'RENAMED', { additions: 0, deletions: 0 }))).toBe(true);
  });

  it('is not a rename that was also edited', () => {
    expect(isMoved(file('src/new.ts', 'RENAMED', { additions: 3, deletions: 0 }))).toBe(false);
  });

  it('is not a binary file that was renamed and changed, though it reports no lines', () => {
    // Its patch says "Binary files a/… and b/… differ": the bytes moved, and
    // a +0 −0 is only the absence of lines to count.
    expect(
      isMoved(file('img/logo.png', 'RENAMED', { additions: 0, deletions: 0, isBinary: true })),
    ).toBe(false);
  });

  it('is never a file that was not renamed', () => {
    expect(isMoved(file('src/app.ts', 'MODIFIED', { additions: 0, deletions: 0 }))).toBe(false);
  });
});

describe('the counts the menu lists', () => {
  const files = [
    file('src/b.ts'),
    file('src/a.ts', 'ADDED'),
    file('README.md', 'DELETED'),
    file('.gitignore'),
    file('Makefile', 'RENAMED'),
    file('docs/c.MD', 'COPIED'),
  ];

  it('counts each change kind present, in the menu’s order', () => {
    expect([...fileFacets(files).kinds]).toEqual([
      ['added', 2],
      ['modified', 2],
      ['renamed', 1],
      ['deleted', 1],
    ]);
  });

  it('leaves out a change kind the pull request has none of', () => {
    expect([...fileFacets([file('a.ts')]).kinds]).toEqual([['modified', 1]]);
  });

  it('counts each type present, alphabetically, with dotfiles and no extension last', () => {
    expect([...fileFacets(files).types]).toEqual([
      ['.md', 2],
      ['.ts', 2],
      ['dotfile', 1],
      ['none', 1],
    ]);
  });
});

describe('the longer types the menu lists', () => {
  it('lists one under its extension when at least two files share it', () => {
    const facets = fileFacets([
      file('src/a.spec.tsx'),
      file('src/b.spec.tsx'),
      file('src/c.stories.tsx'),
      file('src/d.stories.tsx'),
      file('src/e.tsx'),
      file('src/f.ts'),
    ]);

    expect([...facets.types]).toEqual([
      ['.ts', 1],
      ['.tsx', 5],
      ['.spec.tsx', 2],
      ['.stories.tsx', 2],
    ]);
  });

  it('leaves out one that only a single file has', () => {
    expect([...fileFacets([file('src/a.spec.tsx'), file('src/b.tsx')]).types]).toEqual([
      ['.tsx', 2],
    ]);
  });

  it('leaves out one every file of its extension has, which would be the same row twice', () => {
    expect([...fileFacets([file('a.spec.tsx'), file('b.spec.tsx')]).types]).toEqual([
      ['.tsx', 2],
    ]);
  });

  it('keeps listing one the reviewer chose, for as long as any file here has it', () => {
    // Unticked on the whole pull request, then one commit opened that has a
    // single spec file. Without its row it could be neither seen nor undone.
    const facets = fileFacets([file('src/a.spec.tsx'), file('src/b.tsx')], ['.spec.tsx', '.d.ts']);

    expect([...facets.types]).toEqual([
      ['.tsx', 2],
      ['.spec.tsx', 1],
    ]);
  });
});

describe('which files pass', () => {
  it('passes everything with no filter set', () => {
    expect(passes(file('src/app.ts'), NO_FILTERS, NO_FACTS)).toBe(true);
  });

  it('hides a change kind the reviewer unticked', () => {
    const set = filters({ hiddenKinds: new Set(['deleted']) });
    expect(passes(file('old.ts', 'DELETED'), set, NO_FACTS)).toBe(false);
    expect(passes(file('new.ts', 'ADDED'), set, NO_FACTS)).toBe(true);
  });

  it('hides a file type the reviewer unticked', () => {
    const set = filters({ hiddenTypes: new Set(['.lock', 'none']) });
    expect(passes(file('yarn.lock'), set, NO_FACTS)).toBe(false);
    expect(passes(file('Makefile'), set, NO_FACTS)).toBe(false);
    expect(passes(file('src/app.ts'), set, NO_FACTS)).toBe(true);
  });

  it('hides a longer type without hiding the rest of its extension', () => {
    const set = filters({ hiddenTypes: new Set(['.spec.tsx']) });
    expect(passes(file('src/Button.spec.tsx'), set, NO_FACTS)).toBe(false);
    expect(passes(file('src/Button.tsx'), set, NO_FACTS)).toBe(true);
  });

  it('hides the longer types along with their extension', () => {
    const set = filters({ hiddenTypes: new Set(['.tsx']) });
    expect(passes(file('src/Button.spec.tsx'), set, NO_FACTS)).toBe(false);
  });

  it('hides viewed files, and only those', () => {
    const facts = { ...NO_FACTS, isViewed: (path: string) => path === 'done.ts' };
    const set = filters({ hideViewed: true });
    expect(passes(file('done.ts'), set, facts)).toBe(false);
    expect(passes(file('todo.ts'), set, facts)).toBe(true);
  });

  it('hides generated files, and only those', () => {
    const facts = { ...NO_FACTS, isGenerated: (path: string) => path === 'yarn.lock' };
    const set = filters({ hideGenerated: true });
    expect(passes(file('yarn.lock'), set, facts)).toBe(false);
    expect(passes(file('package.json'), set, facts)).toBe(true);
  });

  it('hides files that were only moved', () => {
    const set = filters({ hideMoved: true });
    expect(passes(file('a.ts', 'RENAMED', { additions: 0, deletions: 0 }), set, NO_FACTS)).toBe(
      false,
    );
    expect(passes(file('b.ts', 'RENAMED', { additions: 2, deletions: 1 }), set, NO_FACTS)).toBe(
      true,
    );
  });

  it('shows only files with an unresolved conversation', () => {
    const facts = { ...NO_FACTS, hasUnresolved: (path: string) => path === 'talk.ts' };
    const set = filters({ onlyUnresolved: true });
    expect(passes(file('talk.ts'), set, facts)).toBe(true);
    expect(passes(file('quiet.ts'), set, facts)).toBe(false);
  });

  it('shows only files the reviewer owns, once ownership is known', () => {
    const facts = { ...NO_FACTS, isOwned: (path: string) => path.startsWith('mine/') };
    const set = filters({ onlyOwned: true });
    expect(passes(file('mine/a.ts'), set, facts)).toBe(true);
    expect(passes(file('theirs/b.ts'), set, facts)).toBe(false);
  });

  it('hides nothing on ownership while it is not known yet', () => {
    // A filter still waiting on CODEOWNERS narrowing to nothing would read as
    // "you own none of this" for as long as the request took.
    expect(passes(file('theirs/b.ts'), filters({ onlyOwned: true }), NO_FACTS)).toBe(true);
  });

  it('needs a file to satisfy every filter at once', () => {
    const facts = { ...NO_FACTS, isViewed: (path: string) => path === 'b.ts' };
    const set = filters({ hideViewed: true, hiddenKinds: new Set(['deleted']) });
    expect(passes(file('a.ts'), set, facts)).toBe(true);
    expect(passes(file('b.ts'), set, facts)).toBe(false);
    expect(passes(file('c.ts', 'DELETED'), set, facts)).toBe(false);
  });
});

describe('which paths a filtered review hides', () => {
  const files = [file('a.ts'), file('b.md', 'DELETED'), file('c.ts'), file('d.md', 'DELETED')];
  const noDeleted = filters({ hiddenKinds: new Set(['deleted']) });

  it('hides every file that fails a filter', () => {
    expect([...hiddenPaths(files, noDeleted, NO_FACTS, new Set())]).toEqual(['b.md', 'd.md']);
  });

  it('never hides a file it is told to keep, whatever the filters say', () => {
    // The file the reviewer is on, and any file with a comment still posting:
    // the page decides which, and passes them here rather than this deciding.
    expect([...hiddenPaths(files, noDeleted, NO_FACTS, new Set(['b.md']))]).toEqual(['d.md']);
  });

  it('hides nothing with no filter set', () => {
    expect(hiddenPaths(files, NO_FILTERS, NO_FACTS, new Set()).size).toBe(0);
  });
});

describe('where the review goes when a filter hides the file it is on', () => {
  const files = [file('a.ts'), file('b.md'), file('c.md'), file('d.ts'), file('e.md')];
  const noMarkdown = filters({ hiddenTypes: new Set(['.md']) });

  it('goes on to the next file still showing', () => {
    expect(nearestShown(files, 'b.md', noMarkdown, NO_FACTS, new Set())).toBe('d.ts');
  });

  it('goes back to the one before when nothing after it is showing', () => {
    // The end of the list is not a reason to leave the reviewer nowhere.
    expect(nearestShown(files, 'e.md', noMarkdown, NO_FACTS, new Set())).toBe('d.ts');
  });

  it('counts a file it is told to keep as showing', () => {
    expect(nearestShown(files, 'b.md', noMarkdown, NO_FACTS, new Set(['c.md']))).toBe('c.md');
  });

  it('goes nowhere when the filters hide every file', () => {
    const everything = filters({ hiddenTypes: new Set(['.md', '.ts']) });
    expect(nearestShown(files, 'b.md', everything, NO_FACTS, new Set())).toBeNull();
  });
});

describe('whether anything is being filtered', () => {
  const facets = fileFacets([file('src/app.ts'), file('old.md', 'DELETED')]);

  it('is not, with nothing set', () => {
    expect(isFiltering(NO_FILTERS, facets)).toBe(false);
  });

  it('is, with any toggle on, whether or not it hides anything here', () => {
    // The funnel is showing what the reviewer asked for, and they asked. A
    // toggle that happens to match nothing on this pull request is still on.
    expect(isFiltering(filters({ hideMoved: true }), facets)).toBe(true);
    expect(isFiltering(filters({ onlyOwned: true }), facets)).toBe(true);
  });

  it('is, with a kind or type unticked that this list has', () => {
    expect(isFiltering(filters({ hiddenKinds: new Set(['deleted']) }), facets)).toBe(true);
    expect(isFiltering(filters({ hiddenTypes: new Set(['.ts']) }), facets)).toBe(true);
  });

  it('is not, with only a type unticked that this list does not have', () => {
    // Kept from another scope — a lockfile hidden on the whole pull request,
    // then one commit opened that touches none. The menu lists no such row,
    // so a pressed funnel would be pointing at a filter nobody can find.
    expect(isFiltering(filters({ hiddenTypes: new Set(['.lock']) }), facets)).toBe(false);
    expect(isFiltering(filters({ hiddenKinds: new Set(['renamed']) }), facets)).toBe(false);
  });
});
