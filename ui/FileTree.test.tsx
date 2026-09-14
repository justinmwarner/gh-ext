/**
 * The file tree.
 *
 * Ours now. The thing that made it worth writing is the first `describe`
 * below: a row can hold a real control, so ticking a file off does not have to
 * be a glyph with a click handler intercepted in the capture phase.
 *
 * `aria-checked` on the `treeitem` rather than a nested `<input>`, because a
 * treeitem must not contain focusable content — that constraint is real and it
 * is the same one the previous library was up against. The difference is that
 * ARIA answers it directly: a checkable tree item carries its own state, and
 * Space toggles it.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';
import { NO_FILE } from './currentFile';
import type { ReviewFile } from './reviewFiles';

const file = (path: string, overrides: Partial<ReviewFile> = {}): ReviewFile => ({
  path,
  oldPath: path,
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

const FILES: ReviewFile[] = [
  file('src/app.ts'),
  file('src/beta.ts'),
  file('docs/readme.md'),
  file('top.ts'),
];

function mount(props: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const onSelect = vi.fn<(path: string) => void>();
  const onSetViewed = vi.fn<(paths: readonly string[], next: boolean) => void>();
  const view = render(
    <FileTree
      files={FILES}
      current={NO_FILE}
      onSelect={onSelect}
      onSetViewed={onSetViewed}
      {...props}
    />,
  );
  return { ...view, onSelect, onSetViewed };
}

const rows = () => screen.getAllByRole('treeitem');
const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(name) });
const check = (name: string) =>
  row(name).querySelector('[data-check]') as HTMLElement;

describe('the rows', () => {
  it('draws a row for every directory and file', () => {
    mount();

    expect(rows().map((r) => r.getAttribute('data-path'))).toEqual([
      'docs/',
      'docs/readme.md',
      'src/',
      'src/app.ts',
      'src/beta.ts',
      'top.ts',
    ]);
  });

  it('says how deep each row sits, one-based as ARIA counts', () => {
    mount();

    expect(row('docs').getAttribute('aria-level')).toBe('1');
    expect(row('readme').getAttribute('aria-level')).toBe('2');
  });

  it('names the whole path, which the row itself has no room for', () => {
    // The visible text is the basename. Without this a truncated deep path had
    // nothing to say which file it was.
    mount();

    expect(row('app\\.ts').getAttribute('title')).toBe('src/app.ts');
  });

  it('says so when a pull request changed nothing', () => {
    render(<FileTree files={[]} current={NO_FILE} onSelect={vi.fn()} />);

    expect(screen.getByText(/no changed files/i)).toBeDefined();
  });
});

describe('ticking files off', () => {
  it('carries its own checked state rather than nesting a control', () => {
    // A treeitem must not contain focusable content, so the state lives on the
    // row. This is what the previous library could not do at all.
    mount({ viewed: new Map([['src/app.ts', 'VIEWED']]) });

    expect(row('app\\.ts').getAttribute('aria-checked')).toBe('true');
    expect(row('beta').getAttribute('aria-checked')).toBe('false');
  });

  it('shows a file that changed since it was viewed as partial', () => {
    mount({ viewed: new Map([['src/app.ts', 'DISMISSED']]) });

    expect(row('app\\.ts').getAttribute('aria-checked')).toBe('mixed');
  });

  it('marks a file when its box is clicked', async () => {
    const { onSetViewed } = mount();

    await userEvent.click(check('app\\.ts'));

    expect(onSetViewed).toHaveBeenCalledWith(['src/app.ts'], true);
  });

  it('unmarks one that was already viewed', async () => {
    const { onSetViewed } = mount({ viewed: new Map([['src/app.ts', 'VIEWED']]) });

    await userEvent.click(check('app\\.ts'));

    expect(onSetViewed).toHaveBeenCalledWith(['src/app.ts'], false);
  });

  it('does not also navigate to the file it just ticked', async () => {
    // The box is inside the row, and the row is what selects. A tick that also
    // navigated would move the diff column out from under the reviewer every
    // time they ticked something off.
    const { onSelect, onSetViewed } = mount();

    await userEvent.click(check('app\\.ts'));

    expect(onSetViewed).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks every file under a folder at once', async () => {
    const { onSetViewed } = mount();

    await userEvent.click(check('src'));

    expect(onSetViewed).toHaveBeenCalledWith(['src/app.ts', 'src/beta.ts'], true);
  });

  it('unmarks a folder only once all of it is viewed', async () => {
    // Half-viewed reads as partial, and the useful thing to do to a partial
    // folder is finish it, not undo it.
    const { onSetViewed } = mount({ viewed: new Map([['src/app.ts', 'VIEWED']]) });

    expect(row('src').getAttribute('aria-checked')).toBe('mixed');
    await userEvent.click(check('src'));

    expect(onSetViewed).toHaveBeenCalledWith(['src/app.ts', 'src/beta.ts'], true);
  });

  it('toggles the focused row with the space bar', async () => {
    const { onSetViewed } = mount();

    row('top').focus();
    await userEvent.keyboard(' ');

    expect(onSetViewed).toHaveBeenCalledWith(['top.ts'], true);
  });
});

describe('moving around', () => {
  it('keeps only one row in the tab order', () => {
    mount();

    expect(rows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('steps down and up with the arrow keys', async () => {
    const { onSelect } = mount();

    rows()[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement?.getAttribute('data-path')).toBe('docs/readme.md');
    expect(onSelect).toHaveBeenCalledWith('docs/readme.md');
  });

  it('does not report a directory as the file being reviewed', async () => {
    // There is no diff card for a directory. Reporting one would ask the
    // column to scroll somewhere that does not exist.
    const { onSelect } = mount();

    rows()[0]?.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    expect(onSelect).not.toHaveBeenCalledWith('src/');
  });

  it('jumps to the ends with Home and End', async () => {
    mount();

    rows()[2]?.focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.getAttribute('data-path')).toBe('top.ts');

    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.getAttribute('data-path')).toBe('docs/');
  });

  it('selects a file when it is clicked', async () => {
    const { onSelect } = mount();

    await userEvent.click(row('beta'));

    expect(onSelect).toHaveBeenCalledWith('src/beta.ts');
  });
});

describe('folding', () => {
  it('collapses a directory when it is clicked, and says so', async () => {
    mount();

    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(row('src'));

    expect(row('src').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('treeitem', { name: /app\.ts/ })).toBeNull();
  });

  it('folds and unfolds with the left and right arrows', async () => {
    mount();

    row('src').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(row('src').getAttribute('aria-expanded')).toBe('false');

    await userEvent.keyboard('{ArrowRight}');
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
  });

  it('walks out to the parent from a file', async () => {
    mount();

    row('app\\.ts').focus();
    await userEvent.keyboard('{ArrowLeft}');

    expect(document.activeElement?.getAttribute('data-path')).toBe('src/');
  });

  it('opens a folded ancestor when the column moves to a file inside it', async () => {
    // The column can be scrolled anywhere. A tree that left the selected file
    // hidden inside a closed folder would be showing the wrong thing.
    const { rerender } = mount();

    await userEvent.click(row('src'));
    expect(screen.queryByRole('treeitem', { name: /app\.ts/ })).toBeNull();

    rerender(
      <FileTree
        files={FILES}
        current={{ path: 'src/app.ts', origin: 'scroll' }}
        onSelect={vi.fn()}
      />,
    );

    expect(row('app\\.ts').getAttribute('aria-selected')).toBe('true');
  });
});

describe('what a row says about its file', () => {
  it('marks a file with an open conversation', () => {
    const { container } = mount({
      comments: new Map([['src/app.ts', { total: 2, unresolved: 1 }]]),
    });

    expect(container.querySelector('[data-path="src/app.ts"] .tree-comment')).not.toBeNull();
  });

  it('marks a settled conversation differently', () => {
    const { container } = mount({
      comments: new Map([['src/app.ts', { total: 2, unresolved: 0 }]]),
    });

    const mark = container.querySelector('[data-path="src/app.ts"] .tree-comment');
    expect(mark?.getAttribute('data-tone')).toBe('resolved');
  });

  it('counts what is unresolved while anything is', () => {
    // The mark was a 7px dot and could only say that something had been said
    // here. The number is what makes it worth a second look: one stray nit and
    // eleven open threads are not the same file to come back to.
    const { container } = mount({
      comments: new Map([['src/app.ts', { total: 5, unresolved: 2 }]]),
    });

    const mark = container.querySelector('[data-path="src/app.ts"] .tree-comment');
    expect(mark?.textContent).toBe('2');
    expect(mark?.querySelector('svg')).not.toBeNull();
  });

  it('counts everything said once nothing is left open', () => {
    // The other half of what the two tones already distinguish. On a file with
    // nothing outstanding the useful figure is how much was said, because that
    // is what decides whether it is worth reading again.
    const { container } = mount({
      comments: new Map([['src/app.ts', { total: 3, unresolved: 0 }]]),
    });

    expect(
      container.querySelector('[data-path="src/app.ts"] .tree-comment')?.textContent,
    ).toBe('3');
  });

  it('says what the number counts rather than leaving a digit in the row’s name', () => {
    // A bare number in the accessible name arrives as "app.ts 2 +12 −3": three
    // numbers running together, two about lines and one about conversations,
    // with nothing to say which is which. The mark is one image with a
    // sentence for a label, so the row is named in words.
    mount({ comments: new Map([['src/app.ts', { total: 5, unresolved: 2 }]]) });

    expect(screen.getByRole('treeitem', { name: /2 unresolved comments/ })).toBeDefined();
  });

  it('says as much for a file whose conversations are all settled', () => {
    mount({ comments: new Map([['src/app.ts', { total: 3, unresolved: 0 }]]) });

    expect(screen.getByRole('treeitem', { name: /3 comments, all resolved/ })).toBeDefined();
  });

  it('does not pluralise one comment, and says it the same way twice', () => {
    // The tooltip and the label are one sentence built in one place. They are
    // one fact about the file, and a reviewer with a pointer and a reviewer
    // with a screen reader should not be told it in two different ways.
    const { container } = mount({
      comments: new Map([['src/app.ts', { total: 1, unresolved: 1 }]]),
    });

    const mark = container.querySelector('[data-path="src/app.ts"] .tree-comment');
    expect(mark?.getAttribute('title')).toBe('1 unresolved comment');
    expect(mark?.getAttribute('aria-label')).toBe('1 unresolved comment');
  });

  it('stops the number growing into the file name, and still says the real one', () => {
    // Width is the constraint in a rail that drags down to 180px, and the name
    // is what pays for anything else on the row. What is drawn is capped; what
    // is said is not, so the figure is still reachable.
    const { container } = mount({
      comments: new Map([['src/app.ts', { total: 140, unresolved: 120 }]]),
    });

    expect(
      container.querySelector('[data-path="src/app.ts"] .tree-comment')?.textContent,
    ).toBe('99+');
    expect(screen.getByRole('treeitem', { name: /120 unresolved comments/ })).toBeDefined();
  });

  it('shows the added and removed counts', () => {
    mount();

    expect(within(row('app\\.ts')).getByText('+12')).toBeDefined();
    expect(within(row('app\\.ts')).getByText('−3')).toBeDefined();
  });

  it('says which files are only noise', () => {
    const { container } = mount({
      files: [file('package-lock.json', { noise: true }), file('src/app.ts')],
    });

    expect(
      container.querySelector('[data-path="package-lock.json"]')?.getAttribute('data-noise'),
    ).toBe('true');
  });

  it('puts the file operation after the counts, at the end of the row', () => {
    // Reading order: what the file is called, then how much of it moved, then
    // what happened to it. The letter used to sit between the name and the
    // counts, which put a one-character abbreviation in front of the two
    // numbers a reviewer is actually scanning down the column for.
    const { container } = mount({ files: [file('src/app.ts')] });
    const marks = [...container.querySelectorAll('[data-path="src/app.ts"] > span')]
      .map((node) => node.className)
      .filter((name) => name !== 'tree-check');

    expect(marks.at(-1)).toBe('tree-status');
    expect(marks.at(-2)).toBe('tree-counts');
  });

  it('draws each file the icon its type gets, instead of a coloured dot', async () => {
    // The dot was a language colour and nothing more, and a colour on its own
    // cannot say what it means — a reviewer looking at a 7px blue square has
    // to already know that blue is TypeScript to get anything from it. The
    // drawing says it.
    const { container } = mount({ files: [file('src/app.ts'), file('docs/notes.md')] });
    await waitFor(() => {
      expect(container.querySelector('[data-path="src/app.ts"] .tree-icon')).not.toBeNull();
    });

    expect(
      container.querySelector<HTMLImageElement>('[data-path="src/app.ts"] .tree-icon')?.src,
    ).toMatch(/typescript\.svg$/);
    expect(
      container.querySelector<HTMLImageElement>('[data-path="docs/notes.md"] .tree-icon')?.src,
    ).toMatch(/markdown\.svg$/);
    expect(container.querySelector('.tree-dot')).toBeNull();
  });

  it('draws a folder as a folder, and opens it when it opens', async () => {
    const { container } = mount();
    const src = (): string | undefined =>
      container.querySelector<HTMLImageElement>('[data-path="src/"] .tree-icon')?.src;

    await waitFor(() => {
      expect(src()).toMatch(/folder-src-open\.svg$/);
    });

    await userEvent.click(row('src'));
    await waitFor(() => {
      expect(src()).toMatch(/folder-src\.svg$/);
    });
  });

  it('leaves the icon out of what a row is called', async () => {
    // Decoration. The row already says the file's name in words, and an
    // accessible name of "app.ts app.ts +12 −3" is the kind of thing that
    // makes a screen reader slower to work with rather than more informative.
    const { container } = mount({ files: [file('src/app.ts')] });
    await waitFor(() => {
      expect(container.querySelector('[data-path="src/app.ts"] .tree-icon')).not.toBeNull();
    });

    const icon = container.querySelector('[data-path="src/app.ts"] .tree-icon');
    expect(icon?.getAttribute('alt')).toBe('');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a folder one arrow, not two', () => {
    // `.tree-chevron::before` is the arrow — drawn rather than typed, because
    // the triangle glyphs render as specks in the fonts this page falls back
    // through. A text child on the same span was a second one beside it.
    const { container } = mount();
    const chevron = container.querySelector('[data-path="src/"] .tree-chevron');

    expect(chevron).not.toBeNull();
    expect(chevron?.textContent).toBe('');
  });

  it('follows the change type', () => {
    const { container } = mount({
      files: [file('added.ts', { changeType: 'ADDED' }), file('gone.ts', { changeType: 'DELETED' })],
    });

    expect(container.querySelector('[data-path="added.ts"]')?.getAttribute('data-status')).toBe('added');
    expect(container.querySelector('[data-path="gone.ts"]')?.getAttribute('data-status')).toBe('deleted');
  });
});

describe('following the diff column', () => {
  it('selects the file the column scrolled to', () => {
    mount({ current: { path: 'src/beta.ts', origin: 'scroll' } });

    expect(row('beta').getAttribute('aria-selected')).toBe('true');
  });

  it('does not echo a move the tree itself made', async () => {
    // The tree already shows what the reviewer clicked. Reporting it back is
    // the first half of a feedback loop.
    const { onSelect, rerender } = mount();

    await userEvent.click(row('beta'));
    onSelect.mockClear();

    rerender(
      <FileTree
        files={FILES}
        current={{ path: 'src/beta.ts', origin: 'tree' }}
        onSelect={onSelect}
      />,
    );

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('survives a file list that changes underneath it', () => {
    const { rerender } = mount();

    rerender(
      <FileTree files={[file('other/new.ts')]} current={NO_FILE} onSelect={vi.fn()} />,
    );

    expect(rows().map((r) => r.getAttribute('data-path'))).toEqual([
      'other/',
      'other/new.ts',
    ]);
  });
});

/**
 * Narrowing the tree.
 *
 * A different affordance from `Mod+K`, which the panel already offers: that one
 * finds one file, jumps to it and closes, and this one *stays* — the reviewer
 * narrows to an area of the change and works down what is left. So the two
 * claims that matter are that the tree keeps its own order and nesting while it
 * is narrowed, and that nothing is hidden by a filter the reviewer has
 * forgotten is on.
 *
 * Only the tree narrows. The diff column keeps every file, because a control in
 * the sidebar that quietly removed files from the review is the kind of thing
 * `lib/settings.ts` argues at length that this product must not do.
 */
describe('filtering the tree', () => {
  const filter = (): HTMLElement => screen.getByRole('searchbox', { name: /filter files/i });
  const paths = (): (string | null)[] => rows().map((r) => r.getAttribute('data-path'));

  it('hides nothing at rest, so the box is safe to leave on screen', () => {
    mount();

    expect(paths()).toHaveLength(6);
    // And says nothing, rather than standing there empty: the count is a live
    // region, and one that is always present is one every other surface's has
    // to be distinguished from.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('narrows to the files that match, and drops the folders holding none', async () => {
    mount();

    await userEvent.type(filter(), 'readme');

    expect(paths()).toEqual(['docs/', 'docs/readme.md']);
  });

  it('matches on the directory too, which is how an area is narrowed to', async () => {
    mount();

    await userEvent.type(filter(), 'src/');

    expect(paths()).toEqual(['src/', 'src/app.ts', 'src/beta.ts']);
  });

  it('says how much of the tree is left, so a filter cannot be forgotten', async () => {
    mount();

    await userEvent.type(filter(), 'readme');

    expect(screen.getByRole('status').textContent).toBe('1 of 4 files');
  });

  it('says so when nothing matches, rather than showing an empty rail', async () => {
    mount();

    await userEvent.type(filter(), 'zzz');

    // `queryAll`, because `getAllByRole` throws on none and the whole claim
    // here is that there are none.
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toMatch(/no file matches/i);
  });

  it('gives the whole tree back when the box is emptied', async () => {
    mount();

    await userEvent.type(filter(), 'readme');
    await userEvent.clear(filter());

    expect(paths()).toHaveLength(6);
  });

  it('clears on Escape, without the reviewer having to select the text', async () => {
    mount();

    await userEvent.type(filter(), 'readme');
    await userEvent.keyboard('{Escape}');

    expect((filter() as HTMLInputElement).value).toBe('');
    expect(paths()).toHaveLength(6);
  });

  it('opens a folder the reviewer had shut, so its match is not hidden inside it', async () => {
    // Otherwise the count says one file matched and the tree shows none of it,
    // which reads as the filter being broken.
    mount();

    await userEvent.click(row('docs'));
    expect(screen.queryByRole('treeitem', { name: /readme/ })).toBeNull();

    await userEvent.type(filter(), 'readme');

    expect(row('readme')).toBeDefined();
  });

  it('leaves the folds as the reviewer left them once the filter is gone', async () => {
    // Opening folders is what the filter does *while it is on*, not an edit to
    // how the reviewer had arranged the tree.
    mount();

    await userEvent.click(row('docs'));
    await userEvent.type(filter(), 'readme');
    await userEvent.clear(filter());

    expect(row('docs').getAttribute('aria-expanded')).toBe('false');
  });

  it('steps from the box into the tree with the down arrow', async () => {
    mount();

    await userEvent.type(filter(), 'src/');
    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement?.getAttribute('data-path')).toBe('src/');
  });
});

/**
 * Opening the tree shut.
 *
 * For the monorepo case, where a hundred and fifty files across a deep tree
 * arrive as a wall of rows with no shape to them. The two things worth pinning
 * are that it folds rather than hides — every directory keeps its row and is
 * one press from open — and that it is where the tree *starts* rather than a
 * switch the tree obeys. The second is the one a reviewer would notice going
 * wrong: forty minutes into a review they have arranged these folds themselves,
 * and a setting that reapplied itself would throw that away.
 */
describe('starting collapsed', () => {
  const paths = (): (string | null)[] => rows().map((r) => r.getAttribute('data-path'));

  it('opens with every directory expanded unless asked otherwise', () => {
    mount();

    expect(paths()).toHaveLength(6);
  });

  it('opens with the directories shut when asked', () => {
    mount({ collapseTree: true });

    expect(paths()).toEqual(['docs/', 'src/', 'top.ts']);
  });

  it('keeps a top-level file on screen, which sits in no directory', () => {
    // Folded, not hidden. Nothing about the change becomes unknowable.
    mount({ collapseTree: true });

    expect(row('top.ts')).toBeDefined();
  });

  it('leaves every folder one press from open', () => {
    mount({ collapseTree: true });

    expect(row('src').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens one when the reviewer presses it, without disturbing the rest', async () => {
    mount({ collapseTree: true });

    await userEvent.click(row('src'));

    expect(paths()).toEqual(['docs/', 'src/', 'src/app.ts', 'src/beta.ts', 'top.ts']);
  });

  it('shuts the directories in between too, not only the deepest', () => {
    const deep = [file('a/b/c/deep.ts'), file('a/top.ts')];
    mount({ files: deep, collapseTree: true });

    expect(paths()).toEqual(['a/']);
  });

  it('does not reapply itself when the reviewer has since opened a folder', async () => {
    // The claim that makes this an initial state rather than a live toggle.
    // The options page can write while a review is open, and `useSettings`
    // pushes that straight into this prop.
    const { rerender } = mount({ collapseTree: true });
    await userEvent.click(row('src'));

    rerender(
      <FileTree
        files={FILES}
        current={NO_FILE}
        onSelect={vi.fn()}
        onSetViewed={vi.fn()}
        collapseTree
      />,
    );

    expect(paths()).toEqual(['docs/', 'src/', 'src/app.ts', 'src/beta.ts', 'top.ts']);
  });

  it('does not fling the tree open when the setting is turned off mid-review', () => {
    const { rerender } = mount({ collapseTree: true });

    rerender(
      <FileTree
        files={FILES}
        current={NO_FILE}
        onSelect={vi.fn()}
        onSetViewed={vi.fn()}
        collapseTree={false}
      />,
    );

    expect(paths()).toEqual(['docs/', 'src/', 'top.ts']);
  });

  it('still folds when the setting arrives before the files do', () => {
    // The ordinary case on the real page, and the reason the seed waits for a
    // file list: settings come from `storage.local` a tick after mount, and
    // the pull request arrives over the wire long after that. A tree seeded at
    // mount would have read the default and never looked again.
    const { rerender } = mount({ files: [], collapseTree: true });
    expect(screen.getByText(/no changed files/i)).toBeDefined();

    rerender(
      <FileTree
        files={FILES}
        current={NO_FILE}
        onSelect={vi.fn()}
        onSetViewed={vi.fn()}
        collapseTree
      />,
    );

    expect(paths()).toEqual(['docs/', 'src/', 'top.ts']);
  });

  it('still opens the folder holding the file the column scrolled to', async () => {
    // The tree follows the column, and a shut folder must not leave it
    // pointing at a row that is not on screen.
    const { rerender } = mount({ collapseTree: true });

    await act(async () => {
      rerender(
        <FileTree
          files={FILES}
          current={{ path: 'src/beta.ts', origin: 'scroll' }}
          onSelect={vi.fn()}
          onSetViewed={vi.fn()}
          collapseTree
        />,
      );
    });

    expect(row('beta.ts')).toBeDefined();
  });
});
