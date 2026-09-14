/**
 * Turning a list of changed paths into the rows a tree draws.
 *
 * Pure, and deliberately so: everything about *what* the tree shows is decided
 * here, where it can be read and tested without a DOM, a shadow root or a
 * layout engine. What is left in the component is only how it is drawn and
 * which key does what.
 */

import { describe, expect, it } from 'vitest';
import { type TreeRow, checkState, directoryPaths, fileOrder, treeRows } from './treeRows';

const OPEN: ReadonlySet<string> = new Set();

const shape = (rows: readonly TreeRow[]): string[] =>
  rows.map((row) => `${'  '.repeat(row.depth)}${row.name}${row.kind === 'directory' ? '/' : ''}`);

describe('treeRows', () => {
  it('groups files under the directories they came from', () => {
    expect(
      shape(treeRows(['src/app.ts', 'src/beta.ts', 'docs/readme.md'], OPEN)),
    ).toEqual(['docs/', '  readme.md', 'src/', '  app.ts', '  beta.ts']);
  });

  it('nests as deeply as the paths do', () => {
    expect(shape(treeRows(['lib/util/clamp.ts', 'lib/format.ts'], OPEN))).toEqual([
      'lib/',
      '  util/',
      '    clamp.ts',
      '  format.ts',
    ]);
  });

  it('puts directories before files at every level', () => {
    // A folder among loose files reads as one of them otherwise, and the eye
    // has to re-sort the list to find where the tree branches.
    expect(shape(treeRows(['zzz.ts', 'aaa/one.ts', 'mmm.ts'], OPEN))).toEqual([
      'aaa/',
      '  one.ts',
      'mmm.ts',
      'zzz.ts',
    ]);
  });

  it('orders numbered names the way a person counts', () => {
    expect(shape(treeRows(['file10.ts', 'file9.ts', 'file1.ts'], OPEN))).toEqual([
      'file1.ts',
      'file9.ts',
      'file10.ts',
    ]);
  });

  it('keeps a collapsed directory and hides everything under it', () => {
    const rows = treeRows(['src/app.ts', 'src/deep/x.ts', 'top.ts'], new Set(['src/']));

    expect(shape(rows)).toEqual(['src/', 'top.ts']);
    expect(rows[0]?.expanded).toBe(false);
  });

  it('hides a nested subtree without hiding its parent', () => {
    const rows = treeRows(['lib/util/clamp.ts', 'lib/format.ts'], new Set(['lib/util/']));

    expect(shape(rows)).toEqual(['lib/', '  util/', '  format.ts']);
  });

  it('keys directories with a trailing slash and files without', () => {
    // The whole tree is addressed by path, and `src` the directory has to be a
    // different key from `src` the file if a repository ever has both.
    const rows = treeRows(['src/app.ts'], OPEN);

    expect(rows.map((row) => row.path)).toEqual(['src/', 'src/app.ts']);
  });

  it('tells a directory every file beneath it, however deep', () => {
    // What a folder's checkbox acts on. Missing a nested file would tick a
    // folder that is not, in fact, entirely viewed.
    const rows = treeRows(['a/b/c/deep.ts', 'a/shallow.ts', 'other.ts'], OPEN);
    const a = rows.find((row) => row.path === 'a/');

    expect(a?.files).toEqual(['a/b/c/deep.ts', 'a/shallow.ts']);
  });

  it('gives a file no descendants of its own', () => {
    expect(treeRows(['a.ts'], OPEN)[0]?.files).toEqual([]);
  });

  it('counts a collapsed directory’s files even though its rows are hidden', () => {
    // Ticking a folder shut is still ticking every file in it.
    const rows = treeRows(['src/a.ts', 'src/b.ts'], new Set(['src/']));

    expect(rows[0]?.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('does not confuse two files with the same name in different places', () => {
    const rows = treeRows(['one/index.ts', 'two/index.ts'], OPEN);

    expect(rows.filter((row) => row.kind === 'file').map((row) => row.path)).toEqual([
      'one/index.ts',
      'two/index.ts',
    ]);
  });

  it('has nothing to draw for a pull request that changed nothing', () => {
    expect(treeRows([], OPEN)).toEqual([]);
  });
});

describe('checkState', () => {
  const rows = (collapsed: ReadonlySet<string> = OPEN) =>
    treeRows(['src/a.ts', 'src/b.ts', 'top.ts'], collapsed);
  const row = (path: string, collapsed?: ReadonlySet<string>) =>
    rows(collapsed).find((r) => r.path === path) as TreeRow;

  it('ticks a file the reviewer has viewed', () => {
    expect(checkState(row('top.ts'), new Map([['top.ts', 'VIEWED']]))).toBe('checked');
  });

  it('leaves a file they have not', () => {
    expect(checkState(row('top.ts'), new Map([['top.ts', 'UNVIEWED']]))).toBe('unchecked');
  });

  it('shows a file that changed after they viewed it as neither', () => {
    // DISMISSED is not viewed — they have not seen this version — but it is
    // not untouched either. Mixed is the honest third answer, and it is the
    // one a checkbox already has.
    expect(checkState(row('top.ts'), new Map([['top.ts', 'DISMISSED']]))).toBe('mixed');
  });

  it('treats a file it knows nothing about as unviewed', () => {
    expect(checkState(row('top.ts'), new Map())).toBe('unchecked');
  });

  it('ticks a folder only when every file under it is viewed', () => {
    const all = new Map<string, 'VIEWED'>([
      ['src/a.ts', 'VIEWED'],
      ['src/b.ts', 'VIEWED'],
    ]);

    expect(checkState(row('src/'), all)).toBe('checked');
  });

  it('shows a partly viewed folder as partial', () => {
    expect(checkState(row('src/'), new Map([['src/a.ts', 'VIEWED']]))).toBe('mixed');
  });

  it('leaves a folder nobody has looked at', () => {
    expect(checkState(row('src/'), new Map())).toBe('unchecked');
  });

  it('counts a folder’s files even while it is collapsed', () => {
    // Its rows are not on screen; its files are still its files.
    const collapsed = new Set(['src/']);
    const all = new Map<string, 'VIEWED'>([
      ['src/a.ts', 'VIEWED'],
      ['src/b.ts', 'VIEWED'],
    ]);

    expect(checkState(row('src/', collapsed), all)).toBe('checked');
  });

  it('counts a dismissed file as not viewed when rolling a folder up', () => {
    // A folder cannot claim to be done because of a file the reviewer has been
    // told to look at again.
    const mixed = new Map<string, 'VIEWED' | 'DISMISSED'>([
      ['src/a.ts', 'VIEWED'],
      ['src/b.ts', 'DISMISSED'],
    ]);

    expect(checkState(row('src/'), mixed)).toBe('mixed');
  });
});

/**
 * Every directory a list of paths implies.
 *
 * What "open the tree shut" is built from, and the one property that matters is
 * that it agrees with {@link treeRows} about how a directory is spelled — the
 * last test here is the one that would catch a drift between the two, because
 * a set naming directories the rows do not have produces folders that cannot be
 * opened and no error anywhere.
 */
describe('directoryPaths', () => {
  it('names each directory with the trailing slash the rows use', () => {
    expect([...directoryPaths(['src/app.ts'])]).toEqual(['src/']);
  });

  it('includes the directories in between, not only the deepest', () => {
    // Otherwise a deep tree collapses to a spine of single children the
    // reviewer has to walk down before anything is actually folded.
    expect([...directoryPaths(['lib/review/search.ts'])]).toEqual(['lib/', 'lib/review/']);
  });

  it('names a shared directory once', () => {
    expect([...directoryPaths(['src/a.ts', 'src/b.ts', 'src/deep/c.ts'])]).toEqual([
      'src/',
      'src/deep/',
    ]);
  });

  it('implies no directory for a file at the top level', () => {
    expect([...directoryPaths(['README.md'])]).toEqual([]);
  });

  it('says nothing about an empty list', () => {
    expect([...directoryPaths([])]).toEqual([]);
  });

  it('spells a directory the way treeRows does, which is the point of it', () => {
    // The drift this is here to catch is silent: a set naming `src` where the
    // rows say `src/` leaves every folder open and every toggle inert.
    const paths = ['src/app.ts', 'lib/review/search.ts', 'README.md'];
    const fromRows = treeRows(paths, OPEN)
      .filter((row) => row.kind === 'directory')
      .map((row) => row.path);

    expect([...directoryPaths(paths)].sort()).toEqual([...fromRows].sort());
  });

  it('shuts the whole tree when it is handed back to treeRows', () => {
    const paths = ['src/app.ts', 'lib/review/search.ts', 'README.md'];

    expect(shape(treeRows(paths, directoryPaths(paths)))).toEqual([
      'lib/',
      'src/',
      'README.md',
    ]);
  });
});

/**
 * The one order both surfaces read in.
 *
 * The tree and the diff column used to disagree: the column drew files in the
 * order GitHub's diff listed them, and the tree re-sorted into folders-first.
 * A root-level `README.md` came first in one and last in the other, which is
 * the same review claiming two different shapes.
 */
describe('fileOrder', () => {
  it('reads out the same sequence the rows are drawn in', () => {
    const paths = ['README.md', 'src/app.ts', 'docs/guide.md', 'src/beta.ts'];
    const drawn = treeRows(paths, OPEN)
      .filter((row) => row.kind === 'file')
      .map((row) => row.path);

    expect(fileOrder(paths)).toEqual(drawn);
  });

  it('puts a root-level file after the directories, where the tree puts it', () => {
    expect(fileOrder(['README.md', 'src/app.ts'])).toEqual(['src/app.ts', 'README.md']);
  });

  it('counts the way a person does, like the rows', () => {
    expect(fileOrder(['file10.ts', 'file9.ts', 'file1.ts'])).toEqual([
      'file1.ts',
      'file9.ts',
      'file10.ts',
    ]);
  });

  it('reports every file, including ones inside a directory a reviewer shut', () => {
    // Folding is a property of the rows, not of the order. The column draws
    // every file whatever the tree is currently showing.
    expect(fileOrder(['src/deep/one.ts', 'src/two.ts'])).toEqual([
      'src/deep/one.ts',
      'src/two.ts',
    ]);
  });

  it('has nothing to say about a pull request that changed nothing', () => {
    expect(fileOrder([])).toEqual([]);
  });
});
