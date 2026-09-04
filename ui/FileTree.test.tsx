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

import { act, render, screen, within } from '@testing-library/react';
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
