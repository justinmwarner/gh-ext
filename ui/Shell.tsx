/**
 * The loaded layout: an identity bar, a view switcher, and one of three views.
 *
 * The views are all mounted and the inactive ones are hidden with
 * `visibility`, never `display: none`. Both Pierre surfaces virtualize against
 * a scrollport they measure, and `display: none` takes that measurement to
 * zero — on the way back the column would have to rediscover its own height,
 * and `CodeView` offers nothing that asks it to. `visibility: hidden` leaves
 * the layout exactly where it was, so switching views costs the diff nothing:
 * not its scroll position, not its expanded context, not its mounted rows.
 *
 * It also owns the pieces of state every view shares:
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PrPayload } from '@/lib/messages';
import {
  BOTH_SIDES,
  type DiffScope,
  WHOLE_DIFF,
  resolveScope,
} from '@/lib/review/diffScope';
import { CommitPicker } from './CommitPicker';
import { ConversationsView } from './ConversationsView';
import type { DiffColumnHandle, DiffStyle, ThreadJump } from './DiffColumn';
import { FilesView } from './FilesView';
import { OverviewView } from './OverviewView';
import { ReviewFooter } from './ReviewFooter';
import { ScopeBar } from './ScopeBar';
import { SearchPanel, type SearchMode, type SearchTarget } from './SearchPanel';
import { ShortcutHelp } from './ShortcutHelp';
import { TopBar } from './TopBar';
import { type ReviewView, ViewSwitcher, viewId, viewTabId } from './ViewSwitcher';
import { applyChromeTheme } from './chromeTheme';
import { type CurrentFile, NO_FILE, fromCommand, fromScroll, fromTree } from './currentFile';
import { pullRequestUrl } from './githubUrl';
import type { BlobRefs } from './blobLoader';
import { prBaseSha, prPermalink, prViewerIsAuthor, prViewerReviewedAt } from './prNode';
import { type ReviewFile, changeTotals, reviewFiles } from './reviewFiles';
import { ReviewSessionProvider, useReviewSession } from './reviewSession';
import { orderedThreads } from './reviewThreads';
import { ShortcutTargetsProvider, useShortcutTargets } from './shortcutTargets';
import { useCompareDiff } from './useCompareDiff';
import { useHeadMoved } from './useHeadMoved';
import { useKeymap } from './useKeymap';
import { useGitAttributes } from './useGitAttributes';
import { useSettings } from './useSettings';

/** Which overlay is open. Only ever one: they all want the same keystrokes. */
type Overlay =
  | { kind: 'none' }
  | { kind: 'help' }
  | { kind: 'search'; mode: SearchMode }
  | { kind: 'commits' };

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
  const session = useReviewSession();
  const targets = useShortcutTargets();

  /**
   * Whether the pull request has moved since this payload was read.
   *
   * Here rather than in `usePrPayload`, which owns the load: this is not a
   * fourth load state but a fact *about* the one on screen, and the answer has
   * to be readable next to a session that knows whether a review is open —
   * because that is what decides whether reloading costs the reviewer anything.
   */
  const headMoved = useHeadMoved(payload.ref, payload.headSha);

  const wholeDiff = useMemo(() => reviewFiles(payload), [payload]);
  const [current, setCurrent] = useState<CurrentFile>(NO_FILE);
  const [jump, setJump] = useState<ThreadJump | null>(null);
  const [focusedThread, setFocusedThread] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(NO_OVERLAY);
  const [view, setView] = useState<ReviewView>('files');

  /**
   * How the diff is drawn, from the options page rather than from this page.
   *
   * Both of these — one column or two, and whether whitespace-only changes are
   * hidden — used to be controls here and be forgotten on reload. The argument
   * for that was that a remembered display preference decides what a pull
   * request looks like before the reviewer has opened it, and for ignoring
   * whitespace that means arriving at a diff with lines already taken out of
   * it.
   *
   * That hazard is real and has not gone away; what changed is where the
   * switch is. A setting on the options page is a decision a reviewer made
   * about every review, in the place they already go to change how this
   * extension behaves, next to the sentence saying what it hides — not a
   * button on a file header that happened to still be pressed. `Settings`
   * carries the long version of this.
   *
   * Still nothing else on this page is remembered: not the rail width, not
   * which files are collapsed, not the per-file comparison mode, whose own
   * control says so and says why. Those are answers to *this* pull request.
   * These two are answers to how the reviewer reads diffs.
   */
  const settings = useSettings();
  const diffStyle: DiffStyle = settings.splitView ? 'split' : 'unified';

  /**
   * Hand the whole page over to the chosen theme, or hand it back.
   *
   * Two things at once, and they are the same decision seen from either side of
   * the diff's edge.
   *
   * The attribute tells the stylesheet to stop overriding Pierre's addition and
   * deletion colours, because the reviewer has chosen a theme and those are its
   * job now. The stylesheet carries the long version; in one line, the themes
   * most worth choosing are the ones built for colour vision deficiency, and
   * keeping a Primer red and a Primer green on the added and removed lines
   * would undo exactly the thing they were chosen to do.
   *
   * `applyChromeTheme` extends that same concession to everything *outside* the
   * diff. Recolouring the code and leaving the page around it in GitHub's white
   * was a seam down the middle of one screen — and a worse one than the seam
   * with github.com that the Primer palette exists to avoid, because a reviewer
   * sees both halves of it at once.
   *
   * Both on `<html>`: the attribute because the rule it gates sits on `:root`
   * alongside the rest of the Pierre slots, and the palette because `:root` is
   * where `ui/tokens.css` declares the tokens and therefore the only element an
   * inline property can outrank them on.
   *
   * There is a frame of default palette before this runs — settings arrive from
   * `storage.local`, which is asynchronous, and no synchronous way to read them
   * exists. It lands on the loading state rather than on a drawn diff.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (settings.diffTheme === '') root.removeAttribute('data-syntax-theme');
    else root.setAttribute('data-syntax-theme', settings.diffTheme);
    applyChromeTheme(root, settings.diffTheme);
  }, [settings.diffTheme]);
  /**
   * What the repository declares about its own generated files.
   *
   * Only fetched while the setting that consults it is on — a reviewer who has
   * not asked for generated files to be folded should not have this extension
   * reading extra files out of their repositories. `useGitAttributes` says why
   * it is the root file and no other.
   */
  const gitAttributes = useGitAttributes(
    payload.ref,
    payload.headSha,
    settings.hideGenerated,
  );

  const column = useRef<DiffColumnHandle>(null);

  /**
   * Narrowing the column to some of the pull request's commits.
   *
   * One mechanism with three ways in — a single commit, a range of them, and
   * "since my last review" — because all three are the same request: a compare
   * between two commits. `resolveScope` turns what the reviewer asked for into
   * that pair *against the history in this payload*, so a commit that has been
   * force-pushed away is caught here rather than fetched: GitHub keeps an
   * orphaned commit reachable, so the request would succeed and the reviewer
   * would be reading a diff against history this pull request no longer has.
   *
   * A failed comparison falls back to the whole diff with the reason on
   * screen. An empty column would read as "nothing changed".
   */
  const reviewedAt = prViewerReviewedAt(payload.pullRequest);
  const [scope, setScope] = useState<DiffScope>(WHOLE_DIFF);
  const resolved = useMemo(
    () =>
      resolveScope(scope, {
        commits: payload.commits,
        prBase: prBaseSha(payload.pullRequest),
        prHead: payload.headSha,
        reviewedAt,
      }),
    [scope, payload.commits, payload.pullRequest, payload.headSha, reviewedAt],
  );
  const compare = useCompareDiff({ payload, scope: resolved });

  /**
   * Whether the narrowed diff is what is actually on screen.
   *
   * Not the same question as "did the reviewer ask for one". While the request
   * is in flight, or after it failed, the whole diff is showing — and every
   * derived value below has to describe *that*, or the column would be told it
   * is looking at commits it is not.
   */
  const narrowed = resolved.kind === 'narrowed' && compare.status === 'ready';
  const files: readonly ReviewFile[] = narrowed ? compare.files : wholeDiff;

  /**
   * Which sides of what is on screen number their lines like the pull
   * request's own diff.
   *
   * Threads and the composer both read it. Both would otherwise place a line
   * number from one diff onto a row of another, which is the one failure here
   * that shows no symptom at all.
   */
  const sides = narrowed ? resolved.sides : BOTH_SIDES;

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
    // The view first. Every caller of this is asking to be shown the thread in
    // its code — the Conversations list, the keyboard, a jump-panel result —
    // and none of them can do that from a view the diff is not in.
    setView('files');
    setCurrent((state) => fromCommand(state, path));
    setFocusedThread(threadId);
    setJump((previous) => ({ threadId, token: (previous?.token ?? 0) + 1 }));
  }, []);

  const paths = useMemo(() => files.map((file) => file.path), [files]);

  /**
   * The two commits the column reads whole files from, for expanding context.
   *
   * **Both** move with the diff on screen. While a narrowed diff is showing,
   * the patches run between the scope's two commits, so their unchanged
   * context is those files — expanding against the pull request's own base or
   * head would splice in lines from a different diff, under hunk headers that
   * still line up.
   *
   * Null when there is no base commit at all: a payload cached before
   * `baseRefOid` was queried has none, and the column then offers no expander
   * rather than one that cannot work.
   */
  const baseSha = narrowed ? resolved.range.base : prBaseSha(payload.pullRequest);
  const headSha = narrowed ? resolved.range.head : payload.headSha;
  const blobs = useMemo(
    (): BlobRefs | null =>
      baseSha === null ? null : { pr: payload.ref, baseSha, headSha },
    [baseSha, payload.ref, headSha],
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
      setView('files');
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

  // Only what is outstanding. The badge exists because putting the threads
  // behind a view means a reviewer can be reading the diff with comments they
  // cannot see, and resolved ones are not that.
  const unresolved = useMemo(
    () => session.threads.filter((thread) => !thread.isResolved).length,
    [session.threads],
  );

  // What the bar above the diff counts: the list the column is drawing, which
  // while a comparison is showing is that comparison rather than the pull
  // request.
  const changed = useMemo(() => changeTotals(files), [files]);

  return (
    <div className="shell" data-current-file={current.path ?? ''} data-view={view}>
      {/* Everything this page cannot vouch for — a moved head, a capped list,
          a refused field, a dead token, an account that may only read — used to
          be a stack of banners between here and the diff. They are all in the
          bar now, behind one control that names the worst of them;
          `NoticeCenter` explains the trade. */}
      <TopBar
        payload={payload}
        retry={retry}
        movedTo={headMoved.movedTo}
        onDismissMoved={headMoved.dismiss}
      />

      <div className="shell-body">
        <ViewSwitcher active={view} unresolved={unresolved} onSelect={setView} />

        {/* One grid cell, three views stacked in it. `visibility` rather than
            `display`, and rather than not rendering at all: the diff column
            measures its own scrollport, and anything that takes that
            measurement to zero costs the reviewer their scroll position and
            every line of context they expanded to get there. */}
        <div className="views">
          <div
            className="view"
            id={viewId('files')}
            role="tabpanel"
            aria-labelledby={viewTabId('files')}
            style={{ visibility: view === 'files' ? 'visible' : 'hidden' }}
          >
            {/* Inside the Files view rather than above all three, because what
                it describes is the column underneath it. On the Overview and
                the Conversations there is no diff on screen to be wrong about,
                and a bar up there was one more row between the reviewer and
                the thing it names. */}
            <ScopeBar
              scope={resolved}
              commits={payload.commits}
              chosen={scope}
              onScope={setScope}
              changed={changed}
              commitCount={payload.commits.length}
              commitsTruncated={payload.truncated.commits}
              sinceReviewAvailable={reviewedAt !== null}
              sinceReviewActive={scope.kind === 'since-review'}
              busy={compare.status === 'loading'}
              requestError={compare.status === 'failed' ? compare.message : null}
              onOpenPicker={() => setOverlay({ kind: 'commits' })}
              onSinceReview={() => {
                setScope((current) =>
                  current.kind === 'since-review' ? WHOLE_DIFF : { kind: 'since-review' },
                );
              }}
              onShowAll={() => setScope(WHOLE_DIFF)}
            />

            <FilesView
              payload={payload}
              files={files}
              current={current}
              onSelectFromTree={selectFromTree}
              onSelectFromScroll={selectFromScroll}
              jump={jump}
              blobs={blobs}
              // The comparison always comes back as a real unified diff, so
              // while it is showing, the files-endpoint warning would be
              // describing a list that is no longer on screen.
              diff={
                narrowed
                  ? { source: 'unified', truncated: false }
                  : { source: payload.diff.source, truncated: payload.diff.truncated }
              }
              sides={sides}
              diffStyle={diffStyle}
              syntaxTheme={settings.diffTheme}
              ignoreWhitespace={settings.ignoreWhitespace}
              hideGenerated={settings.hideGenerated}
              gitAttributes={gitAttributes}
              columnRef={column}
            />
          </div>

          <div
            className="view view-scrolls"
            id={viewId('conversations')}
            role="tabpanel"
            aria-labelledby={viewTabId('conversations')}
            tabIndex={0}
            style={{ visibility: view === 'conversations' ? 'visible' : 'hidden' }}
          >
            <ConversationsView paths={paths} onGoTo={jumpToThread} />
          </div>

          <div
            className="view view-scrolls"
            id={viewId('overview')}
            role="tabpanel"
            aria-labelledby={viewTabId('overview')}
            tabIndex={0}
            style={{ visibility: view === 'overview' ? 'visible' : 'hidden' }}
          >
            <OverviewView
              payload={payload}
              // Scope *and* switch. Narrowing the diff without moving to it
              // would leave the reviewer on the Overview looking at a list,
              // with the thing they asked for on a view they cannot see.
              onReviewCommit={(commit) => {
                setScope({ kind: 'commits', from: commit.oid, to: commit.oid });
                setView('files');
              }}
            />
          </div>
        </div>
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
      {overlay.kind === 'commits' && (
        <CommitPicker
          commits={payload.commits}
          selected={scope.kind === 'commits' ? scope : null}
          onPick={(from, to) => setScope({ kind: 'commits', from, to })}
          onShowAll={() => {
            setScope(WHOLE_DIFF);
            setOverlay(NO_OVERLAY);
          }}
          onClose={() => setOverlay(NO_OVERLAY)}
        />
      )}
    </div>
  );
}
