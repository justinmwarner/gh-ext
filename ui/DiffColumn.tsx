/**
 * The main column: stacked per-file diff cards, in one scroll region.
 *
 * Built on `CodeView` rather than a `FileDiff` per file, because `CodeView`
 * virtualizes the whole stack itself against a single scrollport. A five-
 * hundred-file pull request is the case this has to survive, and mounting five
 * hundred shadow roots is not a way to survive it.
 *
 * Four settings are load-bearing and none of them is a preference:
 *
 * - `disableWorkerPool` — §16.4. Grammars resolve on the main thread anyway,
 *   Vite hands dev workers a `http://localhost` URL that is cross-origin from a
 *   `chrome-extension://` page, and Chrome 148+ crashes the render process
 *   rather than throwing.
 * - **`preferredHighlighter` is never set.** The default is `shiki-js`, which
 *   touches no WebAssembly. WXT emits no CSP key in production builds, so the
 *   `shiki-wasm` path works in dev and dies silently in a shipped extension.
 * - **`disableLineNumbers` is never set.** Line selection is only reachable
 *   through the line-number gutter; without numbers, commenting is unreachable.
 * - `enableGutterUtility` — the familiar "+" affordance. Without it there is a
 *   gutter but nothing to press.
 *
 * This file also owns the obligation `partitionThreads` cannot discharge: it
 * has the parsed patch, so it is the only layer that knows which lines will
 * actually be drawn. Pierre drops an annotation outside a rendered hunk in
 * silence, so every anchor is cross-checked against the real hunk ranges and
 * anything outside them is demoted into the per-file section on the card.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeView } from '@pierre/diffs/react';
import type { CodeViewHandle, CodeViewReactOptions } from '@pierre/diffs/react';
import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import type { DiffPayload } from '@/lib/messages';
import { Composer } from './Composer';
import { FileCard } from './FileCard';
import { ThreadCard } from './ThreadCard';
import { type ComposerTarget, composerFor } from './composerAnchor';
import { type CardTop, type CurrentFile, shouldScrollDiff, topmostFile } from './currentFile';
import { codeViewItems, fileDiffFor } from './diffItems';
import type { ReviewFile } from './reviewFiles';
import { NEW_THREAD, useReviewSession } from './reviewSession';
import {
  type AnnotationMetadata,
  type ComposerMetadata,
  type FileThreadLayout,
  type ThreadMetadata,
  layoutThreads,
  sourceLines,
} from './reviewThreads';

/** Where the file list came from, and whether it was cut short getting here. */
export interface DiffOrigin {
  source: DiffPayload['source'];
  truncated: boolean;
}

export interface DiffColumnProps {
  files: readonly ReviewFile[];
  diff: DiffOrigin;
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  /** A different file reached the top of the column. */
  onScrollTo: (path: string) => void;
}

const CODE_VIEW_OPTIONS: CodeViewReactOptions<AnnotationMetadata> = {
  // The reviewer arrived from GitHub's Files-changed tab, which is unified.
  diffStyle: 'unified',
  stickyHeaders: true,
  // The "+" in the gutter, and the drag that turns it into a range.
  enableGutterUtility: true,
  enableLineSelection: true,
};

/**
 * The settings that are not preferences, in one place so a test can hold them
 * to it. Two of them are absences, which a comment cannot enforce and a
 * reviewer cannot see: the failure mode of naming `shiki-wasm` here is a diff
 * column that works all through development and is blank in the shipped
 * extension.
 */
export const CODE_VIEW_SAFE_PROPS = {
  disableWorkerPool: true,
  options: CODE_VIEW_OPTIONS,
} as const;

const NO_ANNOTATIONS: DiffLineAnnotation<AnnotationMetadata>[] = [];
const NO_LAYOUT: FileThreadLayout = { annotations: NO_ANNOTATIONS, listed: [] };

/** Everything about a thread that decides where — or whether — it anchors. */
const anchorSignature = (thread: {
  id: string;
  line: number | null;
  diffSide: string;
  subjectType: string;
  isOutdated: boolean;
}): string =>
  `${thread.id}#${thread.line ?? 'x'}#${thread.diffSide}#${thread.subjectType}#${thread.isOutdated}`;

export function DiffColumn({ files, diff, current, onScrollTo }: DiffColumnProps) {
  const session = useReviewSession();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [unplaceable, setUnplaceable] = useState<string | null>(null);

  /**
   * Annotation metadata, kept alive across renders and across thread updates.
   *
   * Pierre compares metadata **by reference**. A fresh object per render reads
   * as a changed annotation and rebuilds the row's DOM every time; keyed by
   * thread id rather than by thread object, a resolve does not churn it either.
   */
  const metadata = useRef(new Map<string, ThreadMetadata>());
  const composerMetadata = useRef<ComposerMetadata>({ kind: 'composer' });

  /**
   * Layouts, recomputed per file only when that file's threads moved.
   *
   * Rebuilding every file's annotation array whenever any thread changes would
   * hand `CodeView` a new array for five hundred untouched files and re-render
   * all of them. The signature is exactly the fields anchoring reads.
   */
  const cache = useRef(new Map<string, { signature: string; layout: FileThreadLayout }>());
  const layouts = useMemo(() => {
    const built = new Map<string, FileThreadLayout>();
    for (const file of files) {
      const threads = session.byPath.get(file.path) ?? [];
      const signature = threads.map(anchorSignature).join('|');
      const cached = cache.current.get(file.path);
      if (cached !== undefined && cached.signature === signature) {
        built.set(file.path, cached.layout);
        continue;
      }
      const layout =
        threads.length === 0
          ? NO_LAYOUT
          : layoutThreads(threads, fileDiffFor(file), metadata.current);
      cache.current.set(file.path, { signature, layout });
      built.set(file.path, layout);
    }
    return built;
  }, [files, session.byPath]);

  const annotationsByPath = useMemo(() => {
    const built = new Map<string, DiffLineAnnotation<AnnotationMetadata>[]>();
    for (const [path, layout] of layouts) {
      built.set(
        path,
        composer !== null && composer.path === path
          ? [
              ...layout.annotations,
              {
                side: composer.side,
                lineNumber: composer.lineNumber,
                metadata: composerMetadata.current,
              },
            ]
          : layout.annotations,
      );
    }
    return built;
  }, [layouts, composer]);

  const items = useMemo(
    () => codeViewItems(files, collapsed, annotationsByPath),
    [files, collapsed, annotationsByPath],
  );
  const byPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );

  const viewer = useRef<CodeViewHandle<AnnotationMetadata>>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const headers = useRef(new Map<string, HTMLElement>());

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const registerHeader = useCallback((path: string, node: HTMLElement | null) => {
    if (node === null) headers.current.delete(path);
    else headers.current.set(path, node);
  }, []);

  /**
   * A gutter gesture, turned into somewhere to write.
   *
   * Held in a ref so the `options` object below can be built once. A new
   * options identity on every render makes `CodeView` re-render every mounted
   * diff, which is the opposite of what virtualizing them was for.
   */
  const openComposer = useRef((path: string, range: SelectedLineRange) => {});
  openComposer.current = (path, range) => {
    session.clearFailure(NEW_THREAD);
    const target = composerFor(path, range);
    if (target === null) {
      // Nothing on screen to attach even the explanation to. Saying so here is
      // the alternative to posting `line: NaN` and reporting an opaque 422.
      setComposer(null);
      setUnplaceable(
        'That line selection could not be read, so there is nowhere to put a ' +
          'comment. Try selecting the lines again.',
      );
      return;
    }
    setUnplaceable(null);
    setComposer(target);
  };

  const closeComposer = useCallback(() => {
    session.clearFailure(NEW_THREAD);
    setComposer(null);
  }, [session]);

  const options = useMemo<CodeViewReactOptions<AnnotationMetadata>>(
    () => ({
      ...CODE_VIEW_OPTIONS,
      onGutterUtilityClick(range: SelectedLineRange, context: { item: { id: string } }) {
        openComposer.current(context.item.id, range);
      },
    }),
    [],
  );

  /** The source text under the composer's selection, for the suggestion button. */
  const composerLines = useMemo((): readonly string[] => {
    if (composer === null || composer.anchor === null) return [];
    const file = byPath.get(composer.path);
    if (file === undefined) return [];
    const { anchor } = composer;
    return sourceLines(
      fileDiffFor(file),
      anchor.side,
      anchor.startLine ?? anchor.line,
      anchor.line,
    );
  }, [composer, byPath]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMetadata>) => {
      const meta = annotation.metadata;
      if (meta.kind === 'thread') return <ThreadCard threadId={meta.threadId} />;
      if (composer === null) return null;
      return (
        <Composer
          path={composer.path}
          anchor={composer.anchor}
          rejection={composer.rejection}
          selectedLines={composerLines}
          onClose={closeComposer}
        />
      );
    },
    [composer, composerLines, closeComposer],
  );

  /**
   * Which file the reviewer is looking at, measured rather than counted.
   *
   * `CodeView` keeps its item offsets private, so the answer comes from where
   * the mounted card headers actually are. Virtualization means only the
   * headers near the viewport exist, which is exactly the set that could be at
   * the top of it.
   */
  const reported = useRef<string | null>(null);
  const handleScroll = useCallback(() => {
    const container = scroller.current;
    if (container === null) return;

    const origin = container.getBoundingClientRect().top;
    const tops: CardTop[] = [];
    for (const [path, node] of headers.current) {
      if (!node.isConnected) continue;
      tops.push({ path, top: node.getBoundingClientRect().top - origin });
    }

    const path = topmostFile(tops);
    // Scroll fires at frame rate and most frames are still on the same file.
    // The reducer would absorb the repeats, but only after React had rendered
    // the shell again to find that out.
    if (path === null || path === reported.current) return;
    reported.current = path;
    onScrollTo(path);
  }, [onScrollTo]);

  // Follow the tree — and only the tree. Scrolling because the column scrolled
  // is the other half of the feedback loop the origin exists to break. The
  // dependencies are the two primitives rather than `current` itself, so a
  // state object that was rebuilt without moving does not re-scroll.
  const target = current.path;
  const acts = shouldScrollDiff(current);
  useEffect(() => {
    if (!acts || target === null) return;
    viewer.current?.scrollTo({ type: 'item', id: target, align: 'start' });
  }, [acts, target]);

  return (
    <main className="column" aria-label="Diff">
      {diff.source === 'files-api' && (
        <p className="notice" role="status">
          GitHub would not generate a unified diff for this pull request, so the
          file list came from the files endpoint instead
          {diff.truncated ? ' and was truncated' : ''}. Some files will have no
          patch.
        </p>
      )}

      {unplaceable !== null && (
        <p className="notice" role="alert">
          {unplaceable}
        </p>
      )}

      {files.length === 0 ? (
        <p className="placeholder">No changed files.</p>
      ) : (
        <CodeView<AnnotationMetadata>
          ref={viewer}
          disableWorkerPool
          containerRef={scroller}
          options={options}
          items={items}
          onScroll={handleScroll}
          className="diff-view"
          renderAnnotation={renderAnnotation}
          renderCustomHeader={(item) => {
            const file = byPath.get(item.id);
            if (file === undefined) return null;
            return (
              <FileCard
                file={file}
                collapsed={collapsed.has(file.path)}
                onToggleCollapsed={toggleCollapsed}
                onHeaderRef={registerHeader}
                unanchored={layouts.get(file.path)?.listed ?? []}
              />
            );
          }}
        />
      )}
    </main>
  );
}
