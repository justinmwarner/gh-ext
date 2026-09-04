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

import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { FileViewedState } from '@/lib/github/types';
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react';
import type {
  FileTree as FileTreeModel,
  FileTreeIcons,
  FileTreeOptions,
} from '@pierre/trees';
import { FileTreeMenu } from './FileTreeMenu';
import { type CurrentFile, shouldSelectInTree } from './currentFile';
import {
  type FileComments,
  isViewedBox,
  rowDecoration,
  treeGitStatus,
  treePaths,
} from './fileTreeData';
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
  /**
   * How much conversation each file is carrying, by path.
   *
   * Separate from `files` because it comes from a different place and moves on
   * a different clock: posting a comment or resolving a thread changes this and
   * leaves the file list exactly as it was.
   */
  comments?: ReadonlyMap<string, FileComments>;
  /**
   * Viewed state per path, as the session currently holds it — which is ahead
   * of the payload for as long as an optimistic toggle is in flight.
   */
  viewed?: ReadonlyMap<string, FileViewedState>;
  onSelect?: (path: string) => void;
  onToggleViewed?: (path: string) => void;
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
    // The baseline the React component builds its composition on top of: it
    // forces `enabled` and supplies the content, and leaves the rest alone.
    // The button is what a keyboard can reach — the tick in the decoration is
    // a glyph inside a `<button>` row and cannot be focused.
    // Right-click only. With `both` the row itself becomes the trigger — it
    // grows `aria-haspopup="menu"` — and a plain left-click stops selecting the
    // file, which is the tree's whole job. The keyboard loses nothing: `v`
    // toggles viewed on the focused file already, and Shift+F10 raises a
    // context menu on whatever has focus.
    composition: {
      contextMenu: { triggerMode: 'right-click' },
    },
    initialExpansion: 'open',
    icons: TREE_ICONS,
    renderRowDecoration: ({ item }) =>
      item.kind === 'directory'
        ? null
        : rowDecoration(
            lookup(item.path),
            sources.comments?.get(item.path),
            sources.viewed?.get(item.path),
          ),
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
 * Go to from the Conversations view has to be able to reveal a path. Neither
 * is expressible as a prop.
 */
export interface FileTreeHandle {
  model: FileTreeModel;
}

/**
 * The one control the tree cannot give us, delegated onto the host.
 *
 * A row is a `<button role="treeitem">` — which is exactly why `@pierre/trees`
 * documents no per-row control: an `<input>` inside a `<button>` is invalid,
 * and the single decoration slot renders as an inert `<span>`. So the tick is
 * a glyph, and this is what makes it a control.
 *
 * `composedPath` rather than `event.target`, because a listener on the host
 * sees a target retargeted to the host itself. The run is found by its glyph
 * rather than by its position among its siblings: the glyph is ours, the DOM
 * around it is the library's, and only one of those two is a promise.
 *
 * Capture phase and `stopPropagation`, because the row is a button and every
 * click inside it is a click on the row. A tick that also navigated would move
 * the diff column out from under the reviewer each time they ticked one off.
 */
function viewedBoxClick(event: Event): string | null {
  let path: string | null = null;
  let onBox = false;

  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (!onBox && isViewedBox(node.textContent ?? '')) onBox = true;
    const item = node.getAttribute('data-item-path');
    if (item !== null) {
      path = item;
      break;
    }
  }

  return onBox && path !== null && !path.endsWith('/') ? path : null;
}

/**
 * The full path, on hover.
 *
 * The row carries no `title` of its own and its `aria-label` is the bare file
 * name, so a path the content lane truncated had nowhere left to say which
 * file it was. Written on hover rather than once, because the rows are
 * recycled by virtualization — the element under the pointer a moment ago is
 * a different file now.
 */
function titleOnHover(event: Event): void {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    const path = node.getAttribute('data-item-path');
    if (path === null) continue;
    // Directories are keyed with a trailing slash. Nobody calls them that.
    const label = path.endsWith('/') ? path.slice(0, -1) : path;
    if (node.getAttribute('title') !== label) node.setAttribute('title', label);
    return;
  }
}

export interface FileTreeProps {
  files: readonly ReviewFile[];
  /**
   * Conversations per path. Must be referentially stable between renders —
   * its identity is what triggers a redraw, so a fresh map every render would
   * re-render the whole tree on every keystroke anywhere on the page.
   */
  comments?: ReadonlyMap<string, FileComments>;
  /** Viewed state per path, stable between renders for the same reason. */
  viewed?: ReadonlyMap<string, FileViewedState>;
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  /** The reviewer selected or arrow-keyed onto a file. */
  onSelect: (path: string) => void;
  /** The reviewer clicked a row's tick. */
  onToggleViewed?: (path: string) => void;
  ref?: Ref<FileTreeHandle>;
}

export function FileTree({
  files,
  comments,
  viewed,
  current,
  onSelect,
  onToggleViewed,
  ref,
}: FileTreeProps) {
  // One object for the whole lifetime of the tree, mutated in place: the
  // options it was constructed from hold this exact reference.
  const [sources] = useState<FileTreeSources>(() => ({ files, onSelect }));
  sources.files = files;
  sources.comments = comments;
  sources.viewed = viewed;
  sources.onSelect = onSelect;
  sources.onToggleViewed = onToggleViewed;

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

  // The same lever again, for the source the tree has even less idea about.
  // Nothing in `files` moves when a comment is posted or a thread is resolved,
  // so without this the conversation marks would be drawn once and then stay
  // wrong for the rest of the review — the failure mode being a file that says
  // it has nothing outstanding while a reply sits on it unread.
  const appliedComments = useRef(comments);
  useEffect(() => {
    if (appliedComments.current === comments) return;
    appliedComments.current = comments;
    model.setIcons(TREE_ICONS);
  }, [model, comments]);

  // And once more for the ticks, which move on a third clock again.
  const appliedViewed = useRef(viewed);
  useEffect(() => {
    if (appliedViewed.current === viewed) return;
    appliedViewed.current = viewed;
    model.setIcons(TREE_ICONS);
  }, [model, viewed]);


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

  /**
   * Memoized, and it has to be. The React component re-derives its composition
   * whenever this identity changes and re-renders the whole tree when it does
   * — so a fresh closure each render would rebuild every visible row on every
   * keystroke anywhere on the page. It reads through `sources` instead, which
   * is the same live box the decoration renderer uses.
   */
  const renderContextMenu = useCallback(
    (item: { kind: 'directory' | 'file'; path: string }, context: { close: () => void }) => (
      <FileTreeMenu
        item={item}
        viewed={sources.viewed?.get(item.path) ?? 'UNVIEWED'}
        onToggleViewed={(path) => sources.onToggleViewed?.(path)}
        onClose={() => context.close()}
      />
    ),
    [sources],
  );

  return (
    <PierreFileTree
      model={model}
      className="filetree-host"
      renderContextMenu={renderContextMenu}
      // Everything that is not one of the tree's own four props is spread onto
      // the host element, which is how these two reach a shadow tree we cannot
      // otherwise attach anything to.
      //
      // Capture, and it has to be: the row is a `<button>`, so a tick that let
      // the event through would also navigate the diff column.
      //
      // All three of them. The tree acts on the *pointer down*, not on the
      // click — so stopping the click alone ticked the box and selected the
      // file, which only a real browser was ever going to show.
      onPointerDownCapture={(event) => {
        if (viewedBoxClick(event.nativeEvent) === null) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDownCapture={(event) => {
        if (viewedBoxClick(event.nativeEvent) === null) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClickCapture={(event) => {
        const path = viewedBoxClick(event.nativeEvent);
        if (path === null) return;
        event.preventDefault();
        event.stopPropagation();
        onToggleViewed?.(path);
      }}
      onPointerOver={(event) => {
        titleOnHover(event.nativeEvent);
      }}
    />
  );
}
