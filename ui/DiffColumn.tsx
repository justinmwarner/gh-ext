/**
 * The main column: stacked per-file diff cards, in one scroll region.
 *
 * Built on `CodeView` rather than a `FileDiff` per file, because `CodeView`
 * virtualizes the whole stack itself against a single scrollport. A five-
 * hundred-file pull request is the case this has to survive, and mounting five
 * hundred shadow roots is not a way to survive it.
 *
 * Three settings are load-bearing and none of them is a preference:
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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeView } from '@pierre/diffs/react';
import type { CodeViewHandle, CodeViewReactOptions } from '@pierre/diffs/react';
import type { DiffPayload } from '@/lib/messages';
import { FileCard } from './FileCard';
import { type CardTop, type CurrentFile, shouldScrollDiff, topmostFile } from './currentFile';
import { codeViewItems } from './diffItems';
import type { ReviewFile } from './reviewFiles';

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

const CODE_VIEW_OPTIONS: CodeViewReactOptions = {
  // The reviewer arrived from GitHub's Files-changed tab, which is unified.
  diffStyle: 'unified',
  stickyHeaders: true,
};

/**
 * The settings that are not preferences, in one place so a test can hold them
 * to it. Two of the three are absences, which a comment cannot enforce and a
 * reviewer cannot see: the failure mode of naming `shiki-wasm` here is a diff
 * column that works all through development and is blank in the shipped
 * extension.
 */
export const CODE_VIEW_SAFE_PROPS = {
  disableWorkerPool: true,
  options: CODE_VIEW_OPTIONS,
} as const;

export function DiffColumn({ files, diff, current, onScrollTo }: DiffColumnProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const items = useMemo(() => codeViewItems(files, collapsed), [files, collapsed]);
  const byPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );

  const viewer = useRef<CodeViewHandle<undefined>>(null);
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

      {files.length === 0 ? (
        <p className="placeholder">No changed files.</p>
      ) : (
        <CodeView<undefined>
          ref={viewer}
          containerRef={scroller}
          {...CODE_VIEW_SAFE_PROPS}
          items={items}
          onScroll={handleScroll}
          className="diff-view"
          renderCustomHeader={(item) => {
            const file = byPath.get(item.id);
            if (file === undefined) return null;
            return (
              <FileCard
                file={file}
                collapsed={collapsed.has(file.path)}
                onToggleCollapsed={toggleCollapsed}
                onHeaderRef={registerHeader}
              />
            );
          }}
        />
      )}
    </main>
  );
}
