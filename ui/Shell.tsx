/**
 * The loaded layout: top bar, resizable rail, diff column.
 *
 * Deliberately the same shape as GitHub's Files-changed tab. A reviewer who
 * arrives here from that page should not have to find anything twice.
 *
 * It also owns the two pieces of state every region shares:
 *
 * - **Which file the review is on.** Neither the rail nor the column can own it
 *   — the tree scrolls the column and the column selects in the tree, so
 *   whichever held it would be asking the other to change and being told about
 *   it in the same breath. `currentFile` explains the rule that stops the loop.
 * - **Which thread is focused.** `n` and `p` move it; `r` and `e` act on it.
 *
 * And it is where the keyboard lands. There is exactly one `keydown` listener
 * on this page and it is installed here, because these shortcuts are global and
 * every surface they drive is a child of this component. What each key *means*
 * is `lib/keymap.ts`; this is only what happens next.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { PrPayload } from '@/lib/messages';
import { DiffColumn, type DiffColumnHandle, type ThreadJump } from './DiffColumn';
import { RailResizer } from './RailResizer';
import { ReviewFooter } from './ReviewFooter';
import { SearchPanel, type SearchMode, type SearchTarget } from './SearchPanel';
import { ShortcutHelp } from './ShortcutHelp';
import { SideRail } from './SideRail';
import { TopBar } from './TopBar';
import { DeniedNotice } from './DeniedNotice';
import { TokenRejectedNotice } from './TokenRejectedNotice';
import { TruncationNotice } from './TruncationNotice';
import { type CurrentFile, NO_FILE, fromCommand, fromScroll, fromTree } from './currentFile';
import { pullRequestUrl } from './githubUrl';
import type { BlobRefs } from './blobLoader';
import { prBaseSha, prPermalink, prViewerIsAuthor, prViewerReviewedAt } from './prNode';
import { type ReviewFile, reviewFiles } from './reviewFiles';
import { ReviewSessionProvider, useReviewSession } from './reviewSession';
import { orderedThreads } from './reviewThreads';
import { ShortcutTargetsProvider, useShortcutTargets } from './shortcutTargets';
import { useCompareDiff } from './useCompareDiff';
import { useKeymap } from './useKeymap';
import { useRailWidth } from './useRailWidth';

/** Which overlay is open. Only ever one: they all want the same keystrokes. */
type Overlay = { kind: 'none' } | { kind: 'help' } | { kind: 'search'; mode: SearchMode };

const NO_OVERLAY: Overlay = { kind: 'none' };

/** Step to the next or previous entry, stopping at the ends. */
function step<T>(items: readonly T[], from: number, direction: 1 | -1): T | undefined {
  if (items.length === 0) return undefined;
  const next = from < 0 ? (direction > 0 ? 0 : items.length - 1) : from + direction;
  return items[Math.min(Math.max(next, 0), items.length - 1)];
}

export function Shell({
  payload,
  retry,
}: {
  payload: PrPayload;
  /** Ask the worker for this pull request again. */
  retry: () => void;
}) {
  return (
    // The session wraps the whole shell rather than the column alone: a
    // resolve has to be visible everywhere at once, and the pending-review
    // state is hydrated here from `viewerLatestReview` before anything can
    // post a comment against the wrong target.
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
    >
      <ShortcutTargetsProvider>
        <ReviewSurface payload={payload} retry={retry} />
      </ShortcutTargetsProvider>
    </ReviewSessionProvider>
  );
}

function ReviewSurface({ payload, retry }: { payload: PrPayload; retry: () => void }) {
  const rail = useRailWidth();
  const session = useReviewSession();
  const targets = useShortcutTargets();

  const wholeDiff = useMemo(() => reviewFiles(payload), [payload]);
  const [current, setCurrent] = useState<CurrentFile>(NO_FILE);
  const [jump, setJump] = useState<ThreadJump | null>(null);
  const [focusedThread, setFocusedThread] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(NO_OVERLAY);

  const column = useRef<DiffColumnHandle>(null);

  /**
   * Narrowing the column to what has landed since the viewer's last review.
   *
   * The base commit comes from `viewerLatestReview`, so a first-time reviewer
   * has none and the toggle is disabled rather than offered. A failed
   * comparison falls back to the whole diff with the reason on screen: an empty
   * column would read as "nothing changed".
   */
  const reviewedAt = prViewerReviewedAt(payload.pullRequest);
  const [sinceLastReview, setSinceLastReview] = useState(false);
  const compare = useCompareDiff({
    payload,
    base: reviewedAt,
    enabled: sinceLastReview,
  });
  const narrowed = compare.status === 'ready';
  const files: readonly ReviewFile[] = narrowed ? compare.files : wholeDiff;

  // Both reducers return the state they were given when the path has not
  // moved, so an echo from the far surface is a bail-out rather than a render.
  const selectFromTree = useCallback((path: string) => {
    setCurrent((state) => fromTree(state, path));
  }, []);
  const selectFromScroll = useCallback((path: string) => {
    setCurrent((state) => fromScroll(state, path));
  }, []);
  /**
   * A move the reviewer asked for without touching either surface.
   *
   * `j`, the jump panel and a thread link all land here. They used to reuse
   * `selectFromTree`, which means "the tree already knows" — so the tree stood
   * still and kept highlighting a file the reviewer had left.
   */
  const selectFromCommand = useCallback((path: string) => {
    setCurrent((state) => fromCommand(state, path));
  }, []);

  /**
   * Jumping to a thread, in two steps.
   *
   * The file first, through the same reducer the tree uses, so the column
   * scrolls its item into place. Then the thread itself, which may not have
   * been in the DOM at all a moment ago. The token is what makes a second jump
   * to a thread on the *same* file act: `fromTree` returns the state it was
   * given when the path has not moved, exactly so echoes do not re-render.
   */
  const jumpToThread = useCallback((threadId: string, path: string) => {
    setCurrent((state) => fromCommand(state, path));
    setFocusedThread(threadId);
    setJump((previous) => ({ threadId, token: (previous?.token ?? 0) + 1 }));
  }, []);

  const paths = useMemo(() => files.map((file) => file.path), [files]);

  /**
   * The two commits the column reads whole files from, for expanding context.
   *
   * The base moves with the diff on screen. While the comparison is showing,
   * the patches are `reviewedAt...head`, so their unchanged context is the
   * file as it stood at the reviewer's last review — expanding against the
   * pull request's own base would splice in lines from a different diff.
   *
   * Null when there is no base commit at all: a payload cached before
   * `baseRefOid` was queried has none, and the column then offers no expander
   * rather than one that cannot work.
   */
  const baseSha = narrowed ? reviewedAt : prBaseSha(payload.pullRequest);
  const blobs = useMemo(
    (): BlobRefs | null =>
      baseSha === null
        ? null
        : { pr: payload.ref, baseSha, headSha: payload.headSha },
    [baseSha, payload.ref, payload.headSha],
  );

  // Read inside the keyboard handlers, which are rebuilt every render but are
  // installed once. Everything they need is here rather than closed over.
  const latest = useRef({ files, paths, current, focusedThread, session });
  latest.current = { files, paths, current, focusedThread, session };

  const moveFile = useCallback((direction: 1 | -1) => {
    const { files: list, current: at } = latest.current;
    const from = at.path === null ? -1 : list.findIndex((f) => f.path === at.path);
    const next = step(list, from, direction);
    if (next !== undefined) selectFromCommand(next.path);
  }, [selectFromCommand]);

  const moveThread = useCallback(
    (direction: 1 | -1, unresolvedOnly: boolean) => {
      const { session: live, paths: order, focusedThread: focus } = latest.current;
      const stops = orderedThreads(live.threads, order).filter(
        ({ thread }) => !unresolvedOnly || !thread.isResolved,
      );
      const from = stops.findIndex(({ thread }) => thread.id === focus);
      const next = step(stops, from, direction);
      if (next === undefined) return;
      jumpToThread(next.thread.id, next.thread.path);
    },
    [jumpToThread],
  );

  /**
   * `r`: put the cursor in the focused thread's reply box.
   *
   * Found in the DOM rather than through a ref, because the thread may be
   * anchored in the diff, listed in the per-file section, or inside a closed
   * `<details>` — three different components, one of which does not exist until
   * the jump above has opened it.
   */
  const replyToFocused = useCallback(() => {
    const id = latest.current.focusedThread;
    if (id === null) return;
    const box = document.querySelector<HTMLTextAreaElement>(`[data-reply-for="${id}"]`);
    if (box === null) return;
    const holder = box.closest('details');
    if (holder !== null) holder.open = true;
    box.focus();
  }, []);

  const toggleResolvedOnFocused = useCallback(() => {
    const { focusedThread: id, session: live } = latest.current;
    if (id === null) return;
    const thread = live.byId.get(id);
    if (thread === undefined) return;
    // The same permission check the button makes, for the same reason: a
    // mutation GitHub will refuse is not a shortcut, it is an error message.
    const next = !thread.isResolved;
    if (next ? !thread.viewerCanResolve : !thread.viewerCanUnresolve) return;
    void live.setResolved(id, next);
  }, []);

  const toggleViewedOnCurrent = useCallback(() => {
    const { current: at, files: list, session: live } = latest.current;
    if (at.path === null) return;
    const file = list.find((f) => f.path === at.path);
    if (file === undefined) return;
    const state = live.viewed.get(file.path) ?? file.viewedState;
    void live.setViewed(file.path, state !== 'VIEWED', state);
  }, []);

  const openOnGitHub = useCallback(() => {
    const href = prPermalink(payload.pullRequest) ?? pullRequestUrl(payload.ref);
    window.open(href, '_blank', 'noopener,noreferrer');
  }, [payload]);

  const goToResult = useCallback(
    (target: SearchTarget) => {
      selectFromCommand(target.path);
      if (target.line !== null && target.side !== null) {
        column.current?.goToLine(target.path, target.side, target.line);
      }
    },
    [selectFromCommand],
  );

  useKeymap({
    'next-file': () => moveFile(1),
    'previous-file': () => moveFile(-1),
    'next-hunk': () => column.current?.goToHunk(1),
    'previous-hunk': () => column.current?.goToHunk(-1),
    'next-thread': () => moveThread(1, false),
    'previous-thread': () => moveThread(-1, false),
    'next-unresolved-thread': () => moveThread(1, true),
    'previous-unresolved-thread': () => moveThread(-1, true),
    'toggle-viewed': toggleViewedOnCurrent,
    'comment-on-line': () => column.current?.commentOnSelection(),
    'reply-to-thread': replyToFocused,
    'toggle-resolved': toggleResolvedOnFocused,
    'file-jump': () => setOverlay({ kind: 'search', mode: 'files' }),
    'search-in-diff': () => setOverlay({ kind: 'search', mode: 'diff' }),
    'shortcut-help': () => setOverlay({ kind: 'help' }),
    'open-in-github': openOnGitHub,
    // Whatever composer or footer is mounted answers these. Nothing mounted
    // means nothing happens, and the key goes back to the browser.
    'submit-comment': () => {
      targets?.run('submit-comment');
    },
    'submit-review': () => {
      targets?.run('submit-review');
    },
  });

  return (
    <div className="shell" data-current-file={current.path ?? ''}>
      <TopBar
        payload={payload}
        compare={{
          active: sinceLastReview && narrowed,
          available: reviewedAt !== null,
          busy: compare.status === 'loading',
          onToggle: () => setSinceLastReview((on) => !on),
        }}
        compareError={compare.status === 'failed' ? compare.message : null}
      />
      <TruncationNotice
        truncated={payload.truncated}
        pr={payload.ref}
        href={prPermalink(payload.pullRequest)}
      />
      <DeniedNotice
        denied={payload.denied}
        pr={payload.ref}
        href={prPermalink(payload.pullRequest)}
      />
      {/* Above the diff rather than in place of it. What is on screen was
          loaded with a token that worked and is still worth reading; only
          writing has stopped. */}
      {session.tokenRejected && <TokenRejectedNotice retry={retry} />}
      <div className="shell-body">
        <SideRail
          width={rail.width}
          payload={payload}
          files={files}
          current={current}
          onSelect={selectFromTree}
          onJumpToThread={jumpToThread}
        />
        <RailResizer {...rail} />
        <DiffColumn
          ref={column}
          files={files}
          // The comparison always comes back as a real unified diff, so while
          // it is showing, the files-endpoint warning would be describing a
          // list that is no longer on screen.
          diff={
            narrowed
              ? { source: 'unified', truncated: false }
              : { source: payload.diff.source, truncated: payload.diff.truncated }
          }
          current={current}
          onScrollTo={selectFromScroll}
          jump={jump}
          blobs={blobs}
        />
      </div>
      <ReviewFooter viewerIsAuthor={prViewerIsAuthor(payload.pullRequest)} />

      {overlay.kind === 'help' && <ShortcutHelp onClose={() => setOverlay(NO_OVERLAY)} />}
      {overlay.kind === 'search' && (
        <SearchPanel
          mode={overlay.mode}
          files={files}
          onChoose={goToResult}
          onClose={() => setOverlay(NO_OVERLAY)}
        />
      )}
    </div>
  );
}
