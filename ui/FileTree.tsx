/**
 * The left rail's file tree, over `@pierre/trees`.
 *
 * Three properties of that library shape everything below, and all three are
 * verified rather than assumed (`docs/reference/pierre-trees-api.md`):
 *
 * - **Options are read once, at construction.** `useFileTree` builds the model
 *   from the first object it is given and ignores every later one, so the
 *   callbacks close over a live box rather than over props.
 * - **Focus and selection are separate.** Arrow keys move focus and fire no
 *   selection change at all, so following the keyboard means subscribing to the
 *   model and reading `getFocusedPath()`.
 * - **`select()` is additive** and there is no "select only this path", so
 *   driving the tree from the diff column means deselecting first.
 *
 * The built-in search is off (§16.5): its seed key matches any unmodified
 * letter or digit and then calls `stopPropagation()`, which would swallow every
 * single-letter review shortcut whenever the tree held focus.
 */

import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react';
import type {
  FileTree as FileTreeModel,
  FileTreeIcons,
  FileTreeOptions,
} from '@pierre/trees';
import { type CurrentFile, shouldSelectInTree } from './currentFile';
import { rowDecoration, treeGitStatus, treePaths } from './fileTreeData';
import type { ReviewFile } from './reviewFiles';

/**
 * Held so `setIcons` can be handed the same config back.
 *
 * `renderRowDecoration` is constructor-only, there is no `refresh()`, and
 * `setGitStatus` early-returns when its content is unchanged. `setIcons` is the
 * one setter with no equality guard, so re-setting the icons is what makes the
 * tree re-run the decoration renderer. There is no `getIcons()`, hence the
 * module-level constant. Inferred from source and confirmed by test.
 */
const TREE_ICONS: FileTreeIcons = { set: 'complete', colored: true };

/**
 * The live box the constructor-time callbacks read through.
 *
 * `lastReported` is shared by both notification channels — selection and focus
 * — so a file the reviewer selects and then focuses is announced once, and so
 * a selection this component made on the diff column's behalf is not announced
 * back to it at all.
 */
export interface FileTreeSources {
  files: readonly ReviewFile[];
  onSelect?: (path: string) => void;
  lastReported?: string | null;
}

/** Directory paths end in a slash. There is no diff card for a directory. */
const isFilePath = (path: string): boolean => !path.endsWith('/');

function report(sources: FileTreeSources, path: string | null): void {
  if (path === null || !isFilePath(path)) return;
  if (sources.lastReported === path) return;
  sources.lastReported = path;
  sources.onSelect?.(path);
}

export function fileTreeOptions(
  files: readonly ReviewFile[],
  sources: FileTreeSources,
): FileTreeOptions {
  // Rebuilt only when the list identity changes. The renderer runs once per
  // visible row per render pass, and a linear scan per row is the difference
  // between a five-hundred-file tree that scrolls and one that does not.
  let indexedFrom: readonly ReviewFile[] | null = null;
  let byPath = new Map<string, ReviewFile>();
  const lookup = (path: string): ReviewFile | undefined => {
    if (indexedFrom !== sources.files) {
      indexedFrom = sources.files;
      byPath = new Map(sources.files.map((file) => [file.path, file]));
    }
    return byPath.get(path);
  };

  return {
    paths: treePaths(files),
    gitStatus: treeGitStatus(files),
    // §16.5. We own the file filter on Mod+K instead.
    search: false,
    initialExpansion: 'open',
    icons: TREE_ICONS,
    renderRowDecoration: ({ item }) =>
      item.kind === 'directory' ? null : rowDecoration(lookup(item.path)),
    onSelectionChange(selectedPaths) {
      report(sources, selectedPaths.find(isFilePath) ?? null);
    },
  };
}

/** Expand everything above a path, because `scrollToPath` no-ops on a hidden row. */
function expandAncestors(model: FileTreeModel, path: string): void {
  const segments = path.split('/').filter(Boolean);
  let prefix = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    prefix += `${segments[i]}/`;
    const directory = model.getItem(prefix);
    // `isDirectory()` returns a literal rather than a type predicate, so the
    // union is narrowed on the method that is actually about to be called.
    if (directory !== null && 'expand' in directory && !directory.isExpanded()) {
      directory.expand();
    }
  }
}

/**
 * Make `path` the only selected row, and bring it into view.
 *
 * `focus: false` on the scroll: the reviewer is reading the diff column, and
 * moving DOM focus into the tree would take their keyboard with it.
 */
function selectOnly(model: FileTreeModel, path: string): void {
  expandAncestors(model, path);
  for (const previous of model.getSelectedPaths()) {
    if (previous !== path) model.getItem(previous)?.deselect();
  }
  model.getItem(path)?.select();
  model.scrollToPath(path, { focus: false, offset: 'nearest' });
}

/**
 * The model, for the callers that have to drive it imperatively.
 *
 * The keyboard map moves between files without the tree holding focus, and a
 * jump-list entry has to be able to reveal a path. Neither is expressible as a
 * prop.
 */
export interface FileTreeHandle {
  model: FileTreeModel;
}

export interface FileTreeProps {
  files: readonly ReviewFile[];
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  /** The reviewer selected or arrow-keyed onto a file. */
  onSelect: (path: string) => void;
  ref?: Ref<FileTreeHandle>;
}

export function FileTree({ files, current, onSelect, ref }: FileTreeProps) {
  // One object for the whole lifetime of the tree, mutated in place: the
  // options it was constructed from hold this exact reference.
  const [sources] = useState<FileTreeSources>(() => ({ files, onSelect }));
  sources.files = files;
  sources.onSelect = onSelect;

  const [options] = useState(() => fileTreeOptions(files, sources));
  const { model } = useFileTree(options);

  useImperativeHandle(ref, () => ({ model }), [model]);

  // Never call `model.cleanUp()` here. `useFileTree` already does, on a 1 ms
  // defer that exists so StrictMode's double-invoked effects do not destroy an
  // instance the hook still holds. There is no re-init path if we beat it to it.

  const applied = useRef<readonly ReviewFile[]>(files);
  useEffect(() => {
    if (applied.current === files) return;
    applied.current = files;
    model.resetPaths(treePaths(files));
    model.setGitStatus(treeGitStatus(files));
    // Decorations read from `sources`, which the tree knows nothing about.
    // Re-setting the icons is the only setter with no equality guard, so it is
    // what forces the rows to be decorated again.
    model.setIcons(TREE_ICONS);
  }, [model, files]);

  // Follow the keyboard. Arrow keys move focus and change no selection, so this
  // is the only channel that sees them. `subscribe` fires on every model emit,
  // not just focus, so the previous value is compared rather than trusted.
  useEffect(() => {
    let previous = model.getFocusedPath();
    return model.subscribe(() => {
      const focused = model.getFocusedPath();
      if (focused === previous) return;
      previous = focused;
      report(sources, focused);
    });
  }, [model, sources]);

  // Follow the diff column — and only the diff column. A change the tree itself
  // made is already on screen, and re-selecting it would emit again.
  const path = current.path;
  const acts = shouldSelectInTree(current);
  useEffect(() => {
    if (!acts || path === null) return;
    // Claimed before selecting: `select()` and `deselect()` each emit, and the
    // caller does not need to be told about a move it asked for.
    sources.lastReported = path;
    selectOnly(model, path);
  }, [model, sources, acts, path]);

  if (files.length === 0) {
    return <p className="placeholder">No changed files.</p>;
  }

  return <PierreFileTree model={model} className="filetree-host" />;
}
