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
import type { ShortcutAction } from '@/lib/keymap';
import { DASHBOARD_HASH } from '@/lib/github/pr-url';
import type { PrPayload } from '@/lib/messages';
import {
  BOTH_SIDES,
  type DiffScope,
  WHOLE_DIFF,
  resolveScope,
} from '@/lib/review/diffScope';
import { type FileFilters, NO_FILTERS } from '@/lib/review/fileFilters';
import { AS_IS, type Arrangement, arrange, rankOf } from '@/lib/review/readingOrder';
import { CommitPicker } from './CommitPicker';
import { ConversationsView } from './ConversationsView';
import type { DiffColumnHandle, DiffStyle, LineJump, ThreadJump } from './DiffColumn';
import { FilesView, type FilesViewHandle } from './FilesView';
import type { FindTarget } from './FindPanel';
import { OverviewView } from './OverviewView';
import { ReviewFooter } from './ReviewFooter';
import { ScopeBar } from './ScopeBar';
import { SearchPanel, type SearchTarget } from './SearchPanel';
import { ShortcutHelp } from './ShortcutHelp';
import { TopBar } from './TopBar';
import { type ReviewView, ViewSwitcher, viewId, viewTabId } from './ViewSwitcher';
import {
  type CurrentFile,
  NO_FILE,
  fromCommand,
  fromJump,
  fromScroll,
  fromTree,
} from './currentFile';
import { pullRequestUrl } from './githubUrl';
import type { BlobRefs } from './blobLoader';
import { prBaseSha, prPermalink, prViewerIsAuthor, prViewerReviewedAt } from './prNode';
import { type ReviewFile, changeTotals, reviewFiles } from './reviewFiles';
import { ReviewSessionProvider, useReviewSession } from './reviewSession';
import { orderedThreads, threadStep } from './reviewThreads';
import { ShortcutTargetsProvider, useShortcutTargets } from './shortcutTargets';
import { DiffSkeleton } from './DiffSkeleton';
import { useCompareDiff } from './useCompareDiff';
import { useHeadMoved } from './useHeadMoved';
import { ownershipNote, ownershipRefused, useCodeOwners } from './useCodeOwners';
import { useFileFilter } from './useFileFilter';
import { useKeymap } from './useKeymap';
import { useGitAttributes } from './useGitAttributes';
import { useSettings } from './useSettings';

/** Which overlay is open. Only ever one: they all want the same keystrokes. */
type Overlay =
  | { kind: 'none' }
  | { kind: 'help' }
  | { kind: 'file-jump' }
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
  const [lineJump, setLineJump] = useState<LineJump | null>(null);
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
   * Still almost nothing else on this page is remembered: not which files are
   * collapsed, not the per-file comparison mode, whose own control says so and
   * says why. Those are answers to *this* pull request. These two are answers
   * to how the reviewer reads diffs.
   *
   * The rail's width used to be on that list and is not any more. It turned out
   * not to be an answer to a pull request at all — it is an answer to a
   * monitor, and it is the same answer on every pull request opened on that
   * monitor. So it is kept, under its own key, with no control anywhere for a
   * reviewer to set it twice: `RAIL_WIDTH_KEY` carries the argument and
   * `FilesView` does the keeping.
   */
  const settings = useSettings();
  const diffStyle: DiffStyle = settings.splitView ? 'split' : 'unified';

  /**
   * The file filters: what the reviewer asked this review to leave out.
   *
   * Here rather than in `FilesView`, for two reasons. Everything that walks the
   * files reads them — the column, the tree, `j`/`k`, `n`/`p`, `Mod+K`, the bar
   * above the diff — and `FilesView` is unmounted while a commit comparison
   * loads, which would throw them away on every press of a commit tab. Never
   * stored: see `FileFilters`.
   */
  const [filters, setFilters] = useState<FileFilters>(NO_FILTERS);

  /**
   * How the review is laid out: folder order or most changed first, and the
   * file types sent to the end.
   *
   * Here for the reason the filters are. Every surface that walks the files
   * reads it, and it has to outlast `FilesView`, which is unmounted while a
   * commit comparison loads. Never stored either: like a filter, it is an
   * answer to this pull request, so every review opens in folder order.
   */
  const [arrangement, setArrangement] = useState<Arrangement>(AS_IS);

  /**
   * What the repository declares about its own generated files.
   *
   * Only fetched while something that consults it is on — the setting that
   * folds generated files, or the filter that hides them. A reviewer who has
   * asked for neither should not have this extension reading extra files out
   * of their repositories. `useGitAttributes` says why it is the root file and
   * no other.
   */
  const gitAttributes = useGitAttributes(
    payload.ref,
    payload.headSha,
    settings.hideGenerated || filters.hideGenerated,
  );

  /**
   * Who owns what, for "Show only files you own".
   *
   * At the pull request's own base rather than a narrowed comparison's, because
   * that is the file GitHub applies to the pull request. Asked only once the
   * filter is turned on; `useCodeOwners` says why, and why it then keeps the
   * answer.
   */
  const owners = useCodeOwners(payload.ref, prBaseSha(payload.pullRequest), filters.onlyOwned);
  const ownership = useMemo(
    () => ownershipNote({ ownership: owners.ownership }),
    [owners.ownership],
  );

  /**
   * A filter asked for something the repository does not have, or that could
   * not be read this time.
   *
   * Left on, "only files you own" would hide every file on the strength of
   * nothing and call that the answer. Turned off, the row it lives on keeps
   * the sentence saying why — the hook keeps its answer after the filter goes
   * — so the box unticking itself is explained where the reviewer is looking.
   *
   * Twice, and both are needed. `effective` is what every surface reads, and
   * it is derived during render so that no frame draws the funnel on over a
   * "Showing 40 of 40 files" the filter was never going to change; the effect
   * then puts the stored choice in step, so that turning the filter on again
   * is a press on an unticked box — which is what asks again after a failure.
   */
  const refused = ownershipRefused(owners.state);
  const effective = useMemo(
    () => (refused && filters.onlyOwned ? { ...filters, onlyOwned: false } : filters),
    [refused, filters],
  );
  useEffect(() => {
    if (!filters.onlyOwned || !refused) return;
    setFilters((current) => ({ ...current, onlyOwned: false }));
  }, [filters.onlyOwned, refused]);

  const column = useRef<DiffColumnHandle>(null);
  const filesView = useRef<FilesViewHandle>(null);

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
   * `files` in the order the review is read, each file's place in it, and the
   * groups read last.
   *
   * The one decision about order, made once, here. The list is what walks:
   * `j`/`k`, `n`/`p`, `Mod+K` and the Conversations list all read it. The
   * rank goes to `FilesView` beside the folder-ordered `files`, for the column
   * and the find panel, which cannot be handed a re-sorted copy. `FilesView`
   * says why. The groups go to the tree, which draws them at its foot. In
   * folder order with nothing read last, all three are what they would be
   * without this: the list is `files` itself, and there is no rank.
   */
  const arranged = useMemo(() => arrange(files, arrangement), [files, arrangement]);
  const ordered = arranged.files;
  const rank = useMemo(() => (ordered === files ? null : rankOf(ordered)), [ordered, files]);
  const groups = useMemo(
    () =>
      arranged.groups.map((group) => ({
        type: group.type,
        paths: group.files.map((file) => file.path),
      })),
    [arranged],
  );

  /**
   * The reviewer asked for a narrowed diff and it has not arrived.
   *
   * Distinguished from a *failed* one, which keeps the fallback above: an
   * empty column would read as "nothing changed", so a failure shows the whole
   * pull request with the reason beside it in `ScopeBar`. A pending one showed
   * the whole pull request too, and that was never a decision — it is what
   * `narrowed` being false happens to do. Pressing a commit tab flashed every
   * file and then replaced the list, which reads as the control misfiring.
   *
   * The column is unmounted for the wait rather than hidden behind the
   * skeleton, and that is affordable here for a reason the comment on `.views`
   * below does not cover: a compare replaces the file list wholesale, which
   * changes `DiffColumn`'s generation and remounts the viewer anyway. There is
   * no scroll position or expanded context left to protect.
   */
  const awaitingDiff = resolved.kind === 'narrowed' && compare.status === 'loading';

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
   * Where a filter sends the review when it hides the file being read.
   *
   * A command, because it is one: the column has to scroll to the file it is
   * given, which is what `fromCommand` asks of it. Nowhere at all when the
   * filters hide every file — a current file would be kept on screen by the
   * very rule that keeps the reviewer's file in view, and the column would be
   * showing one file under a sentence saying it was showing none.
   */
  /** The file a composer is open on, which no filter may take out. */
  const [composing, setComposing] = useState<string | null>(null);

  const moveTo = useCallback((path: string | null) => {
    if (path === null) setCurrent(NO_FILE);
    else setCurrent((state) => fromCommand(state, path));
  }, []);

  const filter = useFileFilter({
    // In reading order, so a filter that hides the file being read moves the
    // review on to the next file in that order.
    files: ordered,
    filters: effective,
    setFilters,
    current,
    moveTo,
    gitAttributes,
    generatedPatterns: settings.generatedPatterns,
    owned: owners.owned,
    composing,
    chosenTypes: arrangement.last,
  });
  /**
   * The files the review is walking: `files` less what the filters hide.
   *
   * What `j`/`k`, `Mod+K` and the bar above the diff all read. The column, the
   * tree and the find panel are handed the whole list and `filter.hidden`
   * beside it instead — see `FilesView` for why each needs the whole one — and
   * `n`/`p` walk every thread in order and pass over the hidden ones by name,
   * so they still know where the focused one was.
   */
  const shownFiles = filter.shown;

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

  // Every file, hidden ones included, in reading order. What orders the
  // threads — `n`/`p` skip those in hidden files by name, and the
  // Conversations view keeps them, in their place, saying why the column has
  // no card for them.
  const paths = useMemo(() => ordered.map((file) => file.path), [ordered]);

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
  const latest = useRef({
    files: shownFiles,
    paths,
    current,
    focusedThread,
    session,
    hidden: filter.hidden,
  });
  latest.current = {
    files: shownFiles,
    paths,
    current,
    focusedThread,
    session,
    hidden: filter.hidden,
  };

  const moveFile = useCallback((direction: 1 | -1) => {
    const { files: list, current: at } = latest.current;
    const from = at.path === null ? -1 : list.findIndex((f) => f.path === at.path);
    const next = step(list, from, direction);
    if (next !== undefined) selectFromCommand(next.path);
  }, [selectFromCommand]);

  const moveThread = useCallback(
    (direction: 1 | -1, unresolvedOnly: boolean) => {
      const { session: live, paths: order, focusedThread: focus, hidden } = latest.current;
      // Threads in a file the filters hide are skipped, as the file is by `j`:
      // the review is walking what it is showing. The Conversations view still
      // lists them, and following one from there is what brings the file back.
      // From the focused thread's place in the whole order, so a focused thread
      // that has since stopped qualifying is still where the walk starts.
      const next = threadStep(
        orderedThreads(live.threads, order),
        focus,
        direction,
        ({ thread }) => (!unresolvedOnly || !thread.isResolved) && !hidden.has(thread.path),
      );
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

  /**
   * Go to a result.
   *
   * A whole-file result is an ordinary command: the column scrolls to the card
   * and the tree follows. A result on a *line* is not, and the difference is
   * the bug behind "I had to click it twice" — `fromCommand` starts `reach`, a
   * correcting loop that scrolls to the top of the card over many frames, and
   * a single scroll to a line cannot win against it. So a line result uses
   * `fromJump`, which has the tree follow and leaves the scrolling to the
   * journey below. See `ui/DiffColumn.tsx`'s `LineJump`.
   */
  const goToResult = useCallback(
    (target: SearchTarget) => {
      setView('files');
      if (target.line !== null && target.side !== null) {
        setCurrent((state) => fromJump(state, target.path));
        setLineJump((last) => ({
          path: target.path,
          side: target.side as 'additions' | 'deletions',
          line: target.line as number,
          // A new token every time, so choosing the same result twice is two
          // journeys rather than one effect that never re-runs.
          token: (last?.token ?? 0) + 1,
        }));
        return;
      }
      selectFromCommand(target.path);
    },
    [selectFromCommand],
  );

  /**
   * A find-panel result, which is `goToResult` plus one decision.
   *
   * Moving through the list only scrolls, so the reviewer can walk twenty
   * matches with one key and watch the diff follow. Choosing one hands the
   * keyboard over, because at that point they have stopped searching and
   * started reading. The jump cannot make that distinction itself — it never
   * touches focus, which is exactly why the walking half works.
   */
  const goToFindResult = useCallback(
    (target: FindTarget) => {
      goToResult(target);
      if (target.focusDiff) column.current?.focusColumn();
    },
    [goToResult],
  );

  /**
   * Offer a keystroke to the card the reviewer is on before the column takes it.
   *
   * `J`, `K` and `c` mean the same thing on every card and are answered in two
   * different places, because a card showing a comparison has no rows for the
   * column to move between. A rendered Markdown document claims them for its
   * own path — see `ui/shortcutTargets.tsx` for why the claim is scoped — and
   * anything that does not answer falls through to the diff, which is where
   * these have always gone.
   */
  const onCurrentCard = (action: ShortcutAction): boolean => {
    const path = latest.current.current.path;
    return path !== null && (targets?.run(action, path) ?? false);
  };

  // The second argument is the one binding the reviewer can hand back to the
  // browser. Only `Mod+F` answers to it — `/` still opens the diff search — so
  // releasing it can never leave the search unreachable.
  useKeymap({
    'next-file': () => moveFile(1),
    'previous-file': () => moveFile(-1),
    'next-hunk': () => {
      if (!onCurrentCard('next-hunk')) column.current?.goToHunk(1);
    },
    'previous-hunk': () => {
      if (!onCurrentCard('previous-hunk')) column.current?.goToHunk(-1);
    },
    'next-thread': () => moveThread(1, false),
    'previous-thread': () => moveThread(-1, false),
    'next-unresolved-thread': () => moveThread(1, true),
    'previous-unresolved-thread': () => moveThread(-1, true),
    'toggle-viewed': toggleViewedOnCurrent,
    'comment-on-line': () => {
      if (!onCurrentCard('comment-on-line')) column.current?.commentOnSelection();
    },
    'reply-to-thread': replyToFocused,
    'toggle-resolved': toggleResolvedOnFocused,
    'file-jump': () => setOverlay({ kind: 'file-jump' }),
    // The rail, not an overlay. `/` and `Mod+F` open a panel that stays open
    // while its results are walked, which is the whole difference between
    // finding one thing and finding all of them.
    'search-in-diff': () => {
      setView('files');
      filesView.current?.openFind();
    },
    'shortcut-help': () => setOverlay({ kind: 'help' }),
    'open-in-github': openOnGitHub,
    // The hash, not a navigation. The dashboard is a route on this same page,
    // so changing the fragment is the whole trip — no reload, no second tab,
    // and Back returns to the pull request that was being read.
    'open-dashboard': () => {
      window.location.hash = DASHBOARD_HASH;
    },
    // Whatever composer or footer is mounted answers these. Nothing mounted
    // means nothing happens, and the key goes back to the browser.
    'submit-comment': () => {
      targets?.run('submit-comment');
    },
    'submit-review': () => {
      targets?.run('submit-review');
    },
  }, { releaseFindKey: settings.releaseFindKey });

  // Only what is outstanding. The badge exists because putting the threads
  // behind a view means a reviewer can be reading the diff with comments they
  // cannot see, and resolved ones are not that.
  const unresolved = useMemo(
    () => session.threads.filter((thread) => !thread.isResolved).length,
    [session.threads],
  );

  // What the bar above the diff counts: the list the column is drawing, which
  // while a comparison is showing is that comparison rather than the pull
  // request, and while a filter is on is what the filter left.
  const changed = useMemo(() => changeTotals(shownFiles), [shownFiles]);

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
              // Against the list on screen before the filters, which is the
              // comparison's when one is showing: "2 of 3" means two of the
              // three files in that commit, not two of the pull request's forty.
              filteredFrom={filter.filtering ? files.length : null}
              onOpenFilters={() => filesView.current?.openFilters()}
            />

            {awaitingDiff ? (
              <DiffSkeleton />
            ) : (
            <FilesView
              payload={payload}
              files={files}
              current={current}
              onSelectFromTree={selectFromTree}
              onSelectFromScroll={selectFromScroll}
              jump={jump}
              lineJump={lineJump}
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
              lineDiff={settings.lineDiff}
              ignoreWhitespace={settings.ignoreWhitespace}
              hideGenerated={settings.hideGenerated}
              // Passed unconditionally; `DiffColumn` consults them only while
              // `hideGenerated` is on, which is where that rule belongs — it is
              // a rule about folding, not about what this component hands over.
              generatedPatterns={settings.generatedPatterns}
              collapseTree={settings.collapseTree}
              gitAttributes={gitAttributes}
              hidden={filter.hidden}
              filters={effective}
              facets={filter.facets}
              onFilters={filter.change}
              filtering={filter.filtering}
              ownership={ownership}
              onFiltersOpen={filter.menuOpen}
              rank={rank}
              arrangement={arrangement}
              groups={groups}
              onArrange={setArrangement}
              onComposing={setComposing}
              columnRef={column}
              ref={filesView}
              onFindResult={goToFindResult}
            />
            )}
          </div>

          <div
            className="view view-scrolls"
            id={viewId('conversations')}
            role="tabpanel"
            aria-labelledby={viewTabId('conversations')}
            tabIndex={0}
            style={{ visibility: view === 'conversations' ? 'visible' : 'hidden' }}
          >
            <ConversationsView paths={paths} hidden={filter.hidden} onGoTo={jumpToThread} />
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
      {overlay.kind === 'file-jump' && (
        <SearchPanel
          files={shownFiles}
          unsearched={filter.hidden.size}
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
