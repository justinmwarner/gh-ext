/**
 * The file tree.
 *
 * `@pierre/trees` renders into a shadow root and virtualizes against a
 * scrollport jsdom cannot measure, so nothing here asserts on its DOM. Two
 * things are ours and both are checkable: the option object the tree is
 * constructed from, and the model it hands back — which is where selection,
 * focus and the loop guard live.
 */

import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FileTreeVisibleRow } from '@pierre/trees';
import { FileTree, type FileTreeHandle, fileTreeOptions } from './FileTree';
import { NO_FILE } from './currentFile';
import type { ReviewFile } from './reviewFiles';

const file = (overrides: Partial<ReviewFile> & { path: string }): ReviewFile => ({
  oldPath: overrides.path,
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
  file({ path: 'src/app.ts', changeType: 'MODIFIED' }),
  file({ path: 'src/new.ts', changeType: 'ADDED' }),
  file({ path: 'package-lock.json', noise: true }),
];

/** A row as the tree describes one when it asks for a decoration. */
const visibleRow = (path: string): FileTreeVisibleRow => ({
  ancestorPaths: [],
  depth: 0,
  hasChildren: false,
  index: 0,
  isFocused: false,
  isSelected: false,
  isExpanded: false,
  isFlattened: false,
  kind: 'file',
  level: 1,
  name: path,
  path,
  posInSet: 1,
  setSize: 1,
});

const decorationFor = (
  options: ReturnType<typeof fileTreeOptions>,
  path: string,
  kind: 'file' | 'directory' = 'file',
) =>
  options.renderRowDecoration?.({
    item: { kind, name: path, path },
    row: visibleRow(path),
  }) ?? null;

function mount(props: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const ref = createRef<FileTreeHandle>();
  const onSelect = vi.fn<(path: string) => void>();
  const view = render(
    <FileTree ref={ref} files={FILES} current={NO_FILE} onSelect={onSelect} {...props} />,
  );
  const model = ref.current?.model;
  if (model == null) throw new Error('FileTree did not expose its model');
  return { ...view, model, onSelect };
}

describe('fileTreeOptions', () => {
  it('hands over every changed path, noise included', () => {
    // Noise is de-emphasized, never hidden: a reviewer who wants to read the
    // lockfile has to be able to reach it.
    expect(fileTreeOptions(FILES, { files: FILES }).paths).toEqual([
      'src/app.ts',
      'src/new.ts',
      'package-lock.json',
    ]);
  });

  it('derives the git lane from each file’s change type', () => {
    expect(fileTreeOptions(FILES, { files: FILES }).gitStatus).toEqual([
      { path: 'src/app.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'package-lock.json', status: 'ignored' },
    ]);
  });

  it('turns the built-in search off', () => {
    // `isSearchOpenSeedKey` matches any unmodified letter or digit and then
    // calls stopPropagation, which would swallow every single-letter review
    // shortcut whenever the tree held focus. §16.5.
    expect(fileTreeOptions(FILES, { files: FILES }).search).toBe(false);
  });

  it('decorates a row with the counts for that row’s file', () => {
    const options = fileTreeOptions(FILES, { files: FILES });

    expect(decorationFor(options, 'src/app.ts')).toMatchObject({ text: '+12 −3' });
  });

  it('reads the decoration from the current file list, not the one it was built with', () => {
    // Tree options are read once, at construction, so the renderer has to close
    // over a live reference or the counts freeze at first paint.
    const live = { files: FILES };
    const options = fileTreeOptions(FILES, live);
    live.files = [file({ path: 'src/app.ts', additions: 99, deletions: 0 })];

    expect(decorationFor(options, 'src/app.ts')).toMatchObject({ text: '+99 −0' });
  });

  it('leaves a directory row undecorated', () => {
    const options = fileTreeOptions(FILES, { files: FILES });

    expect(decorationFor(options, 'src/', 'directory')).toBeNull();
  });
});

describe('FileTree', () => {
  it('puts every changed path in the model', () => {
    const { model } = mount();

    expect(model.getItem('src/app.ts')).not.toBeNull();
    expect(model.getItem('src/new.ts')).not.toBeNull();
    expect(model.getItem('package-lock.json')).not.toBeNull();
  });

  it('groups paths into the directories they came from', () => {
    const { model } = mount();

    expect(model.getItem('src/')?.isDirectory()).toBe(true);
  });

  it('reports a file the reviewer selected', () => {
    const { model, onSelect } = mount();

    act(() => {
      model.getItem('src/new.ts')?.select();
    });

    expect(onSelect).toHaveBeenCalledWith('src/new.ts');
  });

  it('ignores a directory row, which selection also reports', () => {
    // A plain click on a folder both selects it and toggles expansion, so
    // `onSelectionChange` hands back paths ending in `/`. There is no diff card
    // for a directory.
    const { model, onSelect } = mount();

    act(() => {
      model.getItem('src/')?.select();
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('follows arrow-key navigation, which moves focus and not selection', () => {
    const { model, onSelect } = mount();

    act(() => {
      model.focusPath('package-lock.json');
    });

    expect(onSelect).toHaveBeenCalledWith('package-lock.json');
  });

  it('does not report the same file twice', () => {
    const { model, onSelect } = mount();

    act(() => {
      model.getItem('src/new.ts')?.select();
    });
    act(() => {
      model.focusPath('src/new.ts');
    });

    expect(onSelect.mock.calls.filter(([p]) => p === 'src/new.ts')).toHaveLength(1);
  });

  it('leaves its own selection alone when the tree is what moved', () => {
    // The tree already shows what the reviewer clicked. Re-selecting it would
    // emit another change, which is the first half of a feedback loop.
    const { model, onSelect, rerender } = mount();

    act(() => {
      model.getItem('src/app.ts')?.select();
    });
    onSelect.mockClear();

    rerender(
      <FileTree
        files={FILES}
        current={{ path: 'src/new.ts', origin: 'tree' }}
        onSelect={onSelect}
      />,
    );

    expect(model.getSelectedPaths()).toEqual(['src/app.ts']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects exactly the file the diff column scrolled to', () => {
    // `select()` is additive and there is no "select only this", so the
    // previous selection has to be cleared or the tree accumulates rows.
    const { model, onSelect, rerender } = mount();

    act(() => {
      model.getItem('src/app.ts')?.select();
    });

    rerender(
      <FileTree
        files={FILES}
        current={{ path: 'src/new.ts', origin: 'scroll' }}
        onSelect={onSelect}
      />,
    );

    expect(model.getSelectedPaths()).toEqual(['src/new.ts']);
  });

  it('only ever echoes back the path it was just given', () => {
    // Selecting fires `onSelectionChange`, so a scroll-driven update does come
    // back out. It has to name the file the caller already holds, so the
    // caller's reducer absorbs it instead of moving again.
    const { onSelect, rerender } = mount();
    onSelect.mockClear();

    rerender(
      <FileTree
        files={FILES}
        current={{ path: 'src/new.ts', origin: 'scroll' }}
        onSelect={onSelect}
      />,
    );

    for (const [path] of onSelect.mock.calls) expect(path).toBe('src/new.ts');
  });

  it('takes a new file list without rebuilding the model', () => {
    const { model, rerender } = mount();

    rerender(
      <FileTree
        files={[file({ path: 'src/other.ts' })]}
        current={NO_FILE}
        onSelect={vi.fn()}
      />,
    );

    expect(model.getItem('src/other.ts')).not.toBeNull();
  });

  it('redraws the counts when the file list changes underneath it', () => {
    // The one place this file looks inside Pierre's shadow root, deliberately.
    //
    // `renderRowDecoration` is constructor-only, there is no `refresh()`, and
    // `setGitStatus` early-returns on unchanged content — so the decorations
    // are refreshed by re-setting the icons, which is the one setter with no
    // equality guard. That is inferred from `@pierre/trees` source rather than
    // documented, on a package still at `1.0.0-beta.6`. Nothing of ours can
    // observe whether it worked, and a silent regression here would freeze
    // every count at first paint. So this asserts on the rendered text.
    const { container, rerender } = mount();
    const shadow = () =>
      container.querySelector('file-tree-container')?.shadowRoot?.textContent ?? '';

    expect(shadow()).toContain('+12');

    // The same paths, with different counts. Changing the *paths* would refresh
    // the rows through `resetPaths` on its own, which would not exercise this
    // at all — the counts have to move while the tree's own state stands still.
    rerender(
      <FileTree
        files={FILES.map((f) => ({ ...f, additions: 99 }))}
        current={NO_FILE}
        onSelect={vi.fn()}
      />,
    );

    expect(shadow()).toContain('+99');
    expect(shadow()).not.toContain('+12');
  });

  it('says so when nothing changed', () => {
    const { container } = render(
      <FileTree files={[]} current={NO_FILE} onSelect={vi.fn()} />,
    );

    expect(container.textContent).toMatch(/no changed files/i);
  });
});
