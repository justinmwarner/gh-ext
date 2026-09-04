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
 *
 * `sides` is the second such obligation and the sharper one. The column can be
 * showing a diff between two commits of the pull request rather than the pull
 * request's own, and a thread's line — or a line the reviewer just selected —
 * is numbered against the latter. Where the two disagree, the thread is listed
 * and the composer refuses, because in that case Pierre would draw the
 * annotation rather than drop it, on whatever text happened to be there.
 */

import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CodeView } from '@pierre/diffs/react';
import type { CodeViewHandle, CodeViewReactOptions } from '@pierre/diffs/react';
import type { DiffLineAnnotation, FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import { RAW, resolveModeForFile } from '@/lib/compare/modes';
import type { DiffPayload } from '@/lib/messages';
import type { AnchorableSides } from '@/lib/review/diffScope';
import type { AnnotationSide } from '@/lib/review/threads';
import { Composer } from './Composer';
import { FileCard } from './FileCard';
import { ThreadCard } from './ThreadCard';
import { type ComposerTarget, composerFor } from './composerAnchor';
import { type CardTop, type CurrentFile, shouldScrollDiff, topmostFile } from './currentFile';
import { type BlobRefs, createDiffFilesLoader } from './blobLoader';
import {
  codeViewItems,
  diffGeneration,
  fileDiffFor,
  fileDiffSignature,
  hunkStops,
} from './diffItems';
import type { ReviewFile } from './reviewFiles';
import { NEW_THREAD, useReviewSession } from './reviewSession';
import {
  type AnnotationMetadata,
  type ComposerMetadata,
  type FileThreadLayout,
  type ThreadMetadata,
  isRenderedLine,
  layoutThreads,
  renderedLines,
  sourceLines,
} from './reviewThreads';

/** Where the file list came from, and whether it was cut short getting here. */
export interface DiffOrigin {
  source: DiffPayload['source'];
  truncated: boolean;
}

/**
 * A request from the Overview to bring one thread into view.
 *
 * `token` rather than a bare id: two jumps to the same thread are two requests,
 * and the second has to act. Nothing here can be derived from `current`, whose
 * whole design is to *stop* repeating itself.
 */
export interface ThreadJump {
  threadId: string;
  token: number;
}

/**
 * What the keyboard needs from the column and cannot express as a prop.
 *
 * Three things, and each is about something only this component holds: the
 * parsed hunks, the viewer's scroll, and Pierre's own line selection.
 */
export interface DiffColumnHandle {
  /** Move to the next hunk (`1`) or the previous one (`-1`), across files. */
  goToHunk(direction: 1 | -1): void;
  /** Bring one line into view. What a search result jumps to. */
  goToLine(path: string, side: AnnotationSide, line: number): void;
  /** Open the composer on whatever the reviewer has selected in the gutter. */
  commentOnSelection(): void;
}

export interface DiffColumnProps {
  files: readonly ReviewFile[];
  diff: DiffOrigin;
  /**
   * Which sides of the diff on screen number their lines the way the pull
   * request's own diff does.
   *
   * Everything anchored to a line consults this: the threads, and the
   * composer. A narrowed diff between two other commits numbers its rows
   * against different files, and a line number that means something else is
   * the one failure here that produces no symptom at all — the annotation
   * renders, on the wrong text.
   */
  sides: AnchorableSides;
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  /** A different file reached the top of the column. */
  onScrollTo: (path: string) => void;
  /** The Overview asked for a thread. Null until it has. */
  jump?: ThreadJump | null;
  /**
   * The two commits to read whole files from, for expanding context.
   *
   * Null when there is no base commit to read — an older cached payload — and
   * the column then passes no loader at all, which is the state Pierre already
   * handles by drawing no expander rather than one that always fails.
   */
  blobs?: BlobRefs | null;
  ref?: Ref<DiffColumnHandle>;
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

/**
 * Room to scroll past the last file.
 *
 * `CodeView` sizes its scroll region from the items it has measured, so at
 * maximum scroll the final item's *bottom* is level with the bottom of the
 * scrollport — which puts the top of that card, where all of its controls
 * live, below the fold with nowhere further to scroll. Measured in Chrome: the
 * last card's header sat 23px past the edge with the column already at its
 * limit, and its mode buttons could not be clicked at all.
 *
 * That is latent in any column whose last card has a tall header, and rich
 * comparisons are what made the headers tall. `renderCodeViewFooter` is the
 * library's own answer: a non-virtualized element after the last item, whose
 * height it measures and includes.
 *
 * A module constant rather than an inline arrow because `SlotPortals` memoizes
 * on this callback's identity.
 */
const renderTail = () => <div className="column-tail" aria-hidden="true" />;

const NO_ANNOTATIONS: DiffLineAnnotation<AnnotationMetadata>[] = [];
const NO_LAYOUT: FileThreadLayout = { annotations: NO_ANNOTATIONS, listed: [] };

/**
 * The two questions only the renderer can answer about a hydrated diff.
 *
 * Structural rather than the `FileDiff` class, because the instance handed to
 * `onPostRender` under `CodeView` is a `VirtualizedFileDiff` and neither is
 * exported as a value this module should depend on. Both take a one-based
 * new-file line; there is no deletion-side counterpart in the library.
 */
interface LineProbe {
  /** Is this line on screen *now*, given whatever has been expanded? */
  isLineRenderable(lineNumber: number): boolean;
  /** Expand enough context to put it there. False if it already is. */
  revealLine(lineNumber: number): boolean;
}

const isLineProbe = (value: unknown): value is LineProbe =>
  typeof (value as LineProbe | null)?.isLineRenderable === 'function' &&
  typeof (value as LineProbe).revealLine === 'function';

/** Everything about a thread that decides where — or whether — it anchors. */
const anchorSignature = (thread: {
  id: string;
  line: number | null;
  diffSide: string;
  subjectType: string;
  isOutdated: boolean;
}): string =>
  `${thread.id}#${thread.line ?? 'x'}#${thread.diffSide}#${thread.subjectType}#${thread.isOutdated}`;

/**
 * How many frames to keep looking for a thread the column was asked to reach.
 *
 * The file has to be scrolled to, virtualized in and rendered before the
 * thread's element exists, and none of that is synchronous. A handful of frames
 * covers it; giving up quietly after that is correct, because the file scroll
 * has already happened and that is most of the answer.
 */
const JUMP_FRAMES = 8;

export function DiffColumn({
  files,
  diff,
  sides,
  current,
  onScrollTo,
  jump = null,
  blobs = null,
  ref,
}: DiffColumnProps) {
  const session = useReviewSession();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * How each file is being compared, for the files the reviewer has moved.
   *
   * Per file rather than per type, because two images in one pull request are
   * answering different questions — one was redrawn and wants side by side, the
   * next moved four pixels and wants the difference blend. A single mode would
   * make each choice undo the last.
   *
   * Sparse, and deliberately not seeded with every file's default. The default
   * is a function of the file, so writing it down would only create a second
   * copy to keep in step with the first — and the file list is replaced
   * wholesale by "changes since my last review", which would leave that copy
   * describing files that are no longer here.
   */
  const [chosenModes, setChosenModes] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [unplaceable, setUnplaceable] = useState<string | null>(null);
  const [expansionError, setExpansionError] = useState<string | null>(null);

  /**
   * Which lines the renderer has told us it will actually draw, per file.
   *
   * Expanding unchanged context is invisible in the metadata — `expandedHunks`
   * lives on Pierre's renderer and nothing about `FileDiffMetadata` moves when
   * a hunk grows — so the only honest source for "is line N on screen" is the
   * instance's own `isLineRenderable`. That is asked after each render and the
   * answers accumulate here.
   *
   * Accumulating is sound because expansion only ever grows: `expandHunk` adds
   * to the region and nothing shrinks it short of tearing the renderer down —
   * which is exactly what the remount below does, so these are cleared with it.
   */
  const revealed = useRef(new Map<string, Set<number>>());
  /** Lines already offered to `revealLine`, so a refusal is never retried. */
  const revealAttempted = useRef(new Set<string>());

  /**
   * Forget what the last renderer drew, because it no longer exists.
   *
   * `CodeView` is keyed on the generation, so a new file list tears the whole
   * thing down and rebuilds it collapsed. These two refs outlive that, and a
   * line the old renderer had expanded into view reads as still drawable —
   * so a thread anchored there is emitted as an annotation for a row the new
   * renderer has not got. Pierre keeps that annotation in the DOM but does not
   * display it, and because the thread was not demoted it is left off the
   * per-file list too: the comment is on neither surface, with nothing raised.
   *
   * Done during render rather than in an effect. The layouts memo below reads
   * `revealed` in this same pass, and an effect would let it build one round
   * of annotations from the dead renderer's answers first.
   */
  const generation = diffGeneration(files);
  const lastGeneration = useRef(generation);
  if (lastGeneration.current !== generation) {
    lastGeneration.current = generation;
    revealed.current.clear();
    revealAttempted.current.clear();
    // The notice names a file, and the file list has just been replaced. It
    // may not even be in the column any more.
    setExpansionError(null);
  }

  /** Bumped when a file hydrates or grows, which is what re-runs the layouts. */
  const [expansion, setExpansion] = useState(0);

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
   * Layouts, recomputed per file only when that file's threads moved — or when
   * the diff under them did.
   *
   * Rebuilding every file's annotation array whenever any thread changes would
   * hand `CodeView` a new array for five hundred untouched files and re-render
   * all of them. So the signature is exactly the fields anchoring reads, and
   * anchoring reads two things, not one: the thread, and the hunks it has to
   * fall inside. `fileDiffSignature` is the second half. Without it, switching
   * to "changes since my last review" leaves every thread with the verdict it
   * got against the *full* diff — and one whose line is no longer in any hunk
   * stays an annotation Pierre silently declines to draw.
   *
   * That signature is a *string of mutable state*, not an identity number,
   * because expanding context hydrates the metadata **in place** — the object
   * grows a whole file's worth of lines without ever becoming a different
   * object. And the revealed-line set is folded in beside it, because the one
   * thing hydration does *not* write anywhere is which of those new lines the
   * renderer has been asked to draw.
   */
  /**
   * The two booleans as one string, so the memo below can depend on their
   * values rather than on the object identity the shell rebuilds each render.
   * They belong in the per-file signature too: a file whose threads and hunks
   * have not moved still needs re-laying out when the diff under them stops
   * being the pull request's own.
   */
  const sidesKey = `${sides.additions ? 'a' : ''}${sides.deletions ? 'd' : ''}`;

  const cache = useRef(new Map<string, { signature: string; layout: FileThreadLayout }>());
  const layouts = useMemo(() => {
    const built = new Map<string, FileThreadLayout>();
    for (const file of files) {
      const threads = session.byPath.get(file.path) ?? [];
      const open = revealed.current.get(file.path);
      const signature =
        `${fileDiffSignature(file)}#${open?.size ?? 0}#${sidesKey}#` +
        threads.map(anchorSignature).join('|');
      const cached = cache.current.get(file.path);
      if (cached !== undefined && cached.signature === signature) {
        built.set(file.path, cached.layout);
        continue;
      }
      const layout =
        threads.length === 0
          ? NO_LAYOUT
          : layoutThreads(threads, fileDiffFor(file), {
              sides,
              metadata: metadata.current,
              revealed: open,
            });
      cache.current.set(file.path, { signature, layout });
      built.set(file.path, layout);
    }
    return built;
    // `expansion` is not read here — it is what tells React the mutable state
    // above has moved. Pierre hydrates in place and fires no callback a
    // consumer can subscribe to, so a render has to be provoked from the
    // outside or the memo would never be asked the question again.
  }, [files, session.byPath, expansion, sidesKey]);

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

  /**
   * The mode every file is actually in, resolved rather than stored.
   *
   * `resolveModeForFile` is what makes the sparse map above safe: a file the
   * reviewer never touched gets its default, and a stored mode that the file no
   * longer offers — the list was replaced, a path that used to be a PNG is now
   * a CSV — falls back to the default rather than rendering a control the file
   * does not have.
   */
  const modes = useMemo(() => {
    const built = new Map<string, string>();
    for (const file of files) {
      built.set(file.path, resolveModeForFile(file, chosenModes.get(file.path)));
    }
    return built;
  }, [files, chosenModes]);

  const changeMode = useCallback((path: string, mode: string) => {
    setChosenModes((previous) => {
      const next = new Map(previous);
      next.set(path, mode);
      return next;
    });
  }, []);

  const items = useMemo(
    () => codeViewItems(files, collapsed, annotationsByPath, modes),
    [files, collapsed, annotationsByPath, modes],
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
    const target = composerFor(path, range, sides);
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

  /**
   * Hunk navigation, as an index into every hunk in the column.
   *
   * Flattened across files so `J` runs off the end of one file into the next,
   * which is how a pull request is read. The cursor is re-anchored whenever it
   * has drifted away from the file the reviewer is actually on — they may have
   * arrived by `j`, by the tree, or by scrolling — so `J` always means "the
   * next hunk from here" rather than "the next hunk from wherever I last was".
   */
  const stops = useMemo(() => hunkStops(files), [files]);
  const hunkCursor = useRef(-1);
  const currentPath = useRef(current.path);
  currentPath.current = current.path;

  useEffect(() => {
    // A new file list invalidates every index into the old one.
    hunkCursor.current = -1;
  }, [stops]);

  useImperativeHandle(
    ref,
    (): DiffColumnHandle => ({
      goToHunk(direction) {
        if (stops.length === 0) return;

        const path = currentPath.current;
        const cursor = hunkCursor.current;
        const anchored =
          cursor >= 0 && (path === null || stops[cursor]?.path === path);

        let next: number;
        if (anchored) {
          next = Math.min(Math.max(cursor + direction, 0), stops.length - 1);
        } else {
          // Land on the current file's first hunk rather than stepping from a
          // position that has nothing to do with where the reviewer is.
          const first = stops.findIndex((stop) => stop.path === path);
          next = first === -1 ? (direction > 0 ? 0 : stops.length - 1) : first;
        }

        hunkCursor.current = next;
        const stop = stops[next];
        if (stop === undefined) return;
        viewer.current?.scrollTo({
          type: 'line',
          id: stop.path,
          lineNumber: stop.line,
          side: stop.side,
          align: 'start',
        });
      },

      goToLine(path, side, line) {
        viewer.current?.scrollTo({
          type: 'line',
          id: path,
          lineNumber: line,
          side,
          align: 'center',
        });
      },

      commentOnSelection() {
        const selection = viewer.current?.getSelectedLines() ?? null;
        if (selection === null) {
          setComposer(null);
          setUnplaceable(
            'Nothing is selected, so there is no line to comment on. Select ' +
              'one or more lines in the number gutter first, or use the "+" ' +
              'that appears there.',
          );
          return;
        }
        openComposer.current(selection.id, selection.range);
      },
    }),
    [stops],
  );

  /**
   * What a rendered file has to say about itself, once per render pass.
   *
   * This is the only channel there is. Pierre hydrates the metadata in place
   * and fires no hydration or expansion callback a consumer of `CodeView` can
   * subscribe to — `onHunkExpand` is wired to the library's own handler and is
   * not on the options a consumer can set — so `onPostRender` is where the
   * question gets asked, and the instance it hands over is what answers it.
   */
  const noticeExpansion = useRef(
    (path: string, fileDiff: FileDiffMetadata, probe: LineProbe) => {},
  );
  noticeExpansion.current = (path, fileDiff, probe) => {
    // A partial diff draws exactly its hunks, which the layout already knows.
    if (fileDiff.isPartial) return;

    const threads = session.byPath.get(path) ?? [];
    if (threads.length === 0) return;

    const drawn = renderedLines(fileDiff);
    let open = revealed.current.get(path);
    let grew = false;

    for (const thread of threads) {
      const line = thread.line;
      // Only the additions side, and only threads with a live line: those are
      // the ones `isLineRenderable` can be asked about at all.
      if (line === null || thread.diffSide !== 'RIGHT' || thread.subjectType !== 'LINE') {
        continue;
      }
      if (isRenderedLine(drawn, 'additions', line) || open?.has(line) === true) continue;

      if (probe.isLineRenderable(line)) {
        if (open === undefined) {
          open = new Set<number>();
          revealed.current.set(path, open);
        }
        open.add(line);
        grew = true;
        continue;
      }

      // Still collapsed. Ask once for it to be drawn: the reviewer has already
      // chosen to expand this file, and a comment sitting invisibly in the
      // middle of the context they just revealed is the exact failure the
      // per-file list exists to prevent.
      const attempt = `${path} ${line}`;
      if (revealAttempted.current.has(attempt)) continue;
      revealAttempted.current.add(attempt);
      probe.revealLine(line);
    }

    // Only when something actually moved. This runs after every render of
    // every mounted file, and an unconditional bump would be a render loop.
    if (grew) setExpansion((count) => count + 1);
  };

  /**
   * The loader, rebuilt only when the two commits move.
   *
   * Keyed on a string rather than on `blobs` itself because the caller builds
   * that object inline; a new identity per render would hand `CodeView` new
   * options every render and re-render every mounted diff.
   */
  const refsKey =
    blobs === null
      ? ''
      : `${blobs.pr.owner}/${blobs.pr.repo}/${blobs.pr.number}@${blobs.baseSha}..${blobs.headSha}`;
  const refs = useRef(blobs);
  refs.current = blobs;
  const loadDiffFiles = useMemo(() => {
    if (refs.current === null) return null;
    const load = createDiffFilesLoader(refs.current, (_path, reason) => {
      setExpansionError(reason);
    });
    // Wrapped so a success can clear the notice. It was only ever set, never
    // unset, so one file that could not be expanded — a binary base side, say
    // — left "…cannot be expanded because the file is not text" at the top of
    // the column for the rest of the session, naming a file the reviewer had
    // long since scrolled past, and reading as a live failure of whatever they
    // were looking at now. The loader rethrows after reporting, so this line
    // is reached only when the expansion actually worked.
    return async (fileDiff: Parameters<typeof load>[0]) => {
      const loaded = await load(fileDiff);
      setExpansionError(null);
      return loaded;
    };
  }, [refsKey]);

  const options = useMemo<CodeViewReactOptions<AnnotationMetadata>>(
    () => ({
      ...CODE_VIEW_OPTIONS,
      // Present only when there is somewhere to load from. Its mere presence
      // is what makes Pierre draw an expander at all, so an always-present
      // loader that always failed would be worse than none.
      ...(loadDiffFiles === null ? {} : { loadDiffFiles }),
      onGutterUtilityClick(range: SelectedLineRange, context: { item: { id: string } }) {
        openComposer.current(context.item.id, range);
      },
      onPostRender(_node: HTMLElement, instance: unknown, phase: string, context: unknown) {
        // 'unmount' fires whenever virtualization recycles an item out of the
        // window. Nothing to read from an instance that is being torn down.
        if (phase === 'unmount' || !isLineProbe(instance)) return;

        const record = context as {
          type?: unknown;
          item?: { id?: unknown; fileDiff?: FileDiffMetadata };
        };
        if (record.type !== 'diff') return;
        const path = record.item?.id;
        const fileDiff = record.item?.fileDiff;
        if (typeof path !== 'string' || fileDiff === undefined) return;

        noticeExpansion.current(path, fileDiff, instance);
      },
    }),
    [loadDiffFiles],
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

  /**
   * The second half of a jump from the Overview.
   *
   * The file scroll above puts the card on screen; this finds the thread inside
   * it. Both halves are needed and only the first is reliable — a thread may be
   * in a collapsed file, inside the closed per-file section, or on a file this
   * column has no card for at all. So the element is looked for over a few
   * frames and, if it never turns up, nothing further happens: the reviewer is
   * on the right file, which is what the list could honestly promise.
   */
  const jumpId = jump?.threadId ?? null;
  const jumpToken = jump?.token ?? 0;
  useEffect(() => {
    if (jumpId === null) return;

    let frame = 0;
    let attempts = 0;

    const reach = () => {
      const container = scroller.current;
      const found =
        container === null
          ? undefined
          : // Matched by attribute value rather than by selector: thread ids
            // are opaque server strings and are not escaped for CSS here.
            [...container.querySelectorAll('[data-thread]')].find(
              (node) => node.getAttribute('data-thread') === jumpId,
            );

      if (found !== undefined) {
        // Resolved threads and every listed one sit inside a closed <details>,
        // where scrolling to them would land on a summary line.
        let box = found.closest('details');
        while (box !== null) {
          box.open = true;
          box = box.parentElement?.closest('details') ?? null;
        }
        // Absent in jsdom, and not worth a polyfill for a scroll.
        if (typeof found.scrollIntoView === 'function') {
          found.scrollIntoView({ block: 'center' });
        }
        return;
      }

      attempts += 1;
      if (attempts < JUMP_FRAMES) frame = requestAnimationFrame(reach);
    };

    frame = requestAnimationFrame(reach);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [jumpId, jumpToken]);

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

      {expansionError !== null && (
        // Pierre catches a rejected `loadDiffFiles`, logs it and leaves the
        // hunk shut — so without this the expander is a control that visibly
        // does nothing.
        <p className="notice" role="alert" data-expansion-error>
          {expansionError}
        </p>
      )}

      {files.length === 0 ? (
        <p className="placeholder">No changed files.</p>
      ) : (
        <CodeView<AnnotationMetadata>
          // Remounted when the file list is replaced wholesale — a refreshed
          // payload, or the switch to "changes since my last review". CodeView
          // keeps the code it first rendered for an item id, so a new patch
          // under an existing path would otherwise leave the old diff on
          // screen under the new headers. Stable across every other render,
          // because the generation is derived from the list's identity.
          key={generation}
          ref={viewer}
          disableWorkerPool
          containerRef={scroller}
          options={options}
          items={items}
          onScroll={handleScroll}
          className="diff-view"
          renderCodeViewFooter={renderTail}
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
                mode={modes.get(file.path) ?? RAW.id}
                onChangeMode={changeMode}
                blobs={blobs}
              />
            );
          }}
        />
      )}
    </main>
  );
}
