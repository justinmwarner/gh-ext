# `@pierre/diffs` — verified API reference

> **Provenance and trust rules for this document.**
> Everything below is copied from or directly traceable to real source. Where a
> claim could not be verified from source it is marked **UNVERIFIED** in bold.
> Do not treat anything unmarked as a guess — but also do not add API surface
> that is not in here without re-checking the source.

## Version and refs examined

| Item | Value |
| --- | --- |
| npm package | `@pierre/diffs` |
| npm `latest` version | **1.3.6** (`npm view @pierre/diffs version` → `1.3.6`; `time.modified = 2026-08-24T07:05:22Z`) |
| npm dist-tags | `latest: 1.3.6`, `rc: 1.3.0-rc.4`, `beta: 1.3.0-beta.11` |
| GitHub repo | `pierrecomputer/pierre` (Apache-2.0) |
| Repo HEAD read | `6ce4da89cb21f2afbe0b49823e014c659f9da9a9` — 2026-09-01T15:48:36Z — "Fat/editor decorations (#1103)" |
| Repo `packages/diffs/package.json` version | `1.3.6` (matches npm) |
| Peer deps | `react ^18.3.1 \|\| ^19.0.0`, `react-dom` (both **optional**) |
| Runtime deps | `@pierre/theme`, `@pierre/theming`, `@shikijs/transformers ^3\|\|^4`, `diff`, `hast-util-to-html`, `lru_map`, `shiki ^3.0.0 \|\| ^4.0.0` |

**Important caveat about repo-HEAD vs published 1.3.6.** The repo `main` branch is
ahead of npm 1.3.6 in the **edit-mode** surface only. Verified drift:

- `main` `DiffBasePropsReact` adds `editStateKey`, `onEditChange`, `onEditComplete`,
  and an `LCaret` type param. Published 1.3.6 `dist/react/types.d.ts` has **none** of these.
- `main` `CodeViewOptions.createEditor(documentKind, options, editStateKey)` vs
  published 1.3.6 `createEditor(options)`.
- `main` `CodeView` `onItemEditChange(event, item)` / `onItemEditComplete(event, item, nextItem)`
  vs published 1.3.6 `onItemEditChange(item, file, lineAnnotations?)`.
- `main` root/react entries also export `EditorFocusOptions`, `Marker`, `MarkerSeverity`;
  published 1.3.6 does not.

**Everything in sections A–G below that this project actually needs (rendering,
annotations, selection, worker, theming, expansion, virtualization) was verified
identical between repo `main` and published `1.3.6` `.d.ts` files.** Where a type is
edit-mode-adjacent it is called out.

## Sources actually read

Agent skill (`skills/diffs`, repo HEAD) — read in full:
- `skills/diffs/SKILL.md`
- `references/api-core.md`, `api-editor.md` (index only), `api-highlighting.md`,
  `api-react.md`, `api-rendering.md`, `api-ssr.md`, `api-types.md`, `api-worker.md`
- `references/recipe-annotations.md`, `recipe-code-view.md`, `recipe-custom-highlighting.md`,
  `recipe-react.md`, `recipe-ssr.md`, `recipe-vanilla.md`, `recipe-workers.md`

> Note: the `references/api-*.md` files are **export inventories with one-line
> descriptions, not signatures.** They were useful for discovery but every signature in
> this document came from TypeScript source or shipped `.d.ts`.

Package source (`packages/diffs/src`, repo HEAD):
- `types.ts` (1389 lines), `constants.ts`, `index.ts`, `style.css`
- `components/File.ts`, `components/FileDiff.ts` (3993 lines), `components/CodeView.ts`,
  `components/Virtualizer.ts`, `components/web-components.ts`
- `managers/InteractionManager.ts` (2510 lines)
- `renderers/DiffHunksRenderer.ts`
- `react/index.ts`, `react/types.ts`, `react/File.tsx`, `react/FileDiff.tsx`,
  `react/MultiFileDiff.tsx`, `react/PatchDiff.tsx`, `react/CodeView.tsx`,
  `react/Virtualizer.tsx`, `react/WorkerPoolContext.tsx`, `react/EditContext.tsx`,
  `react/constants.ts`, `react/utils/renderDiffChildren.tsx`,
  `react/utils/useFileDiffInstance.ts`
- `worker/index.ts`, `worker/types.ts`, `worker/worker.ts`, `worker/worker-portable.ts`,
  `worker/getOrCreateWorkerPoolSingleton.ts`
- `highlighter/shared_highlighter.ts`, `highlighter/languages/resolveLanguage.ts`
- `utils/`: `getLineAnnotationName.ts`, `createAnnotationElement.ts`,
  `createAnnotationWrapperNode.ts`, `annotationHelpers.ts`, `includesFileAnnotations.ts`,
  `areDiffLineAnnotationsEqual.ts`, `areLineAnnotationsEqual.ts`, `getSingularPatch.ts`,
  `parsePatchFiles.ts`, `parseDiffFromFile.ts`, `getDiffHunksRendererOptions.ts`,
  `createGutterUtilityElement.ts`, `isGutterUtilityPath.ts`, `isWorkerContext.ts`
- `tsdown.config.ts`, `README.md`, `package.json`

Published npm tarball `@pierre/diffs@1.3.6` (`npm pack`, extracted and inspected):
- `dist/types.d.ts`, `dist/react/*.d.ts`, `dist/managers/InteractionManager.d.ts`,
  `dist/components/CodeView.d.ts`, `dist/components/web-components.js`, `dist/style.js`
- `dist/worker/worker.js`, `dist/worker/worker-portable.js`, `dist/worker/wasm-B9ZqxnKj.js`,
  `dist/worker/WorkerPoolManager.js`

diffs.com docs site source (`apps/docs`, repo HEAD — this **is** the content served at
https://diffs.com/docs):
- `app/(diffs)/docs/{Overview,Installation,ReactAPI,CodeView,Virtualization,Styling,Theming,WorkerPool,CoreTypes}/content.mdx`
- `app/(diffs)/docs/{ReactAPI,CodeView,Styling,WorkerPool,CoreTypes}/constants.ts` (the runnable code samples)

WebSearch was used only to locate diffs.com; `WebFetch` is blocked, so the docs site was
read from its source in the repo instead (same content, higher fidelity).

---

# A. React usage

## Import path and exported components

`import { … } from '@pierre/diffs/react'` (source: `packages/diffs/src/react/index.ts`,
verified against published `dist/react/index.d.ts`).

| Component | Input it consumes |
| --- | --- |
| `PatchDiff` | **a raw unified-diff / patch string** (`patch: string`) |
| `MultiFileDiff` | **two file contents** (`oldFile` / `newFile` as `FileContents`) |
| `FileDiff` | **a pre-parsed `FileDiffMetadata`** |
| `File` | one `FileContents` (no diff) |
| `UnresolvedFile` | one file containing merge-conflict markers (beta) |
| `CodeView` | a virtualized list of `CodeViewItem[]` (files and/or diffs) in one scroll region |

Also exported: `Virtualizer`, `useVirtualizer`, `VirtualizerContext`,
`WorkerPoolContextProvider`, `useWorkerPool`, `WorkerPoolContext`, `EditProvider`,
`useCreateEditor`, `EditContext`, `useFileInstance`, `useFileDiffInstance`,
`useStableCallback`, `renderDiffChildren`, `renderFileChildren`, `templateRender`,
`noopRender`, `GutterUtilitySlotStyles`, `MergeConflictSlotStyles`.
The react entry also re-exports every type from the root `types` module.

**No CSS import is required.** Each surface renders into a `<diffs-container>` custom
element with an open shadow root; the stylesheet is a JS string adopted as a
`CSSStyleSheet`. Verified in `dist/components/web-components.js`:

```js
import style_default from "../style.js";
if (typeof HTMLElement !== "undefined" && customElements.get("diffs-container") == null) {
	let sheet;
	class FileDiffContainer extends HTMLElement {
		constructor() {
			super();
			if (this.shadowRoot != null) return;
			const shadowRoot = this.attachShadow({ mode: "open" });
			if (sheet == null) { sheet = new CSSStyleSheet(); sheet.replaceSync(style_default); }
			shadowRoot.adoptedStyleSheets = [sheet];
		}
		connectedCallback() { getMeasuredScrollbarGutter(this.shadowRoot ?? this.attachShadow({ mode: "open" })); }
	}
	customElements.define(DIFFS_TAG_NAME, FileDiffContainer);
}
```

`DIFFS_TAG_NAME = 'diffs-container'` (`src/constants.ts`). `package.json` marks
`dist/components/web-components.js` as the only `sideEffects` entry.

## Minimal working example: render a unified patch string

This is the real sample from the docs source
(`apps/docs/app/(diffs)/docs/ReactAPI/constants.ts` → `REACT_API_PATCH_DIFF`), verbatim:

```tsx
import type { FileDiffOptions } from '@pierre/diffs';
import { PatchDiff } from '@pierre/diffs/react';
import { useMemo } from 'react';

// PatchDiff renders from a unified diff/patch string.
// Use this when you have patch content (e.g., from git or GitHub).

const patch = `diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1,3 +1,3 @@
-console.log("Hello world");
+console.warn("Updated message");
`;

export function MyPatchDiff() {
  const fileDiffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      diffStyle: 'unified', // patches often look better unified
    }),
    []
  );

  return (
    <PatchDiff
      // Required: the patch/diff string
      patch={patch}

      options={fileDiffOptions}

      // See "Shared Props" tabs for all available props:
      // lineAnnotations, renderAnnotation, renderHeaderPrefix,
      // renderHeaderFilenameSuffix, renderHeaderMetadata,
      // renderGutterUtility, selectedLines, className, style, etc.
    />
  );
}
```

**`PatchDiff` accepts exactly one file's patch.** Source
(`src/utils/getSingularPatch.ts`, called by `PatchDiff` via `useMemo`):

```ts
export function getSingularPatch(patch: string): FileDiffMetadata {
  const parsedPatches = parsePatchFiles(patch);
  if (parsedPatches.length !== 1) {
    console.error(parsedPatches);
    throw new Error('PatchDiff: Provided patch must include only 1 patch, with 1 diff');
  }
  const { files } = parsedPatches[0];
  if (files.length !== 1) {
    console.error(files);
    throw new Error('FileDiff: Provided patch must contain exactly 1 file diff');
  }
  return files[0];
}
```

> For a GitHub PR (many files), do **not** feed the whole `.diff` to `PatchDiff`. Use
> `parsePatchFiles(patchText, cacheKeyPrefix?)` yourself and pass each
> `FileDiffMetadata` to `FileDiff`, or build `CodeViewItem[]` for `CodeView`.
> `PatchDiff` re-parses on every `patch` string change (`useMemo` on `patch`), so
> parsing once and using `FileDiff` is also the cheaper path.

## Parsing entry points (from `@pierre/diffs`, the root export)

```ts
// src/utils/parsePatchFiles.ts
export function parsePatchFiles(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch[];
// ParsedPatch = { patchMetadata?: string; files: FileDiffMetadata[] }

// src/utils/parseDiffFromFile.ts
export function parseDiffFromFile(
  oldFile: FileContents | null,
  newFile: FileContents | null,
  options?: CreatePatchOptionsNonabortable,
  throwOnError = false
): FileDiffMetadata;

// src/utils/getSingularPatch.ts
export function getSingularPatch(patch: string): FileDiffMetadata;
```

`parsePatchFiles` handles patches with or without commit metadata, and multiple commits
(it splits on `/(?=^From [a-f0-9]+ .+$)/m`). Also exported: `processPatch`, `processFile`,
`trimPatchContext`, `hydratePartialDiff`, `cloneFileDiffMetadata`, `setLanguageOverride`.

## Full React prop types

Verbatim from `src/react/types.ts` (repo HEAD). Lines marked `// main-only` are absent
from published 1.3.6 — see the drift note at the top.

```ts
export interface DiffBasePropsReact<LAnnotation, LCaret = undefined> {
  options?: FileDiffOptions<LAnnotation>;
  /** Whether this surface has an active edit session. */
  edit?: boolean;
  /** Creation-time options passed to the nearest EditProvider factory. */
  editorOptions?: EditorOptions<LAnnotation, LCaret>;
  /** Retain this editable draft and its undo/redo history in memory. */
  editStateKey?: string;                                             // main-only
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'diff'>): void; // main-only
  onEditComplete?: FileDiffEditCompleteHandler<LAnnotation>;          // main-only
  metrics?: VirtualFileMetrics;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderCustomHeader?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderPrefix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderFilenameSuffix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderMetadata?(fileDiff: FileDiffMetadata): ReactNode;
  renderGutterUtility?(
    getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined
  ): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}
```

Concrete component prop types (source `react/PatchDiff.tsx`, `react/MultiFileDiff.tsx`,
`react/FileDiff.tsx`):

```ts
export interface PatchDiffProps<LAnnotation> extends DiffBasePropsReact<LAnnotation> {
  patch: string;
  disableWorkerPool?: boolean;
}

export type MultiFileDiffProps<LAnnotation> =
  MultiFileDiffBaseProps<LAnnotation> & DiffFileInput;
// DiffFileInput =
//   | { oldFile: FileContents; newFile: FileContents }
//   | { oldFile: null;         newFile: FileContents }   // added file
//   | { oldFile: FileContents; newFile: null };          // deleted file

export interface FileDiffProps<LAnnotation, LCaret = undefined>
  extends DiffBasePropsReact<LAnnotation, LCaret> {
  fileDiff: FileDiffMetadata;
  disableWorkerPool?: boolean;
}
```

`FileProps` (for `File`) is the same shape with `file: FileContents`,
`lineAnnotations?: LineAnnotation<LAnnotation>[]` (no `side`), header callbacks receiving
`FileContents`, and `disableWorkerPool?: boolean`.

`FileOptions<LAnnotation>` / `FileDiffOptions<LAnnotation>` in React are the vanilla
class options minus React-owned callbacks:

```ts
type ReactOwnedEditCallbacks = 'onEditChange' | 'onEditComplete';
export type FileDiffOptions<LAnnotation> =
  Omit<FileDiffClassOptions<LAnnotation>, ReactOwnedEditCallbacks>;
export type FileOptions<LAnnotation> =
  Omit<FileClassOptions<LAnnotation>, ReactOwnedEditCallbacks>;
```

## Core data types

```ts
// src/types.ts
export interface FileContents {
  name: string;              // used for display AND language inference
  contents: string;
  lang?: SupportedLanguages; // explicit override; "generally you should not be setting this"
  header?: string;           // passed to jsdiff createTwoFilesPatch
  cacheKey?: string;         // identifies a file for worker-pool highlight caching
}
```

`FileDiffMetadata` (abridged to the fields a consumer touches; full definition in
`src/types.ts`):

```ts
export interface FileDiffMetadata {
  name: string;
  prevName?: string;            // set for renames/moves
  lang?: SupportedLanguages;
  newObjectId?: string;         // from patch `index` line
  prevObjectId?: string;
  type: ChangeTypes;            // 'change'|'rename-pure'|'rename-changed'|'new'|'deleted'
  hunks: Hunk[];
  splitLineCount: number;
  unifiedLineCount: number;
  isPartial: boolean;           // true when parsed from a patch (see section F)
  deletionLines: string[];      // OLD side. Full file when isPartial === false
  additionLines: string[];      // NEW side. Full file when isPartial === false
  cacheKey?: string;
}
```

> **Doc bug worth knowing:** `apps/docs/.../CoreTypes/constants.ts` documents
> `oldLines?: string[]` / `newLines?: string[]` on `FileDiffMetadata`. Those fields do
> **not** exist. The real names are `deletionLines` / `additionLines`. Trust `types.ts`.

## React rendering mechanics (why this matters for annotations)

`PatchDiff`/`MultiFileDiff`/`FileDiff` all render exactly this
(`react/PatchDiff.tsx`, identical in the siblings):

```tsx
return (
  <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
    {templateRender(children, prerenderedHTML)}
  </DIFFS_TAG_NAME>
);
```

`children` comes from `renderDiffChildren(...)`, which emits **light-DOM `<div slot="…">`
nodes**. The vanilla instance builds `<slot name="…">` placeholders inside the shadow
root. React content is therefore ordinary React, in ordinary light DOM, styled by
ordinary page CSS — it is only *positioned* by the shadow DOM.

React constructs the vanilla instance with `isContainerManaged = true`
(`new FileDiff(options, poolManager, true)` in `useFileDiffInstance.ts`), which makes the
vanilla `renderAnnotations()` DOM path a no-op and hands annotation rendering entirely to
React's slots.

---

# B. The annotation framework

## B.1 Exact annotation object shape

Verbatim from `src/types.ts` (identical in published `dist/types.d.ts` lines 390–417):

```ts
export type AnnotationSide = 'deletions' | 'additions';

type OptionalMetadata<T> = T extends undefined
  ? { metadata?: undefined }
  : { metadata: T };

/**
 * Annotation rendered for a file line. Use `lineNumber: 0` to render a
 * file-level annotation above the first rendered file line.
 */
export type LineAnnotation<T = undefined> = {
  lineNumber: number;
} & OptionalMetadata<T>;

/**
 * Annotation rendered for one side of a diff line. Use `lineNumber: 0` to
 * render a side-specific file-level annotation above the first hunk/separator.
 */
export type DiffLineAnnotation<T = undefined> = {
  side: AnnotationSide;
  lineNumber: number;
} & OptionalMetadata<T>;
```

That is the **entire** annotation object: `{ side, lineNumber, metadata }`. There is no
`id`, no `range`, no `endLine`, no `content`, no `type`. `metadata` is your own generic
payload — the library never reads inside it (see B.6 for the one exception: identity
comparison).

## B.2 How an annotation is anchored to a line

**By one-based line number on the named side, resolved at render time.** Not by hunk
offset, not by an internal id.

`DiffHunksRenderer.setLineAnnotations` buckets annotations into two maps keyed by line
number (`src/renderers/DiffHunksRenderer.ts`):

```ts
public setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void {
  this.additionAnnotations = {};
  this.deletionAnnotations = {};
  for (const annotation of lineAnnotations) {
    const map = ((): AnnotationLineMap<LAnnotation> => {
      switch (annotation.side) {
        case 'deletions': return this.deletionAnnotations;
        case 'additions': return this.additionAnnotations;
      }
    })();
    const arr = map[annotation.lineNumber] ?? [];
    map[annotation.lineNumber] = arr;
    arr.push(annotation);
  }
}
// export type AnnotationLineMap<LAnnotation> =
//   Record<number, DiffLineAnnotation<LAnnotation>[] | undefined>;
```

While walking rendered rows, the renderer looks up both sides for the current row and
emits an `AnnotationSpan`:

```ts
export interface AnnotationSpan {
  type: 'annotation';
  hunkIndex: number;
  lineIndex: number;
  annotations: string[];   // slot names, one entry per annotation on this row
}
```

The slot name is computed by an exported helper (`src/utils/getLineAnnotationName.ts`):

```ts
export function getLineAnnotationName<T = undefined>(
  annotation: LineAnnotation<T> | DiffLineAnnotation<T>
): string {
  return `annotation-${'side' in annotation ? `${annotation.side}-` : ''}${annotation.lineNumber}`;
}
// e.g. "annotation-additions-16", "annotation-deletions-9", "annotation-16" (File)
```

The shadow-DOM row is built from that span (`src/utils/createAnnotationElement.ts`):

```ts
export function createAnnotationElement(span: AnnotationSpan): HASTElement {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'div',
        children: span.annotations?.map((slotId) =>
          createHastElement({ tagName: 'slot', properties: { name: slotId } })
        ),
        properties: { 'data-annotation-content': '' },
      }),
    ],
    properties: { 'data-line-annotation': `${span.hunkIndex},${span.lineIndex}` },
  });
}
```

And React fills those slots (`src/react/utils/renderDiffChildren.tsx`):

```tsx
{renderAnnotation != null &&
  lineAnnotations?.map((annotation, index) => (
    <div key={index} slot={getAnnotationSlotName(annotation)}>
      {renderAnnotation(annotation)}
    </div>
  ))}
```

**Consequences you must design around:**

1. `side: 'deletions'` → line numbers in the **old file** (`deletionLines`).
   `side: 'additions'` → line numbers in the **new file** (`additionLines`). Both are
   one-based. This maps cleanly onto GitHub's `side: 'LEFT' | 'RIGHT'` and `line`.
2. An annotation whose line is **not currently rendered** (inside a collapsed context
   gap) produces **no row**. `getAnnotations(...)` is only called from inside the
   per-rendered-row loop; collapsed regions become separator rows with no annotation
   lookup. GitHub review threads on lines outside the visible hunks will silently not
   appear until context is expanded (see section F).
3. `lineNumber: 0` is reserved for file-level annotations. Constants
   (`src/utils/includesFileAnnotations.ts`):
   `FILE_ANNOTATION_LINE_NUMBER = 0`, `FILE_ANNOTATION_HUNK_INDEX = -1`,
   `FILE_ANNOTATION_LINE_INDEX = -1`. They render above the first hunk/separator, and
   in split view the deletions and additions file-level slot names are concatenated into
   one row (`pushFileLevelAnnotations`).

## B.3 LEFT vs RIGHT anchoring in split view — yes, natively

`getAnnotations` has two overloads. In `split` mode it returns **two spans**, one per
column; in `unified` mode both sides collapse into a single row
(`src/renderers/DiffHunksRenderer.ts`):

```ts
private getAnnotations(
  type: 'unified' | 'split',
  deletionLineNumber: number | undefined,
  additionLineNumber: number | undefined,
  hunkIndex: number,
  lineIndex: number
): AnnotationSpan | { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan } | undefined {
  const deletionSpan: AnnotationSpan = { type: 'annotation', hunkIndex, lineIndex, annotations: [] };
  if (deletionLineNumber != null) {
    for (const anno of this.deletionAnnotations[deletionLineNumber] ?? []) {
      deletionSpan.annotations.push(this.annotationSlotName(anno));
    }
  }
  const additionSpan: AnnotationSpan = { type: 'annotation', hunkIndex, lineIndex, annotations: [] };
  if (additionLineNumber != null) {
    for (const anno of this.additionAnnotations[additionLineNumber] ?? []) {
      (type === 'unified' ? deletionSpan : additionSpan).annotations.push(
        this.annotationSlotName(anno)
      );
    }
  }
  if (type === 'unified') {
    if (deletionSpan.annotations.length > 0) return deletionSpan;
    return undefined;
  }
  if (additionSpan.annotations.length === 0 && deletionSpan.annotations.length === 0) {
    return undefined;
  }
  return { deletionSpan, additionSpan };
}
```

Row-height parity across the two columns is managed by `ResizeManager` via
`ObservedAnnotationNodes` (`src/types.ts`):

```ts
export interface ObservedAnnotationNodes {
  type: 'annotations';
  column1: { container: HTMLElement; child: HTMLElement; childHeight: number };
  column2: { container: HTMLElement; child: HTMLElement; childHeight: number };
  currentHeight: number | 'auto';
}
```

So a left-side annotation and a right-side annotation on the same rendered row are
independently slotted and the row grows to the taller of the two. Switching
`options.diffStyle` between `'split'` and `'unified'` needs **no annotation data change**.

## B.4 Multi-line / line-range annotations — NOT supported natively

`DiffLineAnnotation` has exactly one `lineNumber`. There is no range field anywhere in the
annotation type, the `AnnotationLineMap`, the `AnnotationSpan`, or the slot-name helper.

The only range-shaped type in the library is `SelectedLineRange`, and it is used for
*selection*, not annotations.

**Workaround the library actually supports:** anchor the thread annotation to a single
line (GitHub's `line` — the end of the range) and put the range in your own `metadata`,
e.g. `metadata: { threadId, startLine, startSide, line, side }`. Your `renderAnnotation`
React node then displays "Lines 12–18". If you additionally want the source lines
*highlighted*, use controlled `selectedLines` (section C) or `unsafeCSS` targeting
`[data-line]` / `[data-line-index]` attributes (section E). This is a design constraint
to plan around, not a bug.

## B.5 Annotation content — arbitrary React nodes, in light DOM

React: `renderAnnotation?(annotation: DiffLineAnnotation<LAnnotation>): ReactNode`.
Any React tree. It is rendered into a light-DOM `<div slot="annotation-…">` and projected
into the shadow row, so page CSS, portals, context, event handlers, and third-party
components all work normally. The docs say this explicitly
(`apps/docs/.../ReactAPI/constants.ts`):

```tsx
  // Render function for each annotation. Despite the diff being
  // rendered in shadow DOM, annotations use slots so you can use
  // normal CSS and styling.
  renderAnnotation={(annotation) => (
    <CommentThread threadId={annotation.metadata.threadId} />
  )}
```

Vanilla (non-React) signature is DOM-node based, not string/HTML:

```ts
// src/components/FileDiff.ts — FileDiffOptions
renderAnnotation?(annotation: DiffLineAnnotation<LAnnotation>): HTMLElement | undefined;
```

Returning `null`/`undefined` from the vanilla renderer skips that annotation entirely
(`if (content == null) { continue; }` in `FileDiff.renderAnnotations`).

## B.6 Dynamic add / remove / update after mount — yes

React: pass a new `lineAnnotations` array. Reconciliation is per-annotation.

- Vanilla identity check (`src/utils/areDiffLineAnnotationsEqual.ts`):

```ts
export function areDiffLineAnnotationsEqual<LAnnotation = undefined>(
  annotationA: DiffLineAnnotation<LAnnotation>,
  annotationB: DiffLineAnnotation<LAnnotation>
): boolean {
  return (
    annotationA.lineNumber === annotationB.lineNumber &&
    annotationA.side === annotationB.side &&
    annotationA.metadata === annotationB.metadata   // reference equality!
  );
}
```

  **`metadata` is compared by reference.** Memoize your metadata objects or the vanilla
  layer treats every render as a changed annotation (it removes and rebuilds the wrapper
  node). In the React path the wrapper is React-owned, but a changed `lineAnnotations`
  array identity still forces `canPartiallyRender()` to return `false` and triggers a
  full diff re-render:

```ts
private canPartiallyRender(forceRender, annotationsChanged, didContentChange): boolean {
  if (forceRender || annotationsChanged || didContentChange ||
      typeof this.options.hunkSeparators === 'function') { return false; }
  return true;
}
```

  So: keep the array reference stable when nothing changed. The docs repeat this
  ("Keep the same array reference until the annotations change").

- Imperative API on the vanilla instance (also reachable via `CodeViewHandle.getInstance()`
  or `useFileDiffInstance`): `setLineAnnotations(annotations)`.
  From the skill's `api-core.md` `File`/`FileDiff` member tables and confirmed in
  `src/components/FileDiff.ts`:

```ts
public setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void
```

- `CodeView`: annotations live on the item (`CodeViewFileItem.annotations` /
  `CodeViewDiffItem.annotations`) and **you must bump `item.version`** when they change:

```ts
export type CodeViewDiffItem<T = undefined> = {
  id: string;
  type: 'diff';
  fileDiff: FileDiffMetadata;
  annotations?: DiffLineAnnotation<T>[];
  version?: number;
  collapsed?: boolean;
  edit?: boolean;
};
```

## B.7 Multiple annotations on the same (side, line)

Supported. `AnnotationLineMap` values are arrays, `AnnotationSpan.annotations` is a
`string[]`, and React emits one `<div slot=…>` per annotation. Because same-line
annotations produce the *same* slot name, all of their light-DOM divs are assigned to the
first matching `<slot>` and stack inside one annotation row. The docs confirm the intent:
"Multiple annotations can target the same side/line."

For GitHub review threads this is the natural mapping: one annotation per thread, several
threads can share a line and stack.

## B.8 Recommended mapping: GitHub review thread → `DiffLineAnnotation`

```ts
// GitHub PR review comment: { path, line, start_line?, side: 'LEFT'|'RIGHT',
//                             start_side?, original_line, in_reply_to_id, ... }
type ThreadMetadata = {
  threadId: string;
  startLine?: number;         // library cannot anchor a range; keep it here
  startSide?: 'LEFT' | 'RIGHT';
  comments: GitHubComment[];
};

const annotation: DiffLineAnnotation<ThreadMetadata> = {
  side: comment.side === 'LEFT' ? 'deletions' : 'additions',
  lineNumber: comment.line,   // one-based, on that side
  metadata: threadMetadataMemoizedByThreadId,
};
```

Group annotations per file, one `FileDiff` (or `CodeViewDiffItem`) per changed file.

---

# C. Line selection

## C.1 The payload type

```ts
// src/types.ts (identical in published dist/types.d.ts:390-397)
export type SelectionSide = 'deletions' | 'additions';

export interface SelectedLineRange {
  start: number;
  side?: SelectionSide;
  end: number;
  endSide?: SelectionSide;
}
```

Semantics verified in `InteractionManager.buildSelectionRange`:

```ts
private buildSelectionRange(
  start: number, end: number, side?: SelectionSide, endSide?: SelectionSide
): SelectedLineRange {
  return {
    start,
    end,
    ...(side != null ? { side } : {}),
    ...(side !== endSide && endSide != null ? { endSide } : {}),
  };
}
```

- **`start` is the drag anchor and `end` is the drag head — `start` can be greater than
  `end`.** The source comment is explicit: *"Selection ranges preserve drag direction, so
  compare rendered row indexes to find the visually top-most and bottom-most endpoints."*
  Normalize yourself before building a GitHub comment.
- `endSide` is **omitted when it equals `side`**. Always read it as
  `range.endSide ?? range.side` (this is exactly what the library does in
  `selectionEnds()` and `getIndexesFromSelection()`).
- `side` is `undefined` in `File` (single-file) mode; it is set in diff mode.
- A cross-side drag in split view is representable (`side: 'deletions'`,
  `endSide: 'additions'`) — GitHub cannot express that, so reject or clamp such ranges.

## C.2 The callbacks — exact names and signatures

Verbatim from `src/managers/InteractionManager.ts` (identical in published
`dist/managers/InteractionManager.d.ts:42-62`). These are `options` fields on
`FileOptions` / `FileDiffOptions` / `CodeViewOptions` (all three extend
`InteractionManagerBaseOptions`):

```ts
export interface InteractionManagerBaseOptions<TMode extends InteractionManagerMode> {
  lineHoverHighlight?: 'disabled' | 'both' | 'number' | 'line';
  enableTokenInteractionsOnWhitespace?: boolean;
  enableGutterUtility?: boolean;
  onGutterUtilityClick?(range: SelectedLineRange): unknown;
  onLineClick?(props: EventClickProps<TMode>): unknown;
  onLineNumberClick?(props: EventClickProps<TMode>): unknown;
  onLineEnter?(props: PointerEventEnterLeaveProps<TMode>): unknown;
  onLineLeave?(props: PointerEventEnterLeaveProps<TMode>): unknown;
  onTokenClick?(props: OnTokenEventProps<TMode>, event: MouseEvent): unknown;
  onTokenEnter?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  onTokenLeave?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  __debugPointerEvents?: LogTypes;
  enableLineSelection?: boolean;
  controlledSelection?: boolean;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  onLineSelectionStart?: (range: SelectedLineRange | null) => void;
  onLineSelectionChange?: (range: SelectedLineRange | null) => void;
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void;
  getLineIndex?: GetLineIndexUtility;
}
```

Firing order, verified against the pointer state machine
(`startLineSelectionFromPointerDown`, `handleDocumentPointerMove`,
`handleDocumentPointerUp`) and matching the docs' own comments:

| Callback | Fires |
| --- | --- |
| `onLineSelectionStart(range)` | on pointer **down** (after the first range is built) |
| `onLineSelectionChange(range)` | while dragging, whenever the range actually changes (not the initial down) |
| `onLineSelectionEnd(range)` | on pointer **up** |
| `onLineSelected(range)` | on pointer **up**, with the final range (or `null` on deselect) |

`onLineSelectionEnd` and `onLineSelected` fire back to back at pointer-up
(`this.notifySelectionEnd(...); this.notifySelectionCommitted(...);`). Use **either**, not
both, to open a composer.

## C.3 The critical UX constraint: drags start in the line-number gutter only

`startLineSelectionFromPointerDown` resolves the pointer target with
`requireNumberColumn: true`:

```ts
private startLineSelectionFromPointerDown(event: PointerEvent): void {
  const { enableLineSelection = false } = this.options;
  if (!enableLineSelection) { return; }
  const pointerInfo = this.resolveSelectionInfo(event, {
    source: 'event-path',
    requireNumberColumn: true,
  });
  if (pointerInfo == null) { return; }
  …
}
```

and `selectionInfoFromPath` bails when `requireNumberColumn && !target.numberColumn`.

Therefore:
- Clicking/dragging on **code content** does **not** start a selection.
- `disableLineNumbers: true` removes the number column, so line selection becomes
  unreachable. **UNVERIFIED** whether any other affordance exists in that configuration —
  none was found in the source.
- Shift-click extends an existing selection from the far endpoint
  (`if (event.shiftKey && this.selectedRange != null) { … }`).
- Clicking an already-single-selected line enters `pendingSingleLineUnselect` and
  deselects on pointer-up unless you drag.

## C.4 The GitHub-style "+" gutter button — `onGutterUtilityClick`

This is the closer match to GitHub's comment affordance, and the docs call it the
preferred API.

```ts
enableGutterUtility?: boolean;                             // default false — REQUIRED to show anything
onGutterUtilityClick?(range: SelectedLineRange): unknown;  // built-in "+" button
renderGutterUtility?(getHoveredLine): HTMLElement | ReactNode;  // custom content instead
```

Behaviour verified in source and matching the docs' comments verbatim:

```
  // Preferred: built-in gutter utility button (+)
  // No render callback needed; callback receives a SelectedLineRange.
  // Callback does not control visibility; options.enableGutterUtility does.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection lifecycle callbacks also fire for a gutter utility gesture,
  // even when line selection is disabled.
  onGutterUtilityClick(range: SelectedLineRange) {
    console.log(range.start, range.end, range.side, range.endSide);
  },
```

Source confirmation of "drag from the + button" and ordering
(`handleDocumentPointerUp`, `gutterSelecting` case):

```ts
const completedRange = this.buildSelectedLineRange(session.anchor, session.current);
onGutterUtilityClick?.({ ...completedRange });
this.selectionAnchor = undefined;
this.notifySelectionEnd(completedRange);
this.notifySelectionCommitted(completedRange);
```

The built-in button is `<button data-utility-button type="button"><svg …plus…/></button>`
(`src/utils/createGutterUtilityElement.ts`).

**Hard constraint:** you may use `onGutterUtilityClick` **or** `renderGutterUtility`, never
both — it throws at option-plucking time:

```ts
if (onGutterUtilityClick != null && renderGutterUtility != null) {
  throw new Error(
    "Cannot use both 'onGutterUtilityClick' and 'renderGutterUtility'. Use only one gutter utility API."
  );
}
```

Also from the docs: `renderGutterUtility` combined with `hunkSeparators: 'line-info'`
(the default) triggers a WebKit 26 scroll-jump bug
(https://bugs.webkit.org/show_bug.cgi?id=308027); use `enableGutterUtility` +
`onGutterUtilityClick`, or `hunkSeparators: 'line-info-basic'`. (Chrome-only extension →
low risk, but noted.)

`renderGutterUtility` is **not reactive** — it is called once, not per mouse move. Read the
hovered line inside the click handler:

```ts
export type GetHoveredLineResult<TMode extends InteractionManagerMode> =
  TMode extends 'file'
    ? { lineNumber: number }
    : { lineNumber: number; side: AnnotationSide };
```

## C.5 Controlled vs uncontrolled selection

In React, **passing `selectedLines` at all (including `null`) makes selection controlled.**
From `src/react/utils/useFileDiffInstance.ts`:

```ts
const controlledSelection = selectedLines !== undefined;
…
if (selectedLines !== undefined) {
  instance.setSelectedLines(selectedLines);
}
```

`controlledSelection: true` makes `InteractionManager` write to `proposedSelectedRange`
instead of committing `selectedRange`, so the highlight only moves when you echo the new
range back through the prop. Omit `selectedLines` entirely for uncontrolled behaviour.

Imperative form on the vanilla instance:

```ts
setSelectedLines: (
  range: { start: number; end: number } | null,
  options?: { notify?: boolean; activeLineSide?: SelectionSide; lineNumberOnly?: boolean }
) => void;
```

(`SelectionWriteOptions`: `activeLineSide` limits the highlight to one column of a split
diff; `lineNumberOnly` highlights only the gutter cell.)

## C.6 Per-line click events (if you want a click target other than the gutter)

```ts
export interface LineEventBaseProps {
  type: 'line';
  lineNumber: number;
  lineElement: HTMLElement;
  numberElement: HTMLElement;
  numberColumn: boolean;         // true when the pointer was in the gutter
}

export interface DiffLineEventBaseProps extends Omit<LineEventBaseProps, 'type'> {
  type: 'diff-line';
  annotationSide: AnnotationSide;   // <-- NOT `side`
  lineType: LineTypes;              // 'change-deletion'|'change-addition'|'context'|'context-expanded'
}

export interface OnDiffLineClickProps extends DiffLineEventBaseProps { event: PointerEvent }
```

> **Doc bug:** the diffs.com samples write `onLineClick({ lineNumber, side, event })`.
> The real field on diff-line events is **`annotationSide`**, verified in `types.ts`,
> in `InteractionManager.toEventBaseProps`, and in published `dist/types.d.ts:526-530`.
> (Token events *do* use `side`: `DiffTokenEventBaseProps extends TokenEventBase { side: AnnotationSide }`.)

`onLineNumberClick` fires instead of `onLineClick` when the pointer was in the number
column (`if (onLineNumberClick != null && target.numberColumn) { … } else if (onLineClick != null) { … }`).

## C.7 `CodeView` selection (viewer-wide, item-scoped)

```ts
// src/components/CodeView.ts
export interface CodeViewLineSelection {
  id: string;                 // CodeViewItem.id
  range: SelectedLineRange;
}

// CodeViewOptions
controlledSelection?: boolean;
onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
```

React props: `selectedLines?: CodeViewLineSelection | null` and
`onSelectedLinesChange?(selection)`. Selection is viewer-wide: selecting in one item
clears it in every other item.

`CodeView` also re-exposes the per-line callbacks with an extra trailing `context`
argument identifying which item fired. The wrapped keys are listed literally in the source:

```ts
const CODE_VIEW_SHARED_CALLBACK_KEYS = [
  'renderCustomHeader', 'renderHeaderPrefix', 'renderHeaderFilenameSuffix',
  'renderHeaderMetadata', 'renderAnnotation', 'renderGutterUtility', 'onPostRender',
  'onGutterUtilityClick', 'onLineClick', 'onLineNumberClick', 'onLineEnter', 'onLineLeave',
  'onTokenClick', 'onTokenEnter', 'onTokenLeave',
] as const;

const CODE_VIEW_SELECTION_CALLBACK_KEYS = [
  'onLineSelected', 'onLineSelectionStart', 'onLineSelectionChange', 'onLineSelectionEnd',
] as const;
```

The `context` is `CodeViewFileItemContext | CodeViewDiffItemContext`:

```ts
interface CodeViewDiffItemContext<LAnnotation> extends AdvancedVirtualizedBaseItem {
  type: 'diff';
  item: CodeViewDiffItem<LAnnotation>;
  instance: VirtualizedFileDiff<LAnnotation>;
}
// AdvancedVirtualizedBaseItem: { index, top, height, element, version, renderedOptionsRevision }
```

So for a multi-file PR surface: `onGutterUtilityClick(range, context)` gives you
`context.item.id` → file path, plus the range → the GitHub comment target. That is the
complete composer trigger.

## C.8 Recommended composer wiring for this project

```tsx
<FileDiff
  fileDiff={fileDiff}
  lineAnnotations={annotations}
  renderAnnotation={renderThread}
  selectedLines={selection}                 // controlled
  options={{
    enableLineSelection: true,
    enableGutterUtility: true,              // shows the built-in "+"
    onGutterUtilityClick(range) {           // click => 1 line, drag => range
      openComposer(normalize(range));
    },
    onLineSelectionChange(range) {          // keep the controlled highlight in sync
      setSelection(range);
    },
  }}
/>
```

`normalize(range)` must: swap when `start > end`, resolve `endSide ?? side`, and reject a
mixed-side range (GitHub cannot express one).

---

# D. The worker export (off-main-thread Shiki)

> The diffs.com WorkerPool page is explicitly banner-flagged:
> *"This feature is experimental and undergoing active development. There may be bugs and
> the API is subject to change."*

## D.1 Exports

```ts
// src/worker/index.ts
export * from './WorkerPoolManager';        // class WorkerPoolManager
export * from './getOrCreateWorkerPoolSingleton';
export * from './types';
```

```ts
// src/worker/getOrCreateWorkerPoolSingleton.ts — verbatim
let workerPoolSingleton: WorkerPoolManager | undefined;

export interface SetupWorkerPoolProps {
  poolOptions: WorkerPoolOptions;
  highlighterOptions: WorkerInitializationRenderOptions;
}

export function getOrCreateWorkerPoolSingleton({
  poolOptions, highlighterOptions,
}: SetupWorkerPoolProps): WorkerPoolManager {
  workerPoolSingleton ??= new WorkerPoolManager(poolOptions, highlighterOptions);
  return workerPoolSingleton;
}

export function terminateWorkerPoolSingleton(): void {
  if (workerPoolSingleton == null) { return; }
  workerPoolSingleton.terminate();
  workerPoolSingleton = undefined;
}
```

```ts
// src/worker/types.ts — verbatim
export interface WorkerPoolOptions {
  /** Factory function that creates a new Web Worker instance for the pool.
   *  This is called once per worker in the pool during initialization. */
  workerFactory: () => Worker;
  /** Number of workers to create in the pool. @default 8 */
  poolSize?: number;
  /** Maximum time to wait for the worker pool to initialize, in milliseconds. @default 10000 */
  workerInitializationTimeout?: number;
  totalASTLRUCacheSize?: number;
}

export interface WorkerInitializationRenderOptions extends Partial<WorkerRenderingOptions> {
  langs?: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;   // 'shiki-js' | 'shiki-wasm'
}

export interface WorkerRenderingOptions {
  theme: DiffsThemeNames | ThemesType;
  useTokenTransformer: boolean;
  tokenizeMaxLineLength: number;
  lineDiffType: LineDiffTypes;
  maxLineDiffLength: number;
}
```

## D.2 React setup

`src/react/WorkerPoolContext.tsx` — verbatim:

```tsx
export const WorkerPoolContext: Context<WorkerPoolManager | undefined> =
  createContext<WorkerPoolManager | undefined>(undefined);

interface WorkerPoolContextProps extends SetupWorkerPoolProps { children: ReactNode }

export function WorkerPoolContextProvider({ children, poolOptions, highlighterOptions }) {
  const [poolManager] = useState(() => {
    if (typeof window === 'undefined') { return undefined; }
    return getOrCreateWorkerPoolSingleton({ poolOptions, highlighterOptions });
  });
  useInsertionEffect(() => { /* refcount */ }, [poolManager]);
  useEffect(() => () => { if (instanceCount === 0) terminateWorkerPoolSingleton(); }, []);
  return <WorkerPoolContext.Provider value={poolManager}>{children}</WorkerPoolContext.Provider>;
}

export function useWorkerPool(): WorkerPoolManager | undefined { return useContext(WorkerPoolContext); }
```

Usage (skill `recipe-workers.md`, verbatim):

```tsx
import { WorkerPoolContextProvider } from '@pierre/diffs/react';

<WorkerPoolContextProvider
  poolOptions={{
    poolSize: 4,
    workerFactory: () =>
      new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
        type: 'module',
      }),
  }}
  highlighterOptions={{
    langs: ['typescript', 'tsx'],
    theme: { light: 'pierre-light', dark: 'pierre-dark' },
  }}
>
  {children}
</WorkerPoolContextProvider>;
```

Any `File` / `FileDiff` / `CodeView` under the provider picks up the pool automatically.
Opt an individual surface out with `disableWorkerPool`.

**When a pool is active, `theme`, `lineDiffType`, `tokenizeMaxLineLength`, and
`useTokenTransformer` on individual components are ignored** — the pool owns them. Change
them at runtime with `useWorkerPool()?.setRenderOptions(...)` (this clears the render cache
and forces mounted components to re-render).

`WorkerPoolManager` public members (from skill `api-worker.md`, cross-checked against
`dist/worker/WorkerPoolManager.js`): `initialize(languages?)`, `isInitialized()`,
`isWorkingPool()`, `setRenderOptions(options)`, `getFileRenderOptions()`,
`getDiffRenderOptions()`, `highlightFileAST(instance, file)`,
`highlightDiffAST(instance, diff)`, `primeFileHighlightCache(file)`,
`primeDiffHighlightCache(diff)`, `getFileResultCache(file)`, `getDiffResultCache(diff)`,
`getPlainFileAST(...)`, `getPlainDiffAST(...)`, `inspectCaches()`,
`evictFileFromCache(cacheKey)`, `evictDiffFromCache(cacheKey)`,
`subscribeToThemeChanges(instance)`, `unsubscribeToThemeChanges(instance)`,
`subscribeToStatChanges(callback)`, `cleanUpTasks(instance)`, `getStats()`, `terminate()`.

## D.3 The two worker script entries — this is the decisive fact for MV3

Package exports:

```json
"./worker/worker.js":          { "types": "./dist/worker/worker.d.ts",          "import": "./dist/worker/worker.js" },
"./worker/worker-portable.js": { "types": "./dist/worker/worker-portable.d.ts", "import": "./dist/worker/worker-portable.js" }
```

Build config (`tsdown.config.ts`) builds them differently — `worker-portable` is
`unbundle: false, noExternal: [/.*/], format: 'esm', treeshake: false`.

**Facts verified by inspecting the published `@pierre/diffs@1.3.6` tarball:**

| File | Size | Top-level static `import` | Top-level `export` | `import.meta` | `eval` / `new Function` |
| --- | --- | --- | --- | --- | --- |
| `dist/worker/worker.js` | 60 KB | **7** (`shiki/core`, `shiki/engine/javascript`, `shiki/engine/oniguruma`, `@pierre/theming`, `diff`, `@shikijs/transformers`, `@pierre/theming/color`) | 0 | 0 | 0 |
| `dist/worker/worker-portable.js` | 452 KB | **0** | **0** | **0** | **0** |
| `dist/worker/wasm-B9ZqxnKj.js` | 622 KB | — | — | — | `Uint8Array.from(atob("AGFzbQ…"))` — embedded WASM |

- `worker.js` has **bare-specifier imports**, so it must be processed by a bundler
  (or an import map). This is what the Vite/webpack/esbuild examples do.
- `worker-portable.js` is **fully self-contained**: zero static imports, zero exports, no
  `import.meta`. It can be shipped as a static asset and loaded directly. Its only dynamic
  import is the WASM chunk, and only on the `shiki-wasm` branch:

```js
// dist/worker/worker-portable.js:13593
engine: preferredHighlighter === "shiki-wasm"
  ? createOnigurumaEngine(import("./wasm-B9ZqxnKj.js"))
  : createJavaScriptRegexEngine()
```

- A grep of the whole `dist/` tree for `\beval\(|new Function\(` returned **zero matches**
  — including `worker-portable.js`, which has all of Shiki's JS regex engine bundled into
  it. So the default (`shiki-js`) code path uses **no `eval`, no `new Function`, and no
  WebAssembly**.

The worker protocol itself (`src/worker/worker.ts`) is plain `postMessage`:

```ts
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handleMessage(event.data);
});
// request types: 'initialize' | 'set-render-options' | 'file' | 'diff'
```

`WorkerPoolManager.js` contains **no** `new Worker(` and **no** `URL.createObjectURL` — it
only calls your `workerFactory`. All worker-creation policy is yours.

## D.4 Language grammars are resolved on the MAIN thread

`src/highlighter/languages/resolveLanguage.ts` — verbatim guard:

```ts
export async function resolveLanguage(lang) {
  // Prevent dynamic imports in worker contexts
  if (isWorkerContext()) {
    throw new Error(
      `resolveLanguage("${lang}") cannot be called from a worker context. ` +
        'Languages must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.'
    );
  }
  let loader = RegisteredCustomLanguages.get(lang);
  if (loader == null && Object.prototype.hasOwnProperty.call(bundledLanguages, lang)) {
    loader = bundledLanguages[lang as BundledLanguage];
  }
  …
}
```

`bundledLanguages` is Shiki's full map of ~200 lazy `() => import(...)` grammar loaders.
`WorkerPoolManager` resolves grammars on the main thread and posts the resolved JSON
across (`resolvedLanguages` on `InitializeWorkerRequest` / `RenderFileRequest` /
`RenderDiffRequest`):

```js
// dist/worker/WorkerPoolManager.js
if (hasResolvedLanguages(languages)) resolvedLanguages = getResolvedLanguages(languages);
else resolvedLanguages = await resolveLanguages(languages);
```

**Bundling consequence for an extension:** the main-thread bundle drags in Shiki's grammar
loader map, so your bundler will emit ~200 lazily-imported grammar chunks. Mitigation:
pre-declare a small `langs` allowlist on `highlighterOptions`, and/or register only the
grammars you need with `registerCustomLanguage(name, loader, extensions)` — but note that
`bundledLanguages` is still statically imported by `resolveLanguage.ts`, so the loader map
is always in the graph. **UNVERIFIED** whether a bundler can tree-shake the unreferenced
grammar chunks; measure it.

## D.5 Chrome MV3 viability

**Verified from the library's own source/dist (safe to rely on):**

1. `worker-portable.js` is a single self-contained file with no bare imports, no
   `import.meta`, no exports, no `eval`, no `new Function`. It can be copied into the
   extension package and loaded from a `chrome-extension://` URL directly — **no bundler
   worker plugin required, and no `new Worker(new URL(...), import.meta.url)` pattern
   required.**
2. The default engine is `shiki-js` (`preferredHighlighter = 'shiki-js'` in both
   `src/worker/worker.ts` `getHighlighter()` and `src/highlighter/shared_highlighter.ts`
   `getSharedHighlighter()`), which is `createJavaScriptRegexEngine()` — **no WebAssembly
   is loaded or instantiated.** Only opting into `'shiki-wasm'` pulls the 622 KB WASM
   chunk.
3. `WorkerPoolManager` never constructs a worker itself and never uses `createObjectURL`;
   the URL/policy is 100% yours via `workerFactory`.
4. The library's `dist/` contains no `eval` / `new Function` anywhere.

**Chrome-platform reasoning — NOT verified against pierre sources, and not tested here.
Treat as a hypothesis to confirm empirically before committing to the design:**

- MV3 extension **pages** (options page, side panel, popup, an extension-owned iframe)
  run at a `chrome-extension://<id>/` origin under the default MV3 CSP
  `script-src 'self'; object-src 'self'`. A worker whose URL is
  `chrome.runtime.getURL('worker-portable.js')` is same-origin and should satisfy
  `'self'`. Recommended factory:

  ```ts
  const workerFactory = (): Worker =>
    new Worker(chrome.runtime.getURL('vendor/pierre-diffs/worker-portable.js'), {
      type: 'module',
    });
  ```

  (`type: 'module'` is safe because the file is valid as either a module or a classic
  script — it has no top-level import/export. `type: 'module'` is required if you ever
  enable `shiki-wasm`, because of the dynamic `import()`.)
- **`blob:` workers are the risky pattern under MV3.** The VS Code webview recipe in the
  diffs.com docs fetches the worker text and does
  `URL.createObjectURL(new Blob([workerCode]))`. Do **not** copy that recipe for MV3 —
  `worker-src`/`child-src` falls back to `script-src 'self'`, which does not include
  `blob:`. Use `chrome.runtime.getURL` instead.
- **`new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url))` is the risky
  bundler pattern.** It only works when the bundler emits an ESM chunk and rewrites the
  URL; Vite's `worker.format` default and content-script IIFE builds either fail or inline
  the worker as a blob. Since `worker-portable.js` needs no bundler at all, the robust MV3
  path is: copy `node_modules/@pierre/diffs/dist/worker/worker-portable.js` into the
  extension output as a static asset and reference it by `chrome.runtime.getURL`.
- **Content scripts are a different story.** A worker created from a content script runs
  in the *host page's* origin (github.com) under the *host page's* CSP, and the worker
  file would have to be listed in `web_accessible_resources`. GitHub's CSP governs
  whether that is allowed. **UNVERIFIED** — if the extension UI lives in a content script
  rather than an extension page, test the worker path early, and be prepared to fall back
  to main-thread highlighting (which is the library default and fully functional).
- Rendering itself has no worker dependency. Without a pool, highlighting runs on the main
  thread via `getSharedHighlighter()`; the pool is purely a performance optimization. If
  workers turn out to be blocked, nothing else about the integration changes.

Other MV3-relevant items:
- `customElements.define('diffs-container', …)` runs as a module side effect. In an
  extension page this is unremarkable. **UNVERIFIED**: whether a content script's isolated
  world gets its own `CustomElementRegistry` for the host document, and whether a name
  collision with a github.com-defined element is possible. The code guards with
  `customElements.get(DIFFS_TAG_NAME) == null`, so a collision degrades to "our styles
  never get adopted" rather than a throw.
- `new CSSStyleSheet()` + `replaceSync` (constructable stylesheets) is used for the shadow
  styles. Supported in Chrome; not a CSP concern.

---

# E. Layout, theming, options

## E.1 `BaseCodeOptions` and `BaseDiffOptions` — verbatim from `src/types.ts`

```ts
export interface BaseCodeOptions {
  theme?: DiffsThemeNames | ThemesType;
  disableLineNumbers?: boolean;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default
  collapsed?: boolean;
  disableFileHeader?: boolean;
  disableVirtualizationBuffers?: boolean;
  stickyHeader?: boolean;

  // Shiki config options, ignored if you're using a WorkerPoolManager
  preferredHighlighter?: HighlighterTypes;
  useCSSClasses?: boolean;
  useTokenTransformer?: boolean;
  tokenizeMaxLineLength?: number;
  tokenizeMaxLength?: number;

  // Custom CSS injection
  unsafeCSS?: string;
}

export interface BaseDiffOptions extends BaseCodeOptions {
  diffStyle?: 'unified' | 'split'; // split is default
  diffIndicators?: DiffIndicators; // bars is default
  disableBackground?: boolean;
  hunkSeparators?: HunkSeparators; // line-info is default
  expandUnchanged?: boolean; // false is default
  loadDiffFiles?: FileDiffContentsLoader;
  collapsedContextThreshold?: number; // 2 is default   [see note below]
  lineDiffType?: LineDiffTypes; // 'word-alt' is default
  maxLineDiffLength?: number; // 1000 is default
  expansionLineCount?: number; // 100 is default
  parseDiffOptions?: CreatePatchOptionsNonabortable;
}
```

Supporting unions:

```ts
export type ThemeTypes = 'system' | 'light' | 'dark';
export type ThemesType = Record<'dark' | 'light', DiffsThemeNames>;
export type DiffsThemeNames = BundledTheme | (string & {});
export type HighlighterTypes = 'shiki-js' | 'shiki-wasm';
export type DiffIndicators = 'classic' | 'bars' | 'none';
export type LineDiffTypes = 'word-alt' | 'word' | 'char' | 'none';
export type HunkSeparators = 'simple' | 'metadata' | 'line-info' | 'line-info-basic' | 'custom';
//   'custom' is deprecated ("will be removed in a future version")
export type SupportedLanguages = BundledLanguage | 'text' | 'ansi' | (string & {});
```

## E.2 Actual runtime defaults (authoritative)

The inline comments above are slightly stale for `collapsedContextThreshold`. The real
defaults come from `DiffHunksRenderer.getOptionsWithDefaults()` — verbatim:

```ts
const {
  diffIndicators = 'bars',
  diffStyle = 'split',
  disableBackground = false,
  disableFileHeader = false,
  disableLineNumbers = false,
  disableVirtualizationBuffers = false,
  collapsed = false,
  expandUnchanged = false,
  collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,  // = 1
  expansionLineCount = 100,
  hunkSeparators = 'line-info',
  lineDiffType = 'word-alt',
  maxLineDiffLength = 1000,
  overflow = 'scroll',
  stickyHeader = false,
  theme = DEFAULT_THEMES,                       // { dark: 'pierre-dark', light: 'pierre-light' }
  headerRenderMode = 'default',
  tokenizeMaxLineLength = 1000,
  tokenizeMaxLength = DEFAULT_TOKENIZE_MAX_LENGTH,   // = 100_000
  useTokenTransformer = false,
  useCSSClasses = false,
} = this.options;
```

Relevant constants (`src/constants.ts`):

```ts
export const DEFAULT_THEMES: ThemesType = { dark: 'pierre-dark', light: 'pierre-light' };
export const DEFAULT_COLLAPSED_CONTEXT_THRESHOLD = 1;
export const DEFAULT_TOKENIZE_MAX_LENGTH = 100_000;
export const DEFAULT_VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 44, spacing: 8,
};
export const DEFAULT_CODE_VIEW_FILE_METRICS: VirtualFileMetrics = { ...DEFAULT_VIRTUAL_FILE_METRICS, hunkLineCount: 1 };
export const DEFAULT_CODE_VIEW_LAYOUT: CodeViewLayout = { paddingTop: 8, paddingBottom: 8, gap: 8 };
```

## E.3 Answers to the specific questions

| Need | Option |
| --- | --- |
| Split vs unified/stacked toggle | `options.diffStyle: 'split' \| 'unified'` (default `'split'`). Flip it live via `setOptions` / a new `options` object — no data change needed. |
| Light/dark themes | `options.theme` = a single Shiki theme name **or** `{ light, dark }`. Bundled: `'pierre-light'`, `'pierre-dark'`; any Shiki bundled theme name also works. |
| Which of light/dark is used | `options.themeType: 'system' \| 'light' \| 'dark'` (default `'system'` → follows OS). Imperative: `instance.setThemeType(themeType)`. |
| Line wrapping | `options.overflow: 'scroll' \| 'wrap'` (default `'scroll'`). |
| Hide line numbers | `options.disableLineNumbers: true` — **but this disables line selection** (section C.3). |
| Diff indicator style | `options.diffIndicators: 'bars' (default) \| 'classic' ('+'/'-' chars) \| 'none'`. |
| Hide changed-line backgrounds | `options.disableBackground: true`. |
| Hide the file header | `options.disableFileHeader: true`. |
| Sticky file header | `options.stickyHeader: true` (single surfaces) / `CodeViewOptions.stickyHeaders: true`. |
| Collapse a file's body | `options.collapsed: true` (header stays visible) / `CodeViewItem.collapsed`. |
| Inline (intra-line) diff granularity | `options.lineDiffType: 'word-alt' \| 'word' \| 'char' \| 'none'`; `maxLineDiffLength` (default 1000) skips it for long lines. |

## E.4 Theming binds to Shiki themes directly

`getSharedHighlighter` creates one shared Shiki highlighter per thread; theme JSON is
resolved and attached lazily. Register custom themes/languages before first render
(skill `recipe-custom-highlighting.md`, verbatim):

```ts
import { registerCustomLanguage, registerCustomTheme } from '@pierre/diffs';

registerCustomLanguage('my-language', () => import('./my-language.tmLanguage.json'), ['myext']);
registerCustomTheme('my-theme', () => import('./my-theme.json'));
```

Also exported: `registerCustomCSSVariableTheme`, `createCSSVariablesTheme` (re-exported
from Shiki), `resolveTheme(s)`, `attachResolvedThemes`, `getThemes`,
`getHighlighterThemeStyles`, `disposeHighlighter`.

The library derives its addition/deletion/modified colours from the active Shiki theme by
default, and you can override them with CSS variables (next section).

## E.5 CSS custom properties — fonts, sizes, colours

Everything renders inside a shadow root with `:host` defaults.

**Page-level values do not always reach in, and the colour tokens are the case where
they do not.** `:host` *declares* `--diffs-bg`, `--diffs-fg` and around twenty more,
and a declaration beats an inherited value — so setting `--diffs-bg` on `:root` is
silently ignored. The inner slots are no better: `--diffs-bg` resolves to
`light-dark(var(--diffs-light-bg, #fff), var(--diffs-dark-bg, #000))`, which reads as
though `--diffs-light-bg` were a free hook, but `:host` declares those too — measured
in Chrome, `--diffs-dark-bg` on the host is `#0a0a0a` (a `@pierre/theme` value) no
matter what `:root` says.

Two things do work, and both are verified against a real browser rather than the
sheet:

1. **Target the host element from the outer document.** `diffs-container { --diffs-bg:
   … }` wins, because when declarations come from different tree scopes the outer one
   takes precedence over `:host`. This is what `entrypoints/review/style.css` uses to
   put the diff on the same background as the page, and `e2e/review.spec.ts` asserts
   the two resolve equal — it fails against a build without it, reporting Pierre's
   `rgb(10, 10, 10)` against the page's `rgb(13, 17, 23)`.
2. **The `-override` tokens**, which genuinely are undeclared fallback slots:
   `--diffs-addition-color-override`, `--diffs-deletion-color-override`,
   `--diffs-modified-color-override`, `--diffs-bg-addition-override`,
   `--diffs-bg-context-override`, `--diffs-overflow-override` and about fifteen more
   (`grep -o -- "--diffs-[a-z-]*-override" node_modules/@pierre/diffs/dist/style.js`).

Note also that neither package ships a `.css` file: the stylesheet is a JS string in
`dist/style.js`, adopted into each shadow root via `adoptedStyleSheets`. Reading it
means decoding that string, not opening a stylesheet.

`@pierre/trees` is the same shape, except that it paints its background on the **host
element itself** rather than inside the shadow root, and its `--trees-*-override`
tokens are real hooks.

Real sample from the docs source (`Styling/constants.ts`, verbatim):

```css
:root {
  /* Available Custom CSS Variables. Most should be self explanatory */
  /* Sets code font, very important */
  --diffs-font-family: 'Berkeley Mono', monospace;
  --diffs-font-size: 14px;
  --diffs-line-height: 1.5;
  /* Controls tab character size */
  --diffs-tab-size: 2;
  /* Font used in header and separator components,
   * typically not a monospace font, but it's your call */
  --diffs-header-font-family: Helvetica;
  /* Override or customize any 'font-feature-settings'
   * for your code font */
  --diffs-font-features: normal;
  /* Override the minimum width for the number column. */
  --diffs-min-number-column-width: 3ch;

  /* By default we try to inherit the deletion/addition/modified
   * colors from the existing Shiki theme, however if you'd like
   * to override them, you can do so via these css variables: */
  --diffs-deletion-color-override: orange;
  --diffs-addition-color-override: yellow;
  --diffs-modified-color-override: purple;

  /* Line selection colors - customize the staged selection tint that gets
   * mixed into selected rows and their gutter/number cells. */
  --diffs-selection-color-override: rgb(37, 99, 235);
  --diffs-bg-selection-override: rgba(147, 197, 253, 0.28);
  --diffs-bg-selection-number-override: rgba(96, 165, 250, 0.55);

  /* Edit cursor background color */
  --diffs-bg-caret-override: rgba(128, 128, 128, 0.55);

  /* Some basic variables for tweaking the layouts of some of the built in components */
  --diffs-gap-inline: 8px;
  --diffs-gap-block: 8px;
}
```

Per-instance via the `style` prop:

```tsx
<FileDiff
  style={{
    '--diffs-font-family': 'JetBrains Mono, monospace',
    '--diffs-font-size': '13px'
  } as React.CSSProperties}
/>
```

The full override list is enumerated in a comment block at the top of `src/style.css`:
`--diffs-bg-buffer-override`, `--diffs-bg-hover-override`, `--diffs-bg-context-override`,
`--diffs-bg-context-gutter-override`, `--diffs-bg-separator-override`,
`--diffs-bg-caret-override`, `--diffs-fg-number-override`,
`--diffs-fg-number-addition-override`, `--diffs-fg-number-deletion-override`,
`--diffs-fg-conflict-marker-override`, `--diffs-deletion-color-override`,
`--diffs-addition-color-override`, `--diffs-modified-color-override`,
`--diffs-bg-deletion-override`, `--diffs-bg-deletion-number-override`,
`--diffs-bg-deletion-emphasis-override`, `--diffs-bg-addition-override`,
`--diffs-bg-addition-number-override`, `--diffs-bg-addition-emphasis-override`,
`--conflict-bg-*-override`, `--diffs-selection-color-override`,
`--diffs-bg-selection-override`, `--diffs-bg-selection-number-override`,
plus layout: `--diffs-gap-inline`, `--diffs-gap-block`, `--diffs-gap-style`,
`--diffs-scrollbar-gutter-override`, `--diffs-tab-size`, `--diffs-popover-gap`.

Built-in font fallbacks (`src/style.css` `:host`):

```css
--diffs-font-fallback: 'SF Mono', Monaco, Consolas, 'Ubuntu Mono', 'Liberation Mono', 'Courier New', monospace;
--diffs-header-font-fallback: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Liberation Sans', Arial, sans-serif;
```

## E.6 `unsafeCSS` — injecting CSS into the shadow root

`options.unsafeCSS: string` is wrapped in `@layer unsafe` (highest priority; the sheet
declares `@layer base, theme, rendered, unsafe;`). Docs sample:

```tsx
<FileDiff
  options={{
    unsafeCSS: /* css */ `
[data-line-index='0'] { border-top: 1px solid var(--diffs-bg-context); }
[data-line] { border-bottom: 1px solid var(--diffs-bg-context); }
[data-column-number] { border-right: 1px solid var(--diffs-bg-context); }`
  }}
/>
```

**Explicit stability warning from the docs:** *"We cannot currently guarantee backwards
compatibility for this feature across any future changes to the library, even in patch
versions."* Use simple attribute selectors; avoid `:nth-child`, sibling combinators, and
deep descendant selectors.

Useful data attributes observed in source: `data-line` (line number), `data-line-index`
(`"<unifiedIndex>,<splitIndex>"`), `data-selected-line` (`''`/`'first'`/`'last'`),
`data-editor-active-line`, `data-hovered`, `data-line-annotation`
(`"<hunkIndex>,<lineIndex>"`), `data-annotation-content`, `data-annotation-slot`,
`data-utility-button`, `data-gutter-utility-slot`, `data-diff-type` (`'split'`),
`data-column-number`, `data-icon`.

## E.7 Header customization

```ts
renderHeaderPrefix?(fileDiff): ReactNode          // before filename inside built-in header
renderHeaderFilenameSuffix?(fileDiff): ReactNode  // immediately after the filename (badges)
renderHeaderMetadata?(fileDiff): ReactNode        // after the +/- stats
renderCustomHeader?(fileDiff): ReactNode          // REPLACES built-in header content
```

Slot ids (`src/constants.ts`): `'header-prefix'`, `'header-filename-suffix'`,
`'header-metadata'`, `'header-custom'`. For `File`, the same callbacks receive
`FileContents`.

## E.8 `onPostRender` — DOM lifecycle hook

```ts
onPostRender?(node: HTMLElement, instance: FileDiff<LAnnotation>, phase: PostRenderPhase): unknown;
// export type PostRenderPhase = 'mount' | 'update' | 'unmount';
```

Docs note it is the sanctioned way to reach into the shadow root, e.g. for `selectstart` /
`selectionchange` listeners:

```ts
const codeLines = node.shadowRoot?.querySelectorAll('[data-line]');
```

Under `CodeView` the signature gains the item context:
`onPostRender(node, instance, phase, context)`, and `'unmount'` fires whenever an item is
recycled out of the virtual window.

---

# F. Expanding unchanged context

## F.1 Supported — and gated on having full file contents

`FileDiffMetadata.isPartial` is the gate. Verbatim from `src/types.ts`:

```
   * Whether the diff was parsed from a patch file (true) or generated from
   * full file contents (false).
   *
   * When true, `deletionLines`/`additionLines` contain only the lines present
   * in the patch and hunk expansion is unavailable.
   *
   * When false, they contain the complete file contents.
   *
   * A hydrating renderer mutates a partial metadata object to flip this to
   * false after `loadDiffFiles` resolves.
```

Whether expand affordances render at all (`src/renderers/DiffHunksRenderer.ts`):

```ts
const canHydrateContext = canHydrateCollapsedContext(fileDiff, this.options.loadDiffFiles != null);
const isExpandableDiff = !fileDiff.isPartial || canHydrateContext;
…
context.hunkData.push({
  slotName, hunkIndex,
  lines: typeof collapsedLines === 'number' ? collapsedLines : 0,
  lineCountKnown: typeof collapsedLines === 'number',
  type,
  expandable: isExpandable ? { up: !isFirstHunk, down: !isLastHunk, chunked } : undefined,
});

function canHydrateCollapsedContext(fileDiff: FileDiffMetadata, hasFileLoader: boolean): boolean {
  return (
    fileDiff.isPartial &&
    hasFileLoader &&
    (fileDiff.type === 'change' || fileDiff.type === 'rename-changed')
  );
}
```

**So: a diff parsed from a GitHub patch is `isPartial: true` and has NO expansion controls
unless you supply `loadDiffFiles`.**

## F.2 What the consumer must supply: `loadDiffFiles`

```ts
export type FileDiffContentsLoader = (fileDiff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>;

export type FileDiffLoadedFiles =
  | { oldFile: FileContents; newFile: FileContents }   // changed / rename-changed
  | { oldFile: null;         newFile: FileContents };  // pure rename
```

From `BaseDiffOptions`:

```
   * Fetches full file contents for partial changed/renamed diffs parsed from
   * patches. Return both sides for changed diffs and `oldFile: null` for pure
   * renames. Added/deleted diffs already include their available side and thus
   * this function serves no purpose in those contexts
```

Real docs sample (`ReactAPI/constants.ts` → `REACT_API_LOAD_DIFF_FILES`), verbatim:

```tsx
import { parsePatchFiles, type FileDiffLoadedFiles, type FileDiffOptions } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useMemo } from 'react';

declare const patchText: string;

const fileDiff = parsePatchFiles(patchText, 'pull-42')[0]?.files[0];
if (fileDiff == null) { throw new Error('The patch does not contain a file diff'); }

export function ReviewDiff() {
  const fileDiffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      async loadDiffFiles(fileDiff): Promise<FileDiffLoadedFiles> {
        const response = await fetch('/api/files?path=' + encodeURIComponent(fileDiff.name));
        // Return { oldFile, newFile }, or { oldFile: null, newFile }
        // for pure renames.
        // Include cacheKey values that change with revision or content.
        return response.json();
      },
    }),
    []
  );

  return <FileDiff fileDiff={fileDiff} options={fileDiffOptions} />;
}
```

For this project: `loadDiffFiles` should fetch both blobs from the GitHub API
(`GET /repos/{owner}/{repo}/contents/{path}?ref={base_sha}` and `?ref={head_sha}`, or the
raw blob endpoints). Give each side a `cacheKey` derived from its blob SHA.

**Hydration is in-place and mutates your object.** From `FileDiffMetadata`'s doc comment:
*"When a renderer uses `loadDiffFiles` to hydrate a partial diff, it upgrades this metadata
object in place. Keep the same object identity stable when callers want that hydrated state
to persist across later renders."* And the docs add: *"Avoid calling `parsePatchFiles`
during every render before passing the result to `FileDiff`; store or memoize the parsed
metadata instead."* — i.e. parse once, keep the object, never re-parse in render.

`loadDiffFiles` is triggered lazily by `expandHunk` (`loadFilesIfNecessary()` runs inside
`expandHunk`), so nothing is fetched until the user clicks expand.

## F.3 Expansion controls and options

Expand controls only exist when the hunk separator is clickable. `FileDiff`'s constructor
wires `onHunkExpand` only for these separator types:

```ts
typeof options.hunkSeparators === 'function' ||
  (options.hunkSeparators ?? 'line-info') === 'line-info' ||
  options.hunkSeparators === 'line-info-basic'
```

So `hunkSeparators: 'metadata'` or `'simple'` removes the expand affordance. Default is
`'line-info'` — clickable.

Relevant options:

| Option | Default | Effect |
| --- | --- | --- |
| `expandUnchanged` | `false` | Render **all** unchanged context immediately. Requires non-partial metadata (full file contents). |
| `expansionLineCount` | `100` | Lines revealed per expand click. |
| `collapsedContextThreshold` | `1` | Gaps at or below this size auto-expand instead of collapsing. |

Shift-clicking an expander expands everything (`InteractionManager`):

```ts
onHunkExpand(
  target.hunkIndex,
  target.all || event.shiftKey ? 'both' : target.direction,
  target.all || event.shiftKey ? Number.POSITIVE_INFINITY : undefined
);
```

Imperative API on the instance:

```ts
public handleExpandHunk = (hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number): void
public expandHunk       = (hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number): void
public isLineRenderable(lineNumber: number): boolean               // one-based NEW-file line
public getNearestRenderableLine(lineNumber: number, direction: 'up' | 'down'): number | undefined
public revealLine(lineNumber: number): boolean                     // expands context to show a line
// export type ExpansionDirections = 'up' | 'down' | 'both';
```

`revealLine` returns `false` when `fileDiff.isPartial || expandUnchanged` — another reason
to hydrate.

**Direct relevance to annotations:** since annotations on collapsed lines do not render
(B.2 §2), `revealLine(lineNumber)` (or `expandUnchanged: true` on a hydrated diff) is the
mechanism for making an out-of-hunk GitHub thread visible. `isLineRenderable` lets you
detect the case up front and, e.g., surface those threads in a sidebar instead.

---

# G. Large diffs and performance

## G.1 Three tiers, in order of preference (from `Virtualization` and `CodeView` docs)

1. **`CodeView`** — one scroll region, mixed `file`/`diff` items, per-line virtualization.
   The docs: *"If your scrollable region is only code, start with `CodeView` instead. It is
   the more optimized path: it owns the entire code region, only renders what you can
   actually see, and is generally more performant and less prone to blanking."* and
   *"Built-in per-line virtualization that should scale to nearly any file or diff that can
   fit in memory."*
2. **`Virtualizer` + `VirtualizedFile` / `VirtualizedFileDiff`** — for mixed layouts where
   code has to interleave with other DOM. Tradeoff, verbatim: *"every top-level file or
   diff container stays mounted, and the experience is more likely to blank during fast
   scroll."*
3. Plain `FileDiff` / `File` — fine for a handful of small files.

## G.2 `CodeView` API surface (React)

```ts
export type CodeViewProps<LAnnotation = undefined> =
  | ControlledCodeViewProps<LAnnotation>    // items: readonly CodeViewItem[]
  | UncontrolledCodeViewProps<LAnnotation>; // initialItems?: readonly CodeViewItem[] + ref API

export interface CodeViewHandle<LAnnotation> {
  addItems(items: readonly CodeViewItem<LAnnotation>[]): void;
  getItem(id: string): CodeViewItem<LAnnotation> | undefined;
  removeItem(id: string): boolean;
  updateItem(item: CodeViewItem<LAnnotation>): boolean;
  updateItemId(oldId: string, newId: string): boolean;
  scrollTo(target: CodeViewScrollTarget): void;
  setSelectedLines(selection: CodeViewLineSelection | null): void;
  getSelectedLines(): CodeViewLineSelection | null;
  clearSelectedLines(): void;
  getEditor(id: string): DiffsEditor<LAnnotation> | undefined;
  getInstance(): CodeView<LAnnotation> | undefined;
}
```

`CodeViewOptions` (vanilla superset; React uses
`CodeViewReactOptions = Omit<CodeViewOptions, 'controlledSelection' | 'createEditor' | 'onSelectedLinesChange'>`):

```ts
export interface CodeViewOptions<LAnnotation>
  extends CodeViewPassThroughOptions<LAnnotation>,
          CodeViewSharedCallbackOptions<LAnnotation>,
          CodeViewSelectionCallbackOptions<LAnnotation> {
  hunkSeparators?: Exclude<HunkSeparators, 'custom'>;
  itemMetrics?: Partial<VirtualFileMetrics>;
  pointerEventsOnScroll?: boolean;
  smoothScrollSettings?: SmoothScrollSettings;
  stickyHeaders?: boolean;
  controlledSelection?: boolean;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  layout?: CodeViewLayout;
  createEditor?(…): DiffsEditor<LAnnotation> | undefined;
  renderCodeViewHeader?(): HTMLElement | undefined;
  renderCodeViewFooter?(): HTMLElement | undefined;
  __devOnlyValidateItemHeights?: boolean;
}
```

The exhaustive list of per-file/per-diff options that `CodeView` forwards to items is a
literal array in `src/components/CodeView.ts`:

```ts
export const CODE_VIEW_DIFF_OPTION_KEYS = [
  'theme','disableLineNumbers','overflow','themeType','disableFileHeader',
  'disableVirtualizationBuffers','preferredHighlighter','useCSSClasses','useTokenTransformer',
  'tokenizeMaxLineLength','tokenizeMaxLength','unsafeCSS','diffStyle','diffIndicators',
  'disableBackground','expandUnchanged','loadDiffFiles','collapsedContextThreshold',
  'lineDiffType','maxLineDiffLength','expansionLineCount','lineHoverHighlight',
  'enableTokenInteractionsOnWhitespace','enableGutterUtility','__debugPointerEvents',
  'enableLineSelection','controlledSelection','disableErrorHandling',
] as const;
```

(`CODE_VIEW_FILE_OPTION_KEYS` is the same minus the diff-only entries.)
Note `stickyHeader` is **not** in that list — use `CodeViewOptions.stickyHeaders`.

Working React example (skill `recipe-code-view.md`, verbatim):

```tsx
import { parseDiffFromFile, type CodeViewItem, type CodeViewLineSelection } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { useRef, useState } from 'react';

const codeViewStyle = { height: 600, overflow: 'auto' } as const;
const codeViewOptions = {
  theme: { light: 'pierre-light', dark: 'pierre-dark' },
  stickyHeaders: true,
  enableLineSelection: true,
  layout: { paddingTop: 16, paddingBottom: 16, gap: 12 },
} as const;

export function ReviewSurface() {
  const viewerRef = useRef<CodeViewHandle<undefined> | null>(null);
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null);
  const [items, setItems] = useState<CodeViewItem[]>(() => [
    { id: 'diff:src/value.ts', type: 'diff', fileDiff: parseDiffFromFile(oldFile, newFile), version: 0 },
    { id: 'file:README.md', type: 'file', file: { name: 'README.md', contents: '# Review notes' }, version: 0 },
  ]);

  return (
    <CodeView
      ref={viewerRef}
      items={items}
      selectedLines={selection}
      onSelectedLinesChange={setSelection}
      style={codeViewStyle}
      options={codeViewOptions}
    />
  );
}
```

Scroll targets:

```ts
export type CodeViewScrollTarget =
  | { type: 'position'; position: number; behavior?: CodeViewScrollBehavior }
  | { type: 'line'; id: string; lineNumber: number; side?: SelectionSide;
      align?: 'start'|'center'|'end'|'nearest'; offset?: number; behavior?: CodeViewScrollBehavior }
  | { type: 'range'; id: string; range: SelectedLineRange;
      align?: 'start'|'center'|'end'|'nearest'; offset?: number; behavior?: CodeViewScrollBehavior }
  | { type: 'item'; id: string;
      align?: 'start'|'center'|'end'|'nearest'; offset?: number; behavior?: CodeViewScrollBehavior };
// export type CodeViewScrollBehavior = 'instant' | 'smooth' | 'smooth-auto';
```

`scrollTo({ type: 'line', id: fileId, lineNumber, side: 'additions', align: 'center' })` is
exactly what you need for "jump to review thread".

## G.3 Item ownership for very large PRs

From the docs: **controlled** (`items`) when React state naturally owns a small list;
**imperative** (`initialItems` + ref) for large or streaming lists. *"In React, `addItems`,
`removeItem`, and `updateItem` require imperative item ownership and throw if the viewer is
controlled with `items`."* Pick one per mounted viewer and do not switch without a new
`key`.

Every item needs a stable `id`, and **`version` must be incremented whenever an existing
item's contents, annotations, `collapsed`, or `edit` changes** — that is how `CodeView`
does targeted updates. From the docs: *"its data model does not depend on traditional
immutability or deep equality checks, which can quickly become expensive."*

## G.4 Performance knobs

| Knob | What it does |
| --- | --- |
| Worker pool | Move Shiki highlighting off the main thread. *"For large diffs, using virtualization with a Worker Pool is strongly recommended."* |
| `cacheKey` on `FileContents` / `FileDiffMetadata` | Enables the worker pool's AST LRU cache. **Files/diffs without a `cacheKey` are not cached.** The cache also validates against render options. **You must change the key whenever the content changes.** For GitHub, blob SHA is the natural key. `parsePatchFiles(data, cacheKeyPrefix)` will seed keys for you. |
| `totalASTLRUCacheSize` | `WorkerPoolOptions` LRU size. |
| `tokenizeMaxLength` (default `100_000`) | Above this line count the file/diff renders as **plain text** (no highlighting). |
| `tokenizeMaxLineLength` (default `1000`) | Per-line highlighting cutoff. |
| `maxLineDiffLength` (default `1000`) | Skips intra-line word/char diffing on long lines. |
| `lineDiffType: 'none'` | Disables intra-line diffing entirely. |
| `useTokenTransformer` / token callbacks | **Increase DOM size significantly.** The docs warn repeatedly: *"Worker pools can move highlighting work off the main thread, but they do not reduce the extra DOM size created by token metadata."* Leave `false` unless you need `onToken*`. |
| `pointerEventsOnScroll` | `CodeView` disables pointer events while scrolling by default for smoothness. Set `true` only if you need interactions during scroll. |
| `itemMetrics` / `metrics` | Height estimates used before measurement. Tune if you customize row heights; validate with `__devOnlyValidateItemHeights` (dev builds only) or `Virtualizer` `config.resizeDebugging`. |
| `collapsed: true` on items | Header-only rendering for files the user has not opened — cheap way to handle a 1000-file PR. |
| `disableVirtualizationBuffers` | Turns off the spacer buffers. |

```ts
export interface VirtualFileMetrics {
  hunkLineCount: number;        // rendered lines per batched hunk chunk
  lineHeight: number;           // estimated row height before measurement
  diffHeaderHeight: number;
  hunkSeparatorHeight?: number; // only set if you changed separator size via unsafeCSS
  spacing: number;              // "You should not change this from the default if you aren't applying custom CSS"
}

export interface CodeViewLayout {
  paddingTop: number;    // top padding for the sticky container offset
  paddingBottom: number; // after the final item
  gap: number;           // vertical gap between virtualized items
}
```

`Virtualizer` config (`src/components/Virtualizer.ts`):

```ts
export interface VirtualizerConfig {
  overscrollSize: number;             // extra px rendered above/below viewport
  intersectionObserverMargin: number;
  resizeDebugging: boolean;           // noisy logs for tuning; disable in production
}
```

React `Virtualizer` props: `config`, `className`/`style` (outer scroll root),
`contentClassName`/`contentStyle` (inner content wrapper). The docs note it *"does not
support window scrolling unless you orchestrate your own provider via
`VirtualizerContext.Provider`"*.

## G.5 SSR / prerender (probably not applicable to an extension, listed for completeness)

`@pierre/diffs/ssr` exposes `preloadFile`, `preloadFileDiff`, `preloadMultiFileDiff`,
`preloadPatchDiff`, `preloadPatchFile`, `preloadUnresolvedFile`, `preloadDiffHTML`,
`preloadUnresolvedFileHTML`, `renderHTML`. Each preload returns component props including
`prerenderedHTML`, which the React components hydrate against. Relevant only if the
extension ever pre-renders markup in a background context.

---

# Appendix: discrepancies found between docs and source

Recorded so an implementer does not trust the wrong one.

1. **`onLineClick` payload field.** diffs.com samples show `{ lineNumber, side, event }`.
   Source (`types.ts`, `InteractionManager.toEventBaseProps`, published
   `dist/types.d.ts:526-530`) says the diff-line field is **`annotationSide`**. Token
   events genuinely use `side`.
2. **`FileDiffMetadata` field names.** The `CoreTypes` docs page documents
   `oldLines` / `newLines`. The real fields are **`deletionLines` / `additionLines`**.
3. **`collapsedContextThreshold` default.** The comment in `BaseDiffOptions` says
   `// 2 is default`; the actual default is **1**
   (`DEFAULT_COLLAPSED_CONTEXT_THRESHOLD = 1`, applied in
   `DiffHunksRenderer.getOptionsWithDefaults`).
4. **`Hunk.hunkContent` shape.** The `CoreTypes` docs show
   `ContextContent { lines: string[] }` and
   `ChangeContent { deletions: string[]; additions: string[] }`. The real types are
   index-based: `ContextContent { type, lines: number, additionLineIndex, deletionLineIndex }`
   and `ChangeContent { type, deletions: number, deletionLineIndex, additions: number, additionLineIndex }`.
5. **Edit-mode API drift** between repo `main` and published 1.3.6 — see the version table
   at the top. Non-edit APIs are identical.
6. **VS Code webview worker recipe uses a `blob:` URL.** Do not port that pattern to MV3
   (see D.5).
