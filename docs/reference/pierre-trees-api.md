# `@pierre/trees` — verified API reference

> **Accuracy contract.** Every signature, string literal and behavioural claim below was copied
> from, or read directly out of, the sources listed in "Provenance". Anything I could not
> establish from source is explicitly marked **UNVERIFIED**.

---

## Provenance

| Item | Value |
| --- | --- |
| Package | `@pierre/trees` |
| Version documented | **`1.0.0-beta.6`** |
| npm dist-tags | `latest = 1.0.0-beta.6`, `beta = 1.0.0-beta.6` (`npm view @pierre/trees version dist-tags`) |
| npm publish/modify time | `2026-08-22T02:30:40.653Z` |
| Source repo | `pierrecomputer/pierre`, Apache-2.0 |
| Repo ref read | `main` @ `6ce4da89cb21f2afbe0b49823e014c659f9da9a9` (2026-09-01T15:48:36Z) |
| License | Apache-2.0 (`packages/trees/package.json` -> `"license": "apache-2.0"`) |

**Repo-vs-npm drift check.** Exactly one commit touched `packages/trees` between the npm publish
and the ref I read: `f95345a076d7` (2026-08-28, *"chore: mark React as optional (#1091)"*), which
only changes `peerDependenciesMeta`. I additionally downloaded the published tarball
(`npm pack @pierre/trees@1.0.0-beta.6`) and read `dist/render/FileTree.d.ts`,
`dist/model/publicTypes.d.ts` and `dist/index.d.ts`; they match the `src/` I read. **The source
quoted in this document is the published API.**

### Sources actually read

Agent skill (highest-value; written to teach an agent this API):

- `skills/trees/SKILL.md`
- `skills/trees/references/api-core.md`, `api-react.md`, `api-ssr.md`, `api-web-components.md`
- `skills/trees/references/recipe-react.md`, `recipe-vanilla.md`, `recipe-interactions.md`,
  `recipe-ssr.md`, `recipe-theme.md`

TypeScript source under `packages/trees/`:

- `package.json`
- `src/index.ts`, `src/publicTypes.ts`, `src/constants.ts`, `src/iconConfig.ts`,
  `src/preparedInput.ts`, `src/web-components.ts`, `src/string-import.d.ts`, `src/style.css`
- `src/model/publicTypes.ts` (the single most important file), `src/model/FileTreeController.ts`,
  `src/model/gitStatus.ts`, `src/model/density.ts`, `src/model/virtualization.ts`,
  `src/model/searchHelpers.ts`
- `src/render/FileTree.ts` (the `FileTree` class), `src/render/FileTreeView.tsx` (Preact view:
  keyboard, click, decoration lanes), `src/render/rowClickPlan.ts`,
  `src/render/controllerSnapshotSubscription.ts`
- `src/react/index.ts`, `src/react/FileTree.tsx`, `src/react/useFileTree.ts`,
  `src/react/useFileTreeSelection.ts`, `src/react/useFileTreeSelector.ts`,
  `src/react/useFileTreeSearch.ts`
- `src/components/Icon.tsx`, `src/components/web-components.ts`
- `src/utils/gitStatusPresentation.ts`, `src/utils/normalizeInputPath.ts`,
  `src/utils/themeToTreeStyles.ts`

Published artifact: `dist/index.d.ts`, `dist/render/FileTree.d.ts`, `dist/model/publicTypes.d.ts`.

Repo issues (roadmap/limitation context only, see section E): `#498`, `#691` — both **open**.

**Not read:** `https://trees.software/docs`. WebFetch is blocked in this environment; WebSearch
returned only marketing-level summaries. **No API fact in this document comes from trees.software.**
`@pierre/path-store` internals were not read; per `src/model/publicTypes.ts` they are explicitly
*not* part of the public surface ("Path-store remains a runtime dependency but is not part of the
documented surface"), and `@pierre/trees` re-declares every shape it needs.

---

## 0. Entry points, install, and the option object

`package.json` `exports`:

```jsonc
{
  ".":                { "types": "./dist/index.d.ts",          "import": "./dist/index.js" },
  "./web-components": { "types": "./dist/web-components.d.ts", "import": "./dist/web-components.js" },
  "./react":          { "types": "./dist/react/index.d.ts",    "import": "./dist/react/index.js" },
  "./ssr":            { "types": "./dist/ssr/index.d.ts",      "import": "./dist/ssr/index.js" }
}
```

- `react` / `react-dom` are **optional** peer deps (`^18.3.1 || ^19.0.0`).
- Runtime deps: `@pierre/path-store`, `@pierre/theming`, `preact`, `preact-render-to-string`.
  The tree body is rendered by **Preact**, not React, even from the React entry.
- **No CSS import is required.** `src/style.css` is inlined into the bundle
  (`import rawStyles from '../style.css?inline'`) and installed into each shadow root via
  `adoptedStyleSheets`, with an inline `<style data-file-tree-style>` fallback.
- The custom element auto-registers as a side effect of importing `@pierre/trees` or
  `@pierre/trees/react`. `src/components/web-components.ts` runs, at module scope:

  ```ts
  if (typeof HTMLElement !== 'undefined' && customElements.get(FILE_TREE_TAG_NAME) == null) {
    class FileTreeContainer extends HTMLElement {
      connectedCallback() {
        const shadowRoot = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        prepareFileTreeShadowRoot(this, shadowRoot);
      }
    }
    customElements.define(FILE_TREE_TAG_NAME, FileTreeContainer);
    /* ...best-effort sync adoption pass over existing document nodes... */
  }
  ```

  You do **not** need to import `@pierre/trees/web-components` separately unless you want its
  named helpers.

### `FileTreeOptions` — the complete constructor option set

Composed in `src/model/publicTypes.ts` as
`FileTreeOptions = FileTreeControllerOptions & FileTreeOptionSurface`. Flattened, verbatim:

```ts
// --- input (exactly one of these two shapes) --------------------------------
type FileTreeInputOptions =
  | { paths: readonly FileTreePublicId[]; preparedInput?: FileTreePreparedInput }
  | { paths?: readonly FileTreePublicId[]; preparedInput: FileTreePreparedInput };

// --- store / behaviour ------------------------------------------------------
interface FileTreeStoreOptions {
  flattenEmptyDirectories?: boolean;
  initialExpansion?: FileTreeInitialExpansion;   // 'closed' | 'open' | number
  initialExpandedPaths?: readonly FileTreePublicId[];
  presorted?: boolean;
  sort?: 'default' | FileTreeSortComparator;
}

type FileTreeControllerBehaviorOptions = FileTreeStoreOptions & {
  dragAndDrop?: boolean | FileTreeDragAndDropConfig;
  fileTreeSearchMode?: FileTreeSearchMode;       // NOTE: `fileTreeSearchMode`, NOT `searchMode`
  initialSearchQuery?: string | null;
  initialSelectedPaths?: readonly FileTreePublicId[];
  onSearchChange?: FileTreeSearchChangeListener;
  renaming?: boolean | FileTreeRenamingConfig;
};

// --- render + presentation --------------------------------------------------
interface FileTreeRenderOptions {
  initialVisibleRowCount?: number;   // fractional allowed
  itemHeight?: number;
  overscan?: number;
  stickyFolders?: boolean;
}

type FileTreeOptionSurface = FileTreeRenderOptions & {
  composition?: FileTreeCompositionOptions;
  density?: FileTreeDensity;                     // 'compact' | 'default' | 'relaxed' | number
  gitStatus?: readonly GitStatusEntry[];
  id?: string;
  icons?: FileTreeIcons;
  onSelectionChange?: FileTreeSelectionChangeListener;
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  search?: boolean;
  searchFakeFocus?: boolean;                     // demo/marketing only: fake focus ring
  searchBlurBehavior?: FileTreeSearchBlurBehavior;   // 'close' (default) | 'retain'
  unsafeCSS?: string;
};
```

`FileTreePublicId = string` — *"Public tree identity is path-first so render and model callers
never depend on the underlying path-store numeric IDs."*

**Path conventions** (`recipe-interactions.md` + `src/utils/normalizeInputPath.ts`): directory
input paths end with `/`; file input paths do not. `normalizeInputPath` strips empty segments and
uses the trailing slash as the sole directory marker. `getItem()` is lenient — its doc comment:
*"Accepts both canonical directory paths (`src/`) and bare directory lookup paths (`src`) so
callers do not need to know the canonical slash rules."*

### Options are read **once**, at construction

`useFileTree` creates the model with `useState(() => new FileTree(options))`; its doc comment:

```
// Creates the model exactly once so React callers have a stable imperative
// runtime. Later option changes are intentionally ignored; callers must use
// explicit model methods like resetPaths and setComposition.
```

Only these options have a post-construction setter: `gitStatus` -> `setGitStatus` /
`applyGitStatusPatch`; `icons` -> `setIcons`; `composition` -> `setComposition`; `paths` ->
`resetPaths` / `add` / `remove` / `move` / `batch`.

Fields held in `readonly` private members of `FileTree` / `FileTreeController` and therefore
**fixed for the model's lifetime**: `onSelectionChange`, `renderRowDecoration`, `renaming`,
`search`, `searchBlurBehavior`, `searchFakeFocus`, `unsafeCSS`, `density`/`itemHeight`, `overscan`,
`stickyFolders`, `initialVisibleRowCount`, `onSearchChange`, `dragAndDrop`, `sort`,
`flattenEmptyDirectories`.

### Density / row height constants

```ts
export const FILE_TREE_DENSITY_PRESETS: Record<FileTreeDensityKeyword, FileTreeDensityPreset> = {
  compact: { itemHeight: 24, factor: 0.8 },
  default: { itemHeight: 30, factor: 1 },
  relaxed: { itemHeight: 36, factor: 1.2 },
};
export const FILE_TREE_DEFAULT_ITEM_HEIGHT: number = FILE_TREE_DENSITY_PRESETS.default.itemHeight; // 30
export const FILE_TREE_DEFAULT_OVERSCAN = 10;
export const FILE_TREE_DEFAULT_VIEWPORT_HEIGHT = 420;
```

An explicit `itemHeight` always wins over the density preset's height.

### The complete `FileTree` class surface

Copied verbatim from the **published** `dist/render/FileTree.d.ts`:

```ts
declare class FileTree implements FileTreeMutationHandle, FileTreeSearchSessionHandle {
  #private;
  static LoadedCustomComponent: boolean;
  constructor(options: FileTreeOptions);
  unmount(): void;
  cleanUp(): void;
  getFileTreeContainer(): HTMLElement | undefined;
  getItem(path: string): FileTreeItemHandle | null;
  getFocusedItem(): FileTreeItemHandle | null;
  getFocusedPath(): string | null;
  getFocusedIndex(): number;
  getVisibleCount(): number;
  getVisibleRows(start: number, end: number): readonly FileTreeVisibleRow[];
  getSelectedPaths(): readonly string[];
  getComposition(): FileTreeCompositionOptions | undefined;
  getItemHeight(): number;
  getDensityFactor(): number;
  subscribe(listener: FileTreeListener): () => void;
  focusPath(path: string): void;
  focusFirstItem(): void;
  focusLastItem(): void;
  focusNextItem(): void;
  focusPreviousItem(): void;
  focusParentItem(): void;
  scrollToPath(path: FileTreePublicId, options?: FileTreeScrollToPathOptions): void;
  focusNearestPath(path: string | null): string | null;
  add(path: string): void;
  batch(operations: readonly FileTreeBatchOperation[]): void;
  applyGitStatusPatch(patch: FileTreeGitStatusPatch): void;
  move(fromPath: string, toPath: string, options?: FileTreeMoveOptions): void;
  onMutation<TType extends FileTreeMutationEventType | '*'>(type: TType, handler: (event: FileTreeMutationEventForType<TType>) => void): () => void;
  setSearch(value: string | null): void;
  openSearch(initialValue?: string): void;
  closeSearch(): void;
  isSearchOpen(): boolean;
  getSearchValue(): string;
  getSearchMatchingPaths(): readonly string[];
  focusNextSearchMatch(): void;
  focusPreviousSearchMatch(): void;
  startRenaming(path?: string, options?: { removeIfCanceled?: boolean; }): boolean;
  remove(path: string, options?: FileTreeRemoveOptions): void;
  resetPaths(paths: readonly string[], options?: FileTreeResetOptions): void;
  resetPaths(options: FileTreeResetPreparedOptions): void;
  setComposition(composition?: FileTreeCompositionOptions): void;
  setGitStatus(gitStatus?: FileTreeOptions['gitStatus']): void;
  setIcons(icons?: FileTreeOptions['icons']): void;
  hydrate({ fileTreeContainer }: FileTreeHydrationProps): void;
  render({ containerWrapper, fileTreeContainer }: FileTreeRenderProps): void;
}
```

> **There is no `select`, `deselect`, `expand`, `collapse`, `refresh`, `invalidate`,
> `setRenderRowDecoration`, `setPaths`, `setOptions`, `on(...)`, `addEventListener(...)`, or
> `destroy()` on this class.** That list is exhaustive — it is the whole published declaration.
> Selection and expansion go through `getItem(path)` handles (sections B and G).

---

## A. React usage

### Exports of `@pierre/trees/react` (verbatim `src/react/index.ts`)

```ts
export { FileTree, type FileTreePreloadedData, type FileTreeProps } from './FileTree';
export { useFileTree, type UseFileTreeResult } from './useFileTree';
export { useFileTreeSelector, type FileTreeSelector, type FileTreeSelectorEquality } from './useFileTreeSelector';
export { useFileTreeSelection } from './useFileTreeSelection';
export { useFileTreeSearch, type FileTreeSearchState } from './useFileTreeSearch';
```

Note the collision: `FileTree` from `@pierre/trees` is the **model class**; `FileTree` from
`@pierre/trees/react` is the **component**. Alias one of them on import.

### `<FileTree>` props — exact and complete

```ts
export type FileTreePreloadedData = Pick<FileTreeSsrPayload, 'id' | 'shadowHtml'>;

export interface FileTreeProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  header?: ReactNode;
  model: FileTreeModel;                       // the FileTree class instance; REQUIRED
  preloadedData?: FileTreePreloadedData;
  renderContextMenu?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext
  ) => ReactNode;
}
```

That is the complete list of tree-specific props — four. Everything else is
`React.HTMLAttributes<HTMLElement>` (`className`, `style`, `id`, `aria-*`, DOM handlers) spread
onto the `<file-tree-container>` host element. `children` is **removed** from the prop type; you
cannot nest arbitrary children.

There is **no** `paths`, `onSelect`, `onSelectionChange`, `gitStatus`, `icons`, `search`, or
`options` prop on the component. All of those are model concerns.

The component:

- Renders `<file-tree-container>` (`FILE_TREE_TAG_NAME`) and gets its element via a ref callback.
- Merges density CSS vars into `style`, caller `style` keys winning:
  ```tsx
  const mergedStyle: CSSProperties = {
    ['--trees-item-height' as string]: `${String(model.getItemHeight())}px`,
    ['--trees-density-override' as string]: model.getDensityFactor(),
    ...hostProps.style,
  };
  ```
- Mounts/unmounts in a layout effect (`useLayoutEffect` on client, `useEffect` on server):
  ```tsx
  useClientLayoutEffect(() => {
    if (hostElement == null) return;
    if (preloadedData != null && hasExistingPreloadedContent(hostElement)) {
      model.hydrate({ fileTreeContainer: hostElement });
    } else {
      model.render({ fileTreeContainer: hostElement });
    }
    return () => {
      model.unmount();
      model.setComposition(baselineComposition);
    };
  }, [baselineComposition, hostElement, model, preloadedData]);
  ```
- **Owns `composition` while mounted.** It snapshots `model.getComposition()` into a ref at first
  render and calls `model.setComposition(composition)` in a layout effect whenever its derived
  composition changes, deriving it from `header` and `renderContextMenu`. If you pass
  `renderContextMenu`, the component force-sets `contextMenu.enabled = true` and **deletes**
  `contextMenu.render` from the composition (React content is slotted instead). Consequence:
  **do not call `model.setComposition()` yourself while the React component is mounted** — it will
  be overwritten.

### The model, memoization, and cleanup (React 19)

`useFileTree` is the intended owner. Verbatim `src/react/useFileTree.ts`:

```ts
'use client';
import { useEffect, useRef, useState } from 'react';
import type { FileTreeOptions } from '../model/publicTypes';
import { FileTree } from '../render/FileTree';

interface CleanUpRef { timeout: ReturnType<typeof setTimeout> | null; model: FileTree; }
export interface UseFileTreeResult { model: FileTree; }

export function useFileTree(options: FileTreeOptions): UseFileTreeResult {
  const [model] = useState(() => new FileTree(options));
  const cleanUpRef = useRef<CleanUpRef>({ timeout: null, model });
  useEffect(() => {
    const { current } = cleanUpRef;
    // NOTE(amadeus): This is designed to ensure strict mode doesn't blow away
    // our instance -- we wait a cycle to clean up
    if (current.timeout != null) { clearTimeout(current.timeout); current.timeout = null; }
    return () => { current.timeout = setTimeout(() => current.model.cleanUp(), 1); };
  }, []);
  return { model };
}
```

**Correct cleanup pattern in React: do nothing.** `useFileTree` already calls `cleanUp()` on
unmount, deferred by 1 ms specifically so React 19 StrictMode's double-invoked effects do not
destroy the model. **Do not call `model.cleanUp()` from your own effect** — you would destroy a
model the hook still holds, and there is no re-init path.

Memoization: `useState(() => ...)` means the model is created once and `options` is read once.
There is no need to `useMemo` the options object, and no benefit — later option identity changes
are ignored by design. If you want to own the model yourself instead (e.g. to share it with a
sibling component), a `useRef` created lazily works, but then **you** must call `cleanUp()` on
unmount and must handle StrictMode double-invocation yourself.

`cleanUp()` vs `unmount()` (`src/render/FileTree.ts`):

```ts
public unmount(): void { /* tears down the DOM view; model state survives */ }
public cleanUp(): void {
  this.unmount();
  this.#selectionSubscription?.();
  this.#selectionSubscription = null;
  this.#controller.destroy();
}
```

`unmount()` is called by the component on effect teardown; `cleanUp()` destroys the controller and
the model is not reusable afterwards. **UNVERIFIED:** whether a `FileTree` instance can be
re-`render()`ed after `cleanUp()` — nothing in the source re-creates the destroyed controller, so
assume no.

### Minimal working React example

Adapted from `skills/trees/references/recipe-react.md` (the skill's own example is the first four
lines of the body); the surrounding wiring is assembled from the verified APIs above.

```tsx
'use client';

import { useEffect } from 'react';
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';

export function ProjectFiles({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    search: true,
    onSelectionChange(selectedPaths) {
      // fires on click / ctrl+space / shift+arrow / ctrl+a / Enter-in-search
      const file = selectedPaths.find((p) => !p.endsWith('/'));
      if (file != null) scrollDiffColumnTo(file);
    },
  });

  // The source path list changed -> push it in imperatively.
  useEffect(() => { model.resetPaths(paths); }, [model, paths]);

  const selectedPaths = useFileTreeSelection(model); // readonly string[]

  // Host MUST have a height; the tree virtualizes against its own scrollport.
  return <FileTree model={model} style={{ height: 320 }} />;
}
```

The skill is explicit about the update path: *"Call model methods for updates after model
creation. For example, call `model.resetPaths(paths)` after the source path list changes."*

**The host element must have a height.** `recipe-vanilla.md` sets `mount.style.height = '320px'`
and `recipe-react.md` / `recipe-theme.md` pass `style={{ height: 320 }}`. Without it the
virtualizer falls back to `FILE_TREE_DEFAULT_VIEWPORT_HEIGHT` (420) for the first paint and then
measures the real (zero-height) scrollport.

### React state-bridge hooks

```ts
// src/react/useFileTreeSelector.ts
export type FileTreeSelector<TSelected> = (model: FileTree) => TSelected;
export type FileTreeSelectorEquality<TSelected> = (previous: TSelected, next: TSelected) => boolean;
export function useFileTreeSelector<TSelected>(
  model: FileTree,
  selector: FileTreeSelector<TSelected>,
  isEqual?: FileTreeSelectorEquality<TSelected>
): TSelected;

// src/react/useFileTreeSelection.ts  (whole file)
export function useFileTreeSelection(model: FileTree): readonly string[] {
  return useFileTreeSelector(model, (currentModel) => currentModel.getSelectedPaths(), areArraysEqual);
}

// src/react/useFileTreeSearch.ts
export interface FileTreeSearchState extends FileTreeSearchSnapshot {  // isOpen, matchingPaths, value
  close: () => void;
  focusNextMatch: () => void;
  focusPreviousMatch: () => void;
  open: (initialValue?: string) => void;
  setValue: (value: string | null) => void;
}
export function useFileTreeSearch(model: FileTree): FileTreeSearchState;
```

`useFileTreeSelector` is built on `useSyncExternalStore(model.subscribe, getSnapshot, getSnapshot)`
— the same `getSnapshot` is used for the server snapshot, so it is SSR-safe. `isEqual` is only
consulted after `Object.is` fails, so primitive selectors need no comparator. **Pass a stable
selector reference** (`useCallback` or a module-level function): the internal cache resets whenever
the selector identity changes.

### SSR (brief)

```ts
declare function preloadFileTree(options: FileTreeOptions): FileTreeSsrPayload;
declare function serializeFileTreeSsrPayload(
  payload: FileTreeSsrPayload,
  mode?: 'declarative' | 'dom'   // default 'declarative'
): string;

export interface FileTreeSsrPayload {
  domOuterStart: string;
  id: string;
  outerEnd: string;
  outerStart: string;
  shadowHtml: string;
}
```

Both are re-exported from `@pierre/trees` as well as `@pierre/trees/ssr`. `preloadFileTree`
ignores `onSelectionChange` and `onSearchChange` (destructured to `_`-prefixed unused locals) but
**does** honour `renderRowDecoration`, `gitStatus`, `icons`, `composition`, `search`, `renaming`.
Pass the same options object to `preloadFileTree` and `useFileTree`, then
`<FileTree model={model} preloadedData={payload} />` (`recipe-ssr.md`).

---

## B. Selection and navigation events

### Focus and selection are two independent pieces of state

This is the single most important thing to internalise. `FileTreeController` holds
`#focusedPath` / `#focusedIndex` **and** `#selectedPaths: Set<string>` / `#selectionAnchorPath`
separately, and `FileTreeVisibleRow` carries both `isFocused` and `isSelected`.

**Arrow-key navigation moves focus only and does NOT change selection.** In the root keydown
handler, `ArrowDown`/`ArrowUp`/`Home`/`End` call `controller.focusNextItem()`,
`focusPreviousItem()`, `focusFirstItem()`, `focusLastItem()` — none of which touch
`#selectedPaths`. So a user arrowing through the tree fires **no** `onSelectionChange`.

### The one selection callback

```ts
// src/model/publicTypes.ts
export type FileTreeSelectionChangeListener = (
  selectedPaths: readonly FileTreePublicId[]
) => void;

// FileTreeOptionSurface
onSelectionChange?: FileTreeSelectionChangeListener;
```

Constructor-time only (`readonly #onSelectionChange`). There is no `addEventListener`,
no `on('select')`, and no DOM `CustomEvent` — I grepped the view and model for
`dispatchEvent` / `CustomEvent` and found none for selection.

Wiring, verbatim from `src/render/FileTree.ts`:

```ts
this.#selectionVersion = this.#controller.getSelectionVersion();
this.#selectionSubscription =
  this.#onSelectionChange == null
    ? null
    : this.subscribe(() => { this.#emitSelectionChange(); });
```

```ts
#emitSelectionChange(): void {
  const onSelectionChange = this.#onSelectionChange;
  if (onSelectionChange == null) return;
  const nextSelectionVersion = this.#controller.getSelectionVersion();
  if (nextSelectionVersion === this.#selectionVersion) return;   // dedupes non-selection emits
  this.#selectionVersion = nextSelectionVersion;
  onSelectionChange(this.#controller.getSelectedPaths());
}
```

**Payload:** `readonly string[]` — the full current selection, canonical paths. Directory paths end
with `/`; file paths do not. There is no per-item event, no "added/removed" delta, no event object.

**Selection can contain directories.** A plain click on a folder row both selects it and toggles
expansion (see the click plan below), so `onSelectionChange` will hand you `"src/"`. Filter with
`!path.endsWith('/')` if you only care about files.

### Exactly which gestures change selection

From `src/render/rowClickPlan.ts` (pure, unit-testable click semantics):

```ts
export function computeFileTreeRowClickPlan(input: FileTreeRowClickPlanInput): FileTreeRowClickPlan {
  const { event, mode, isDirectory } = input;
  const additive = event.ctrlKey || event.metaKey;
  const hasModifier = event.shiftKey || additive;

  const selection: FileTreeRowClickPlan['selection'] = event.shiftKey
    ? { additive, kind: 'range' }
    : additive
      ? { kind: 'toggle' }
      : { kind: 'single' };

  return {
    closeSearch: false,          // a row click does NOT close an open search
    revealCanonical: mode === 'sticky',
    selection,
    toggleDirectory: !hasModifier && isDirectory,
  };
}
```

Applied in `FileTreeView.tsx`:

```ts
switch (plan.selection.kind) {
  case 'range':  controller.selectPathRange(actionTargetPath, plan.selection.additive); break;
  case 'toggle': controller.togglePathSelectionFromInput(actionTargetPath); break;
  case 'single': controller.selectOnlyMountedPathFromInput(actionTargetPath); break;
}
/* ... */
controller.focusMountedPathFromInput(actionTargetPath);
```

| Gesture | Effect |
| --- | --- |
| Plain click | selection becomes exactly `[path]`; focus moves to it; folders also toggle expansion |
| Ctrl/Cmd + click | toggles that path in/out of the selection |
| Shift + click | range select from the anchor (`additive` when Ctrl/Cmd also held) |
| Ctrl/Cmd + Space | `controller.toggleFocusedSelection()` |
| Shift + Arrow Up/Down | `controller.extendSelectionFromFocused(-1 | 1)` |
| Ctrl/Cmd + A | `controller.selectAllVisiblePaths()` |
| `Enter` while search is open | `controller.selectOnlyPath(focusedPath)`; search stays open |
| Arrow / Home / End (no modifier) | **focus only — no selection change** |

There is **no** double-click handler and **no** separate "activate"/"open" event. `onSelectionChange`
is the only selection notification.

### Observing focus (what you need for arrow-key follow)

There is **no `onFocusChange` option**. Use the generic subscription:

```ts
public subscribe(listener: FileTreeListener): () => void;   // FileTreeListener = () => void
public getFocusedPath(): string | null;
public getFocusedItem(): FileTreeItemHandle | null;
public getFocusedIndex(): number;
```

`subscribe` returns an unsubscribe function and suppresses the controller's immediate initial
replay (comment: *"useSyncExternalStore seeds the initial render through getSnapshot(), so the
model-level subscribe wrapper suppresses the controller's immediate replay and only forwards
subsequent store changes to React."*). The listener takes **no arguments** — pull state yourself.

Focus changes do emit: `#setFocusedIndex(index, emit = true)` calls `#emit()`.

React:

```tsx
import { useCallback } from 'react';
import { useFileTreeSelector } from '@pierre/trees/react';

const selectFocusedPath = (m: FileTreeModel) => m.getFocusedPath();
const focusedPath = useFileTreeSelector(model, selectFocusedPath); // string | null
```

Vanilla:

```ts
const unsubscribe = model.subscribe(() => {
  const path = model.getFocusedPath();
  /* ... */
});
```

Caveat: `subscribe` fires on **every** model emit (expansion, search, mutation, scroll request,
focus, selection), not just focus. De-dupe against your own previous value.

### Driving selection/scroll from the other direction (main column -> tree)

```ts
export type FileTreeScrollOffset = 'top' | 'center' | 'nearest';
export interface FileTreeScrollToPathOptions {
  focus?: boolean;      // default true
  offset?: FileTreeScrollOffset;
}
public scrollToPath(path: FileTreePublicId, options?: FileTreeScrollToPathOptions): void;
```

Controller implementation and its doc comment:

```ts
// Records a one-shot scroll request for the mounted view. By default the
// target also becomes the model-focused row; callers can pass `focus: false`
// to reveal a row without changing model focus or DOM focus.
public scrollToPath(path: string, options?: FileTreeScrollToPathOptions): void {
  const resolvedPath = this.#store.getPathInfo(path)?.path ?? null;
  if (resolvedPath == null) return;
  this.#ensureFullProjection();
  const targetIndex = this.#getExactCurrentVisibleIndexByPath(resolvedPath);
  if (targetIndex < 0) return;                       // <-- silent no-op
  /* ... */
  if (options?.focus !== false) this.#setFocusedIndex(targetIndex, false);
  this.#scrollRequest = { id: (this.#scrollRequestId += 1), offset: normalizeScrollOffset(options?.offset), visibleIndex: targetIndex };
  this.#emit();
}
```

**Critical caveat: `scrollToPath` silently no-ops if the row is not currently visible.**
`#getExactCurrentVisibleIndexByPath` resolves against the *visible projection* (or the search
projection when a search is active), so a file inside a collapsed directory returns `-1` and
nothing happens. **You must expand ancestors first** (section G) before calling `scrollToPath`.

**There is no public "select only this path" method on the model.** `FileTreeController` has
`selectOnlyPath(path)`, but the controller is a private field (`readonly #controller`) with no
accessor. The public model only exposes per-item handles:

```ts
export interface FileTreeItemHandleBase {
  deselect(): void;
  focus(): void;
  getPath(): FileTreePublicId;
  isFocused(): boolean;
  isDirectory(): boolean;
  isSelected(): boolean;
  select(): void;
  toggleSelect(): void;
}
```

and `handle.select()` is **additive**:

```ts
// #createFileHandle
select: () => { this.selectPath(path); },
// FileTreeController.selectPath
public selectPath(path: string): void {
  const resolvedPath = this.#resolveSelectionPath(path);
  if (resolvedPath == null || this.#selectedPaths.has(resolvedPath)) return;
  this.#applySelection([...this.#selectedPaths, resolvedPath]);   // union, not replace
}
```

So single-selection follow must clear first:

```ts
function selectOnly(model: FileTree, path: string): void {
  for (const previous of model.getSelectedPaths()) {
    if (previous !== path) model.getItem(previous)?.deselect();
  }
  model.getItem(path)?.select();
  model.scrollToPath(path, { focus: false, offset: 'nearest' });
}
```

Note this fires `onSelectionChange` once per `deselect`/`select` call (each goes through
`#applySelection` -> `#emit()`), so guard against feedback loops with a re-entrancy flag when your
`onSelectionChange` also drives the main column.

Related helpers:

```ts
public focusPath(path: string): void;                              // no scroll
public focusNearestPath(path: string | null): string | null;       // focuses + returns nearest available path
public focusFirstItem/focusLastItem/focusNextItem/focusPreviousItem/focusParentItem(): void;
initialSelectedPaths?: readonly FileTreePublicId[];                // constructor option
```

`focusPath` only sets model focus; it does not scroll and does not select.

---

## C. Git status decoration

### The exact status vocabulary

Verbatim, the **entire** `src/publicTypes.ts`:

```ts
export type GitStatus =
  | 'added'
  | 'deleted'
  | 'ignored'
  | 'modified'
  | 'renamed'
  | 'untracked';

export type GitStatusEntry = {
  path: string;
  status: GitStatus;
};

export type ContextMenuAnchorRect = Readonly<{
  top: number; right: number; bottom: number; left: number;
  width: number; height: number; x: number; y: number;
}>;
```

**Six literals, no more.** There is **no** `'copied'`, `'conflicted'`, `'unmerged'`,
`'typechange'`, or `'changed'`. A GitHub PR file list uses `added | removed | modified | renamed |
copied | changed | unchanged`; you must map:

| GitHub PR file status | `@pierre/trees` `GitStatus` |
| --- | --- |
| `added` | `'added'` |
| `removed` | `'deleted'` |
| `modified` | `'modified'` |
| `renamed` | `'renamed'` |
| `copied` | no exact match — **choose** `'added'` (closest semantics) |
| `changed` | `'modified'` |
| `unchanged` | omit the entry entirely |

### Signatures

```ts
public setGitStatus(gitStatus?: FileTreeOptions['gitStatus']): void;
// i.e.  setGitStatus(gitStatus?: readonly GitStatusEntry[]): void

public applyGitStatusPatch(patch: FileTreeGitStatusPatch): void;

export interface FileTreeGitStatusPatch {
  remove?: readonly FileTreePublicId[];
  set?: readonly GitStatusEntry[];
}
```

Also available as the constructor option `gitStatus?: readonly GitStatusEntry[]`.

`setGitStatus()` **replaces** the whole map (skill: *"Replaces all git status entries"*). Calling
it with no argument clears git status. `applyGitStatusPatch` merges: `remove` first, then `set`.

Both are cheap no-ops when nothing changed — `setGitStatus` compares a content signature and
`applyGitStatusPatch` tracks a `changed` flag; if unchanged, the method returns before re-rendering.

```ts
public setGitStatus(gitStatus?: FileTreeOptions['gitStatus']): void {
  const nextGitStatusState = resolveFileTreeGitStatusState(gitStatus, this.#gitStatusState);
  if (nextGitStatusState === this.#gitStatusState) return;
  this.#gitStatusState = nextGitStatusState;
  const mountedTree = this.#getMountedTreeElements();
  if (mountedTree == null) return;
  renderFileTreeRoot(mountedTree.wrapper, this.#getViewProps());
}
```

Calling either before mount is safe: the state is stored and applied at the next `render()`.

### What is rendered

Verbatim `src/utils/gitStatusPresentation.ts`:

```ts
export const GIT_STATUS_LABEL: Record<GitStatus, string | null> = {
  added: 'A',
  deleted: 'D',
  ignored: null,
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

export const GIT_STATUS_TITLE: Record<GitStatus, string> = {
  added: 'Git status: added',
  deleted: 'Git status: deleted',
  ignored: 'Git status: ignored',
  modified: 'Git status: modified',
  renamed: 'Git status: renamed',
  untracked: 'Git status: untracked',
};

export const GIT_STATUS_DESCENDANT_TITLE = 'Contains git status items';
```

A single letter (`A`/`D`/`M`/`R`/`U`) in a fixed-width lane, with the title as the `title`
attribute. `'ignored'` renders **no letter** (label is `null`) — it only greys the row and marks
descendants.

Directory roll-up is automatic (`src/model/gitStatus.ts`): every ancestor directory of a status
entry is added to `directoriesWithChanges` with a reference count, and a collapsed directory that
contains changes renders a small dot instead of a letter:

```ts
function getBuiltInGitStatusDecoration(
  gitStatus: GitStatus | null,
  containsGitChange: boolean
): FileTreeRowDecoration | null {
  if (gitStatus != null) {
    const label = GIT_STATUS_LABEL[gitStatus];
    if (label == null) return null;
    return { text: label, title: GIT_STATUS_TITLE[gitStatus] };
  }
  if (containsGitChange) {
    return { icon: { name: 'file-tree-icon-dot', width: 6, height: 6 }, title: GIT_STATUS_DESCENDANT_TITLE };
  }
  return null;
}
```

`'ignored'` on a **directory** additionally populates `ignoredDirectoryPaths`, and descendants
inherit the ignored presentation via `getInheritedIgnoredGitStatus`.

### Path handling for git entries

`resolveGitStatusPath` runs each entry through `normalizeInputPath` and then canonicalises:
`getCanonicalGitStatusPath(path, isDirectory) => isDirectory ? path + '/' : path`. Entries whose
path normalises to empty are silently dropped. Statuses are keyed by canonical path and survive
tree mutations (comment: *"Git status is keyed by canonical paths in the file tree so runtime tree
mutations can reuse the same decoration state without rebuilding ID maps."*).

**UNVERIFIED:** the behaviour of a git status entry whose path is not present in the tree's path
list. `resolveFileTreeGitStatusState` stores it in `statusByPath` unconditionally, so it appears
inert, but I did not find a test asserting this.

### Colouring

Per-status CSS custom properties exist for both the letter and the row text:
`--trees-git-added-color`, `--trees-git-modified-color`, `--trees-git-deleted-color`,
`--trees-git-renamed-color`, `--trees-git-untracked-color`, `--trees-git-ignored-color` (each with
a matching `-override` variant), plus `--trees-status-{added,deleted,ignored,modified,renamed,untracked}`
and their `-override` twins. `themeToTreeStyles` populates `--trees-theme-git-added-fg`,
`--trees-theme-git-modified-fg`, `--trees-theme-git-deleted-fg` from the theme's
`gitDecoration.*ResourceForeground` keys. Lane width: `--trees-git-lane-width`.

---

## D. Search

### It filters by default; it does not merely highlight

```ts
export type FileTreeSearchMode =
  | 'expand-matches'
  | 'collapse-non-matches'
  | 'hide-non-matches';
```

Default (`FileTreeController` constructor): `this.#searchMode = fileTreeSearchMode ?? 'hide-non-matches';`

- `'hide-non-matches'` (**default**) — builds a filtered projection containing only matching paths
  plus their ancestor directories; everything else is removed from the visible row list.
  `getVisibleCount()` shrinks accordingly.
- `'expand-matches'` — keeps all rows, expands ancestors of matches (seeded from the
  pre-search expanded set).
- `'collapse-non-matches'` — keeps all rows, expands only match ancestors.

The option name on `FileTreeOptions` is **`fileTreeSearchMode`**, not `searchMode`.

### The matching predicate — case-insensitive substring on the full path

```ts
// src/model/searchHelpers.ts (whole file)
export const normalizeSearchQuery = (value: string): string => {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) return '';
  const normalizedSeparators = trimmedValue.includes('\\')
    ? trimmedValue.replaceAll('\\', '/')
    : trimmedValue;
  return normalizedSeparators.toLowerCase();
};
```

```ts
// FileTreeController.#refreshActiveSearchState
for (let index = 0; index < listedPaths.length; index += 1) {
  const lowerPath = listedPathsLowerCase[index];
  if (!lowerPath.includes(searchValue)) continue;
  ...
}
// then the same loop over #getAllKnownDirectoryPaths()
```

So: query is trimmed, backslashes become forward slashes, lowercased; a path matches if its
lowercased **full path** contains the query as a substring. Files are matched first, then
directories. No fuzzy matching, no glob, no regex.

**There is no custom filter predicate.** `FileTreeOptions` has no `filter`, `matcher`,
`searchPredicate`, or `isMatch` field — the option list in section 0 is complete. If you need
different filtering semantics you must filter your own path list and call `resetPaths(...)`.

### Programmatic control

```ts
export interface FileTreeSearchSessionHandle {
  closeSearch(): void;
  focusNextSearchMatch(): void;
  focusPreviousSearchMatch(): void;
  getSearchMatchingPaths(): readonly FileTreePublicId[];
  getSearchValue(): string;
  isSearchOpen(): boolean;
  openSearch(initialValue?: string): void;
  setSearch(value: string | null): void;
}
```

`FileTree implements ... FileTreeSearchSessionHandle`, so all eight are on the model. Controller
implementations collapse to one state setter:

```ts
public setSearch(value: string | null): void { this.#setSearchState(value, true); }
public openSearch(initialValue: string = ''): void { this.#setSearchState(initialValue, true); }
public closeSearch(): void { this.#setSearchState(null, true); }
public isSearchOpen(): boolean { return this.#searchValue !== null; }
public getSearchValue(): string { return this.#searchValue ?? ''; }
```

Semantics that follow directly from that:

- **`null` closes the session; `''` opens it with an empty query.** `isSearchOpen()` is
  `#searchValue !== null`, so `openSearch()` == `setSearch('')` and `closeSearch()` == `setSearch(null)`.
- Opening snapshots the current expansion (`#searchPreviousExpandedPaths`); closing restores it.
- `onSearchChange?: (value: string | null) => void` fires on every programmatic or user change.
- `getSearchMatchingPaths()` returns matches in "files then directories" order — useful even when
  you render your own UI.
- `focusNextSearchMatch()` / `focusPreviousSearchMatch()` cycle focus through that array.

React sugar: `useFileTreeSearch(model)` returns
`{ isOpen, value, matchingPaths, open, close, setValue, focusNextMatch, focusPreviousMatch }`.

### The built-in search input

Rendered only when `search: true` (`this.#searchEnabled = search === true` — strictly `true`, not
truthy). Markup: `<div data-file-tree-search-container data-open="true|false"><input
data-file-tree-search-input placeholder="Search…" .../></div>`, inside the shadow root, above the
row list.

Keyboard while search is open (handled at the tree root):

| Key | Effect |
| --- | --- |
| `Escape` | `controller.closeSearch()` |
| `Enter` | `controller.selectOnlyPath(focusedPath)`; **search stays open** |
| `ArrowDown` | `controller.focusNextSearchMatch()` |
| `ArrowUp` | `controller.focusPreviousSearchMatch()` |

Blur behaviour:

```ts
export type FileTreeSearchBlurBehavior = 'close' | 'retain';
```

Doc comment: *"`'close'` (the default, and the legacy behavior) clears the query and closes the
search session as soon as the input is blurred. `'retain'` keeps the current query and leaves the
session open, so the filter stays applied until the caller explicitly closes it (via Escape, Enter,
or a programmatic `closeSearch()`)."* With `'retain'`, the close-on-blur guard only applies before
the user's first real interaction with the input.

Collapsing a matched directory during a search is remembered (`#searchCollapsedOverrides`); a
second toggle clears the override.

**Calling `openSearch()` with `search: false`** puts the controller into search state (and filters
rows) but renders **no input**, because the input JSX is gated on `searchEnabled`. If you want to
drive search from your own chrome, either set `search: true` and hide the built-in input with
`unsafeCSS`, or accept that there is no visible query field.

---

## E. Per-item decoration / badges

**Short answer: yes, but exactly one decoration per row, and it must be either a text string
(optionally split into colour-run parts) or a single sprite icon. You cannot render arbitrary
DOM or React into a row.**

### The API

Verbatim from `src/model/publicTypes.ts` (present in the published
`dist/model/publicTypes.d.ts`, lines 174 and 293-311):

```ts
// A run of decoration text with an optional CSS color. Used to render a single
// decoration with multiple independently colored pieces (e.g. green additions
// and red deletions in one cell).
export interface FileTreeRowDecorationTextPart {
  text: string;
  color?: string;
}

export interface FileTreeRowDecorationText {
  text: string;
  title?: string;
  // When provided, the decoration renders these colored parts instead of the
  // plain `text`. `text` is still used as the accessible/fallback string.
  parts?: readonly FileTreeRowDecorationTextPart[];
}

export interface FileTreeRowDecorationIcon {
  icon: RemappedIcon;
  title?: string;
}

export type FileTreeRowDecoration =
  | FileTreeRowDecorationText
  | FileTreeRowDecorationIcon;

export interface FileTreeRowDecorationContext {
  item: FileTreeContextMenuItem;   // { kind: 'directory' | 'file'; name: string; path: string }
  row: FileTreeVisibleRow;
}

export type FileTreeRowDecorationRenderer = (
  context: FileTreeRowDecorationContext
) => FileTreeRowDecoration | null;
```

Supplied **only** as the constructor option `renderRowDecoration?: FileTreeRowDecorationRenderer`.
It is stored in `readonly #renderRowDecoration` — **there is no `setRenderRowDecoration`** and it
is not part of `composition`.

`RemappedIcon` (`src/iconConfig.ts`):

```ts
export type RemappedIcon =
  | string
  | { name: string; width?: number; height?: number; viewBox?: string };
```

`FileTreeVisibleRow`, the second half of the context, is rich:

```ts
export interface FileTreeVisibleRow {
  ancestorPaths: readonly FileTreePublicId[];
  depth: number;
  flattenedSegments?: readonly FileTreeVisibleSegment[];
  hasChildren: boolean;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  isFlattened: boolean;
  kind: 'directory' | 'file';
  level: number;
  name: string;
  path: FileTreePublicId;
  posInSet: number;
  setSize: number;
}
```

### How it renders

```tsx
function renderRowDecoration(decoration, resolveIcon) {
  if (decoration == null) return null;
  if ('text' in decoration) {
    if (decoration.parts != null) {
      return (
        <span title={decoration.title}>
          {decoration.parts.map((part, index) => (
            <span key={index} style={{ color: part.color }}>{part.text}</span>
          ))}
        </span>
      );
    }
    return <span title={decoration.title}>{decoration.text}</span>;
  }
  /* ...icon resolution... */
  return <span title={decoration.title}><Icon {...icon} /></span>;
}
```

Row layout (`renderFileTreeRowContent`), in DOM order:

```tsx
<div data-item-section="spacing">…indent guides…</div>
<div data-item-section="icon">…file/chevron icon…</div>
<div data-item-section="content">…name…</div>
{decorationLaneEnabled ? (
  <div data-item-section="decoration">
    {customDecoration != null ? renderRowDecoration(customDecoration, resolveIcon) : null}
  </div>
) : null}
{gitLaneActive ? (
  <div data-item-section="git">{renderRowDecoration(gitDecoration, resolveIcon)}</div>
) : null}
{actionLaneEnabled ? (<div data-item-section="action">…context-menu button…</div>) : null}
```

**The custom decoration lane and the git lane are separate and coexist.** Source comment:

```
// Built-in git decorations now live in their own fixed lane so custom row
// decorations can coexist without borrowing git styling or precedence.
```

Lane CSS: the decoration lane is `flex: 1 1 0; justify-content: flex-end; overflow: hidden; color:
var(--trees-fg-muted)`, its `> span` is `white-space: nowrap; text-overflow: ellipsis`. The git
lane is `flex: 0 0 auto; width: var(--trees-git-lane-width)`.

Lane activation: `decorationLaneEnabled = customDecoration != null || gitLaneActive || actionLaneEnabled`.

### What this means for the consuming project

| Want | Feasible? |
| --- | --- |
| `+12 −3` added/removed line counts, green/red | **Yes** — one `FileTreeRowDecorationText` with two `parts` carrying `color` |
| A "viewed" checkmark | **Yes**, as a `FileTreeRowDecorationIcon` — but see the sprite requirement below |
| An unresolved-comment count badge | **Yes** as *text* (e.g. `"3"`), but see the "one decoration" limit |
| **All three on the same row at once** | **No.** The renderer returns a single `FileTreeRowDecoration | null`. You must compose them into one text string (`parts` lets you colour the runs) or pick one. |
| Arbitrary HTML / a React component per row | **No.** |
| A clickable control per row (e.g. a "viewed" checkbox) | **No** — the decoration is a plain `<span>`; the only per-row interactive affordance the library offers is the context-menu button (`data-item-section="action"`). |

A pragmatic single-lane composition: `{ text: '+12 −3 · 2💬 · ✓', parts: [...] }`. Emoji/unicode
glyphs in `text`/`parts` need no sprite sheet.

### Icon decorations need a sprite symbol

`Icon` renders `<svg><use href="#name" /></svg>`, resolving against `<symbol>` elements injected
into the shadow root. In the decoration path, only four names resolve through the built-in
resolver:

```ts
name === 'file-tree-icon-chevron' ||
name === 'file-tree-icon-dot' ||
name === 'file-tree-icon-file' ||
name === 'file-tree-icon-lock'
```

Any other string is passed through as a raw sprite symbol id. To use a custom checkmark you must
supply it via the icon config:

```ts
icons: {
  set: 'complete',            // or 'minimal' | 'standard' | 'none'
  spriteSheet: '<svg><symbol id="viewed-check" viewBox="0 0 16 16">…</symbol></svg>',
}
```

`FileTreeIconConfig` in full (`src/iconConfig.ts`):

```ts
export type FileTreeBuiltInIconSet = 'minimal' | 'standard' | 'complete';

export interface FileTreeIconConfig {
  set?: FileTreeBuiltInIconSet | 'none';
  colored?: boolean;
  spriteSheet?: string;                              // SVG string with <symbol> defs
  remap?: Record<string, RemappedIcon>;              // built-in slots: file, chevron, dot, lock
  byFileName?: Record<string, RemappedIcon>;
  byFileExtension?: Record<string, RemappedIcon>;    // no leading dot: "ts", "spec.ts"
  byFileNameContains?: Record<string, RemappedIcon>;
}
export type FileTreeIcons = FileTreeBuiltInIconSet | FileTreeIconConfig;
```

Defaults when `icons` is omitted: `{ set: 'complete', colored: true }`. When an object is given
with any custom override and no `set`, `set` defaults to `'none'`.

`setIcons(icons?)` **is** a runtime setter — it swaps the sprite sheets in the shadow root and
re-renders.

### Refreshing decorations when your own state changes (important)

`renderRowDecoration` is invoked during the Preact render of each visible row
(`renderDecorationForRow` is a `useCallback` keyed on the renderer identity). Because the renderer
closes over whatever you give it, it *can* read external mutable state (a `Set` of viewed paths, a
`Map` of comment counts). But **the tree does not know that state changed**, and there is **no
`refresh()` / `invalidate()` API** (see the exhaustive class declaration in section 0).

Re-renders of the mounted view happen when:

1. the controller emits (selection, focus, expansion, search, mutation, scroll request), or
2. one of these setters runs: `setComposition`, `setGitStatus`, `applyGitStatusPatch`, `setIcons`.

Of those setters, `setGitStatus` and `applyGitStatusPatch` **early-return when the content is
unchanged**, so they are not reliable refresh triggers. `setIcons` and `setComposition` have no
equality guard and always call `renderFileTreeRoot(...)`:

```ts
public setIcons(icons?: FileTreeOptions['icons']): void {
  this.#icons = icons;
  const mountedTree = this.#getMountedTreeElements();
  if (mountedTree == null) return;
  this.#syncIconSurface(mountedTree.host, mountedTree.wrapper);
  renderFileTreeRoot(mountedTree.wrapper, this.#getViewProps());     // unconditional
}
```

```ts
// Deliberately rerenders even when the same object reference is passed again.
// Callers can reuse one composition object while changing what its render
// callbacks return, so identity alone is not a reliable no-op signal.
public setComposition(composition?: FileTreeCompositionOptions): void { … }
```

**Recommended forced refresh — this is an inference from source, not a documented API. Mark it as
a risk in the implementation plan and pin the version.**

- **Vanilla:** `model.setComposition(model.getComposition())`.
- **React:** use `model.setIcons(currentIcons)` instead. `<FileTree>` owns `composition` and will
  overwrite it on its next layout effect; `icons` is not touched by the component. You must keep
  your own reference to the icon config, because there is no `getIcons()`.

Alternatively, drive decoration changes *through* a state the tree already tracks — e.g. if
"viewed" also implies a git-status change you were going to push anyway, `applyGitStatusPatch`
re-renders as a side effect.

### Upstream status

Two **open** issues confirm this is the current ceiling, not something I failed to find:

- `#498` *"Feature: Per-item render customization for @pierre/trees"* — asks for `renderItem` / an
  item slot; *"Current customization seems limited to styling and icons"*.
- `#691` *"Make Pierre trees more extensible with a headless core, pluggable row lanes, and richer
  renderer hooks"* — states plainly: *"Today the public extension surface around row rendering is
  still fairly narrow. It supports a header, a context menu composition surface, icons/theming, and
  a single decoration hook."* The multi-lane model (`leading | icon | content | status | trailing |
  action | overlay`) is a **proposal only**.

### The two composition surfaces that *do* take real DOM/React

`FileTreeCompositionOptions` gives you a header and a context menu — both rendered in the host's
**light DOM** and projected into named slots, so React can own them:

```ts
export interface FileTreeCompositionOptions {
  contextMenu?: FileTreeContextMenuCompositionOptions;
  header?: FileTreeHeaderCompositionOptions;
}

export interface FileTreeHeaderCompositionOptions {
  html?: string;
  render?: () => HTMLElement | null;
}

export interface FileTreeContextMenuItem { kind: 'directory' | 'file'; name: string; path: FileTreePublicId; }

export interface FileTreeContextMenuOpenContext {
  anchorElement: HTMLElement;
  anchorRect: ContextMenuAnchorRect;
  close: (options?: { restoreFocus?: boolean }) => void;
  restoreFocus: () => void;
}

export type FileTreeContextMenuTriggerMode = 'both' | 'button' | 'right-click';
export type FileTreeContextMenuButtonVisibility = 'always' | 'when-needed';

export interface FileTreeContextMenuCompositionOptions {
  enabled?: boolean;
  triggerMode?: FileTreeContextMenuTriggerMode;
  buttonVisibility?: FileTreeContextMenuButtonVisibility;
  onOpen?: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void;
  onClose?: () => void;
  render?: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => HTMLElement | null;
}
```

Slot names: `HEADER_SLOT_NAME = 'header'`, `CONTEXT_MENU_SLOT_NAME = 'context-menu'`. From React,
use the `header` and `renderContextMenu` props rather than `composition` directly.

Note the alias on the root export: `FileTreeContextMenuItem` is re-exported from `@pierre/trees`
as **`ContextMenuItem`**, `FileTreeContextMenuOpenContext` as **`ContextMenuOpenContext`**,
`FileTreeContextMenuTriggerMode` as **`ContextMenuTriggerMode`**,
`FileTreeContextMenuButtonVisibility` as **`ContextMenuButtonVisibility`**.
`FileTreeContextMenuCompositionOptions` is **not** re-exported from the root at all — import it
via the React component's prop types or restate it.

---

## F. Shadow DOM implications

### The boundary

`<file-tree-container>` (`FILE_TREE_TAG_NAME = 'file-tree-container'`) attaches an **open** shadow
root (`this.attachShadow({ mode: 'open' })`) and everything except the header/context-menu slot
content lives inside it.

Consequences:

- **Host page CSS selectors do not reach tree internals.** Your global stylesheet cannot target
  `[data-item-section="content"]` etc. `::part()` is not used anywhere in the source — I grepped
  `style.css` and `FileTreeView.tsx` and found no `part=` attributes. **There is no `::part`
  styling surface.**
- **CSS custom properties DO inherit through the shadow boundary.** This is the supported theming
  channel: set `--trees-*` vars on the host element (or any ancestor).
- `model.getFileTreeContainer(): HTMLElement | undefined` returns the host, and `host.shadowRoot`
  is accessible because the root is `open` — an escape hatch for measurement, not a supported API.

### Theming channels, in precedence order

The stylesheet uses the chain `--trees-<x>-override` -> `--trees-theme-<x>` -> built-in default
(stated in the `themeToTreeStyles` doc comment: *"The trees stylesheet uses --trees-theme-* in its
fallback chain (--trees-*-override → --trees-theme-* → default)"*).

**1. `--trees-*-override` properties (highest precedence).** Complete list extracted from
`src/style.css`:

```
--trees-accent-override                      --trees-item-margin-x-override
--trees-action-lane-width-override           --trees-item-padding-x-override
--trees-bg-muted-override                    --trees-item-row-gap-override
--trees-bg-override                          --trees-level-gap-override
--trees-border-color-override                --trees-padding-inline-override
--trees-border-radius-override               --trees-scrollbar-gutter-override
--trees-density-override                     --trees-scrollbar-thumb-override
--trees-fg-muted-override                    --trees-search-bg-override
--trees-fg-override                          --trees-search-fg-override
--trees-focus-ring-color-override            --trees-search-font-weight-override
--trees-focus-ring-offset-override           --trees-selected-bg-override
--trees-focus-ring-width-override            --trees-selected-fg-override
--trees-font-family-override                 --trees-selected-focused-border-color-override
--trees-font-size-override                   --trees-status-added-override
--trees-font-weight-regular-override         --trees-status-deleted-override
--trees-font-weight-semibold-override        --trees-status-ignored-override
--trees-gap-override                         --trees-status-modified-override
--trees-git-added-color-override             --trees-status-renamed-override
--trees-git-deleted-color-override           --trees-status-untracked-override
--trees-git-ignored-color-override           --trees-icon-nudge-override
--trees-git-lane-width-override              --trees-icon-width-override
--trees-git-modified-color-override          --trees-indent-guide-bg-override
--trees-git-renamed-color-override           --trees-input-bg-override
--trees-git-untracked-color-override
```

Non-`-override` vars also read by the sheet and settable from the host include
`--trees-item-height`, `--trees-row-height`, `--trees-scrollbar-gutter-measured`
(`FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY`), and the whole `--trees-file-icon-color-*` /
`--trees-icon-*` families for per-language icon colours.

**2. `themeToTreeStyles(theme)` — Shiki / VS Code themes.**

```ts
export type TreeThemeInput = ThemeLike;        // from @pierre/theming
export type TreeThemeStyles = Record<string, string>;
export function themeToTreeStyles(theme: TreeThemeInput): TreeThemeStyles;
```

Returns `colorScheme`, `backgroundColor`, `color`, `borderColor`, plus `--trees-theme-sidebar-bg`,
`--trees-theme-sidebar-fg`, `--trees-theme-sidebar-header-fg`,
`--trees-theme-list-active-selection-fg`, `--trees-theme-list-hover-bg`,
`--trees-theme-list-active-selection-bg`, `--trees-theme-focus-ring`, `--trees-theme-input-bg`,
and conditionally `--trees-theme-sidebar-border`, `--trees-theme-input-border`,
`--trees-theme-scrollbar-thumb`, `--trees-theme-git-added-fg`, `--trees-theme-git-modified-fg`,
`--trees-theme-git-deleted-fg`.

```tsx
const treeStyle = { height: 320, ...themeToTreeStyles(resolvedTheme) };
<FileTree model={model} style={treeStyle} />;
```

`recipe-theme.md`: *"Recalculate the styles when the resolved theme changes."*

**3. `unsafeCSS` — raw CSS injected into the shadow root.** Constructor option only
(`readonly #unsafeCSS`; **cannot be changed after construction**). It becomes a
`<style data-file-tree-unsafe-css>` element inside the shadow root (wrapped by `wrapUnsafeCSS`).
This is the only way to write real selectors against tree internals — e.g. to hide the built-in
search input, or restyle `[data-item-section="decoration"]`.

**4. Density vars** are painted onto the host by the React component automatically
(`--trees-item-height`, `--trees-density-override`), with caller `style` keys winning.

### Keyboard handling — read this before binding global j/k

The tree binds `onKeyDown` on its **root `<div role="tree">` inside the shadow root** *and* on each
row element (both call the same `handleTreeKeyDown`). Keyboard events are `composed`, so they do
retarget and bubble to `document` — **unless the tree calls `stopPropagation()`.**

**The problem: with `search: true`, any unmodified single letter or digit typed while the tree has
focus opens the search box and swallows the key.**

```ts
function isSearchOpenSeedKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    /^[\p{L}\p{N}]$/u.test(event.key) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}
```

```ts
if (searchEnabled && isSearchOpenSeedKey(event)) {
  controller.openSearch(event.key);
  setControllerRevision((revision) => revision + 1);
  event.preventDefault();
  event.stopPropagation();
  return;
}
```

So `j` and `k` (and every other letter/digit) **never reach a document-level listener** while tree
focus is active and `search: true`. Options:

1. Construct with `search: false` and render your own search UI driven by
   `setSearch`/`getSearchMatchingPaths`. With `searchEnabled === false` the seed-key branch is
   skipped and unrecognised keys fall through the handler with **no** `preventDefault`/
   `stopPropagation`, so they propagate to the host normally.
2. Keep `search: true` and accept that j/k inside the tree means "type into search". Bind your
   global j/k in the **capture** phase on `document` and check whether the event's composed path
   includes the tree host, so you can decide before the tree sees it.
3. Move j/k to a modifier combination — `isSearchOpenSeedKey` rejects anything with
   Ctrl/Meta/Alt.

Keys the tree consumes when it has focus (all with `preventDefault()` + `stopPropagation()` once
`handled` is true):

| Key | Action |
| --- | --- |
| `ArrowDown` / `ArrowUp` | `focusNextItem()` / `focusPreviousItem()` |
| `ArrowRight` | expand focused collapsed dir, else `focusNextItem()` |
| `ArrowLeft` | collapse focused expanded dir, else `focusParentItem()` |
| `Home` / `End` | `focusFirstItem()` / `focusLastItem()` |
| `Shift`+`ArrowDown`/`ArrowUp` | `extendSelectionFromFocused(±1)` |
| `Ctrl`/`Cmd`+`Space` | `toggleFocusedSelection()` |
| `Ctrl`/`Cmd`+`A` | `selectAllVisiblePaths()` |
| `Shift`+`F10` or `ContextMenu` | open row context menu (only when the context menu is enabled) |
| `F2` | start inline rename (only when `renaming` is enabled) |
| any letter/digit, no modifier | open search seeded with that character (only when `search: true`) |
| `Escape`/`Enter`/`ArrowDown`/`ArrowUp` while search open | close / select match / next match / prev match |
| `Escape`/`Enter` while renaming | cancel / commit |

Keys **not** handled (`handled = false`) return early **without** `preventDefault` or
`stopPropagation`, so they reach the host: `PageUp`, `PageDown`, `Tab`, `Delete`, `Backspace`,
plain `Enter` and plain `Space` outside search/rename, and any letter/digit when `search: false`.

**One document-level listener exists.** While a context menu is open, the view installs a
**capture-phase** `keydown` listener on `document` that eats `Escape`:

```ts
const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
  }
};
document.addEventListener('mousedown', onPointerDown, true);
document.addEventListener('keydown', onKeyDown, true);
```

It is added/removed with the context-menu lifecycle, so it only affects your global `Escape`
handling while a tree context menu is open. (There is also a non-capturing `keydown` listener on
the internal scroll element for `ArrowUp/Down/Left/Right/PageUp/PageDown/Home/End/Space` that only
flags "a scroll is imminent" — it does not preventDefault.)

The tree root is `tabIndex={-1}` with `role="tree"` and `outline: none`; rows carry the ARIA
tree-item attributes. Focus lives inside the shadow root, so `document.activeElement` on the host
page is the `<file-tree-container>` element — to find the real focused element you must walk
`host.shadowRoot.activeElement`.

---

## G. Custom sort / ordering, and programmatic expansion

### Sorting

```ts
export interface FileTreeSortEntry {
  basename: string;
  depth: number;
  isDirectory: boolean;
  path: FileTreePublicId;
  segments: readonly string[];
}

export type FileTreeSortComparator = (
  left: FileTreeSortEntry,
  right: FileTreeSortEntry
) => number;
```

Set through the constructor option `sort?: 'default' | FileTreeSortComparator`. Constructor-time
only — there is no `setSort`. To change ordering you must build a new model, or `resetPaths` with a
`preparedInput` produced under a different comparator.

To keep an order you already computed (e.g. GitHub's PR file order), skip sorting entirely:

```ts
export function prepareFileTreeInput(
  paths: readonly string[],
  options?: { flattenEmptyDirectories?: boolean; sort?: 'default' | FileTreeSortComparator }
): FileTreePreparedInput;

export function preparePresortedFileTreeInput(
  paths: readonly string[]
): FileTreePreparedInput;
```

`FileTreePreparedInput` is an opaque branded type (`readonly [FILE_TREE_PREPARED_INPUT]: true;
readonly paths: readonly string[]`). Comments: *"Precomputes normalized tree input so FileTree can
skip repeated parsing work"* and *"Marks already-sorted input so FileTree can skip both sorting and
reparsing work."* There is also a plain boolean constructor option `presorted?: boolean`.

Prepared input can be passed at construction (`preparedInput`) or to `resetPaths`:

```ts
resetPaths(paths: readonly FileTreePublicId[], options?: FileTreeResetOptions): void;
resetPaths(options: FileTreeResetPreparedOptions): void;

export type FileTreeResetOptions = { initialExpandedPaths?: readonly FileTreePublicId[]; preparedInput?: FileTreePreparedInput };
export type FileTreeResetPreparedOptions = { initialExpandedPaths?: readonly FileTreePublicId[]; preparedInput: FileTreePreparedInput };
```

*"Exactly one of `paths` or `preparedInput` is required."* The runtime discriminates with
`Array.isArray(pathsOrOptions)`.

### Expansion

Initial:

```ts
export type FileTreeInitialExpansion = 'closed' | 'open' | number;   // number = expand to depth N
initialExpansion?: FileTreeInitialExpansion;
initialExpandedPaths?: readonly FileTreePublicId[];
flattenEmptyDirectories?: boolean;   // collapses single-child folder chains into one row
```

**UNVERIFIED:** the precise meaning of the numeric `initialExpansion` (depth threshold vs. row
budget). The type comment in `api-core.md` says *"Selects closed, open, or depth-based initial
expansion"*, and the implementation lives in `@pierre/path-store`, which I did not read. Treat it
as "expand to depth N" with low confidence.

`flattenEmptyDirectories` produces flattened rows; those rows have `isFlattened: true`,
a `flattenedSegments` array, and their identifiers are prefixed with
`FLATTENED_PREFIX = 'f::'` (*"Example: 'f::src/utils/deep' represents the chain src → utils →
deep"*).

Programmatic, at runtime — **yes**, via the directory handle:

```ts
export interface FileTreeDirectoryHandle extends FileTreeItemHandleBase {
  collapse(): void;
  expand(): void;
  isDirectory(): true;
  isExpanded(): boolean;
  toggle(): void;
}
export interface FileTreeFileHandle extends FileTreeItemHandleBase { isDirectory(): false; }
export type FileTreeItemHandle = FileTreeDirectoryHandle | FileTreeFileHandle;
```

```ts
const item = model.getItem('src/');        // 'src' also works
if (item?.isDirectory()) item.expand();
```

Handles are memoised per canonical path (`#itemHandles` map) and delegate straight to the
controller, so holding one is fine.

**Expand-ancestors-then-scroll helper** (needed because `scrollToPath` no-ops on hidden rows,
section B). `FileTreeVisibleRow.ancestorPaths` gives you the chain for *visible* rows; for a hidden
target, derive it from the path yourself:

```ts
function revealPath(model: FileTree, path: string): void {
  const segments = path.split('/').filter(Boolean);
  let prefix = '';
  // every segment except the last (the file itself)
  for (let i = 0; i < segments.length - 1; i += 1) {
    prefix += `${segments[i]}/`;
    const dir = model.getItem(prefix);
    if (dir?.isDirectory() && !dir.isExpanded()) dir.expand();
  }
  model.scrollToPath(path, { focus: false, offset: 'nearest' });
}
```

**UNVERIFIED:** I did not execute this helper; it is composed from verified primitives
(`getItem`, `isDirectory`, `isExpanded`, `expand`, `scrollToPath`) but is not copied from library
source.

### Mutations and mutation events (adjacent, for completeness)

```ts
export interface FileTreeMutationHandle {
  add(path: FileTreePublicId): void;
  batch(operations: readonly FileTreeBatchOperation[]): void;
  move(fromPath: FileTreePublicId, toPath: FileTreePublicId, options?: FileTreeMoveOptions): void;
  onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void
  ): () => void;
  remove(path: FileTreePublicId, options?: FileTreeRemoveOptions): void;
  resetPaths(paths: readonly FileTreePublicId[], options?: FileTreeResetOptions): void;
  resetPaths(options: FileTreeResetPreparedOptions): void;
}

export type FileTreeCollisionStrategy = 'error' | 'replace' | 'skip';
export interface FileTreeMoveOptions   { collision?: FileTreeCollisionStrategy; }
export interface FileTreeRemoveOptions { recursive?: boolean; }

export type FileTreeBatchOperation =
  | { path: FileTreePublicId; type: 'add' }
  | ({ path: FileTreePublicId; type: 'remove' } & FileTreeRemoveOptions)
  | ({ from: FileTreePublicId; to: FileTreePublicId; type: 'move' } & FileTreeMoveOptions);

export type FileTreeMutationEventType = 'add' | 'remove' | 'move' | 'reset' | 'batch';
```

`onMutation` returns an unsubscribe function and accepts `'*'` for all events. Every event extends
`FileTreeMutationEventInvalidation` (`canonicalChanged`, `projectionChanged`,
`visibleCountDelta: number | null`).

Drag-and-drop and renaming, for reference:

```ts
export interface FileTreeDragAndDropConfig {
  canDrag?: (paths: readonly FileTreePublicId[]) => boolean;
  canDrop?: (event: FileTreeDropContext) => boolean;
  onDropComplete?: (event: FileTreeDropResult) => void;
  onDropError?: (error: string, event: FileTreeDropContext) => void;
  openOnDropDelay?: number;
}
export interface FileTreeRenamingConfig {
  canRename?: (item: FileTreeRenamingItem) => boolean;   // { isFolder: boolean; path: string }
  onError?: (error: string) => void;
  onRename?: (event: FileTreeRenameEvent) => void;       // { sourcePath, destinationPath, isFolder }
}
```

For a read-only PR file tree, leave `dragAndDrop` and `renaming` unset (both default off:
`#renamingEnabled = renaming != null && renaming !== false`), which also removes `F2` from the
consumed-key list in section F.

---

## Appendix: complete root export list

From the published `dist/index.d.ts`. Values: `FileTree`, `preloadFileTree`,
`serializeFileTreeSsrPayload`, `prepareFileTreeInput`, `preparePresortedFileTreeInput`,
`themeToTreeStyles`, `getBuiltInSpriteSheet`, `createFileTreeIconResolver`,
`FILE_TREE_TAG_NAME`, `FILE_TREE_STYLE_ATTRIBUTE`, `FILE_TREE_UNSAFE_CSS_ATTRIBUTE`,
`FILE_TREE_SCROLLBAR_MEASURE_ATTRIBUTE`, `FILE_TREE_SCROLLBAR_GUTTER_STYLE_ATTRIBUTE`,
`FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY`, `FILE_TREE_DEFAULT_ITEM_HEIGHT`,
`FILE_TREE_DENSITY_PRESETS`, `FLATTENED_PREFIX`, `HEADER_SLOT_NAME`, `CONTEXT_MENU_SLOT_NAME`,
`CONTEXT_MENU_TRIGGER_TYPE`.

Types (selection): `FileTreeOptions`, `FileTreeVisibleRow`, `FileTreeItemHandle`,
`FileTreeDirectoryHandle`, `FileTreeFileHandle`, `FileTreeSelectionChangeListener`,
`FileTreeRowDecoration`, `FileTreeRowDecorationContext`, `FileTreeRowDecorationRenderer`,
`GitStatus`, `GitStatusEntry`, `FileTreeGitStatusPatch`, `FileTreeSearchMode`,
`FileTreeSearchSessionHandle`, `FileTreeScrollToPathOptions`, `FileTreeScrollOffset`,
`FileTreeIcons`, `FileTreeIconConfig`, `RemappedIcon`, `TreeThemeInput`, `TreeThemeStyles`,
`ContextMenuItem`, `ContextMenuOpenContext`, `ContextMenuTriggerMode`,
`ContextMenuButtonVisibility`, and the full mutation/drag/rename/density/SSR type families.

**Not exported from the root:** `FileTreeContextMenuCompositionOptions`,
`FileTreeRowDecorationText`, `FileTreeRowDecorationIcon`, `FileTreeRowDecorationTextPart`,
`FileTreeItemHandleBase`, `FileTreeVisibleSegment`, `FileTreePublicId`,
`FileTreeControllerOptions`. (Several of these *are* exported from
`dist/model/publicTypes.d.ts`, but that path is not in `exports`, so they are effectively private —
restate them locally if you need them.)
