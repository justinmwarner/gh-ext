/**
 * The review state every surface on the page shares.
 *
 * Threads live here rather than in the diff column because three regions need
 * them — the annotations, the per-file list of threads the diff cannot show,
 * and the composer that adds to them — and because a resolve has to be visible
 * everywhere at once.
 *
 * Two rules run through all of it:
 *
 * - **Optimistic, with a real rollback.** A resolve that silently reverts is
 *   worse than one that never happened: the reviewer believes the thread is
 *   handled and moves on. So every optimistic change records what it displaced,
 *   puts it back on failure, and says so.
 * - **Nothing here calls `fetch`.** The worker holds the token and the client.
 *   Every mutation goes out as a `mutate` message and comes back classified.
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ADD_REPLY,
  ADD_THREAD,
  DELETE_REVIEW,
  MARK_VIEWED,
  RESOLVE_THREAD,
  START_REVIEW,
  SUBMIT_REVIEW,
  UNMARK_VIEWED,
  UNRESOLVE_THREAD,
} from '@/lib/github/mutations';
import type {
  FileViewedState,
  ReviewComment,
  ReviewEvent,
  ReviewThread,
} from '@/lib/github/types';
import { type JsonValue, type PrRef, type PullRequestNode, message } from '@/lib/messages';
import type { DraftStore } from '@/lib/review/drafts';
import { type PendingReviewState, initialState, reduce } from '@/lib/review/pending-review';
import type { CommentAnchor } from '@/lib/review/selection';
import { request } from './background';
import { draftStore } from './draftStore';

/** The failure key for a comment that has no thread to hang off yet. */
export const NEW_THREAD = 'new-thread';

/**
 * Failure keys for the review itself.
 *
 * Two, not one, because the two controls are never on screen together: the
 * footer only exists while a review is pending, so a failure to *open* one has
 * nowhere to appear except the top bar.
 */
export const REVIEW_START = 'review-start';
export const REVIEW_SUBMIT = 'review-submit';

/** The failure key for one file's viewed checkbox. */
export const viewedKey = (path: string): string => `viewed:${path}`;

/**
 * GitHub said yes and then did not say what it had made.
 *
 * Its own sentence, because it is the same problem wherever it happens and the
 * reviewer's move is the same: try again.
 */
const NO_REVIEW_ID =
  'GitHub accepted the request but returned no review id, so there is nothing ' +
  'for comments to attach to. Try again.';

/** What `openReview` found. The two failures need different words. */
type OpenReviewResult =
  | { ok: true; reviewId: string }
  | { ok: false; kind: 'refused'; message: string }
  | { ok: false; kind: 'no-id' };

/**
 * The same, plus whether the review was already there.
 *
 * `joined` changes what the caller may do with it. A review this page opened
 * holds exactly what this page put in it, so publishing it is safe. One that
 * was already open may hold comments made elsewhere, and submitting it would
 * send those too.
 */
type JoinReviewResult =
  | { ok: true; reviewId: string; joined: boolean }
  | { ok: false; kind: 'refused'; message: string }
  | { ok: false; kind: 'no-id' };

/**
 * The events a reviewer can submit.
 *
 * `DISMISS` is a member of `PullRequestReviewEvent` but is not a reviewer
 * action — it is how an author or maintainer dismisses somebody else's review —
 * so it is excluded here rather than offered and then explained.
 */
export type SubmitEvent = Exclude<ReviewEvent, 'DISMISS'>;

export interface NewThreadInput {
  path: string;
  body: string;
  anchor: CommentAnchor;
}

export interface ReviewSessionValue {
  /** The pull request's node id — what a review is opened against. */
  prId: string;
  prRef: PrRef;
  threads: readonly ReviewThread[];
  byPath: ReadonlyMap<string, readonly ReviewThread[]>;
  byId: ReadonlyMap<string, ReviewThread>;
  pending: PendingReviewState;
  /**
   * Threads holding a comment queued on the pending review, and so not visible
   * to anyone but the reviewer until it is submitted.
   *
   * What this session queued, which is not necessarily all of it: a resumed
   * review may hold comments made elsewhere. Treat it as "known unposted", and
   * see `pendingCountLabel` for how the same limit is worded on the footer.
   */
  unpublished: ReadonlySet<string>;
  drafts: DraftStore;
  /**
   * Keyed by thread id, by `NEW_THREAD` for the composer, by `REVIEW_START` /
   * `REVIEW_SUBMIT` for the review itself, and by `viewedKey(path)`.
   */
  failures: ReadonlyMap<string, string>;
  /** Reply bodies still in flight, keyed by thread id. */
  sending: ReadonlyMap<string, string>;
  /**
   * Viewed states this session has changed, keyed by path.
   *
   * An override layer rather than a copy: a path with no entry is still
   * whatever the payload said, so nothing has to be seeded or kept in step.
   */
  viewed: ReadonlyMap<string, FileViewedState>;
  /** Paths whose viewed mutation has not answered yet. */
  viewedInFlight: ReadonlySet<string>;
  /** Threads whose resolve mutation has not answered yet. */
  resolveInFlight: ReadonlySet<string>;
  /**
   * Whether GitHub has rejected the token since this page loaded.
   *
   * Page-level rather than per-control because that is what it is: an expired
   * or revoked token fails everything, and reporting it as "this reply failed"
   * in whichever box was pressed leaves the reviewer retrying controls instead
   * of fixing the one thing that is wrong.
   */
  tokenRejected: boolean;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  reply(threadId: string, body: string): Promise<boolean>;
  postThread(input: NewThreadInput): Promise<boolean>;
  /** Open a PENDING review for later comments to attach to. */
  startReview(): Promise<boolean>;
  /** Submit the pending review. False leaves it pending, untouched. */
  submitReview(event: SubmitEvent, body: string): Promise<boolean>;
  /** Delete the pending review, on GitHub as well as here. */
  discardReview(): Promise<boolean>;
  /** `from` is what to restore if GitHub refuses. */
  setViewed(path: string, viewed: boolean, from: FileViewedState): Promise<void>;
  clearFailure(key: string): void;
}

const ReviewSessionContext = createContext<ReviewSessionValue | null>(null);

export function useReviewSession(): ReviewSessionValue {
  const session = useContext(ReviewSessionContext);
  if (session === null) {
    throw new Error('useReviewSession must be used inside a ReviewSessionProvider');
  }
  return session;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A usable review id, or null. An empty one is worse than none. */
const reviewIdOf = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const id = value['id'];
  return typeof id === 'string' && id !== '' ? id : null;
};

/**
 * The id of the review the viewer has open on the server, if any.
 *
 * Two fields, in this order, because they do not mean the same thing:
 *
 * - `viewerPendingReview` is the worker's own lookup — it asked GitHub directly
 *   for a review in PENDING state. This is the reliable answer.
 * - `viewerLatestReview` is "the latest review *given* from the viewer", and a
 *   PENDING review has not been given to anyone. It is read second, and only
 *   when it *is* pending, both because a payload cached before the lookup
 *   existed still carries it and because it costs nothing to accept.
 *
 * Order matters when both are set: `viewerLatestReview` may be last week's
 * approval while a review is open right now. Comments belong on the open one.
 */
export function openReviewId(node: PullRequestNode | undefined | null): string | null {
  // `findOpenReview` reads this off a re-read of the pull request, on a path
  // that has already failed once, and what comes back crossed `sendMessage` as
  // JSON. A throw here escapes `postThread` unhandled, which leaves the
  // composer stuck on "Posting…" with no way back and the comment in limbo.
  if (!isRecord(node)) return null;

  const found = reviewIdOf(node['viewerPendingReview']);
  if (found !== null) return found;

  const latest = node['viewerLatestReview'];
  return isRecord(latest) && latest['state'] === 'PENDING' ? reviewIdOf(latest) : null;
}

/**
 * The review the viewer already has open on the server, if it is still pending.
 *
 * A reviewer who started a review in GitHub's own UI and then came here has an
 * open PENDING review this page knows nothing about. Every way this page writes
 * a comment begins by opening a review, and GitHub allows exactly one — so
 * without this, the reviewer can neither start a review nor post a comment, and
 * the only thing on screen is "User can only have one pending review".
 */
export function initialPendingReview(node: PullRequestNode): PendingReviewState {
  const reviewId = openReviewId(node);
  if (reviewId === null) return initialState();

  // Straight through the machine rather than around it: `review-resumed` is
  // the transition that exists for exactly this, and it declines to clobber a
  // review this session already started.
  return reduce(initialState(), { type: 'review-resumed', reviewId, commentCount: 0 });
}

function readPerson(value: unknown): ReviewComment['author'] {
  if (!isRecord(value)) return null;
  const login = value['login'];
  if (typeof login !== 'string') return null;
  const avatarUrl = value['avatarUrl'];
  return { login, avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : '' };
}

/** One comment out of a mutation payload, or null if it is not one. */
function readComment(value: unknown): ReviewComment | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const body = value['body'];
  if (typeof id !== 'string' || typeof body !== 'string') return null;
  return {
    id,
    author: readPerson(value['author']),
    body,
    createdAt: typeof value['createdAt'] === 'string' ? value['createdAt'] : '',
    url: typeof value['url'] === 'string' ? value['url'] : '',
  };
}

/**
 * A whole thread out of `addPullRequestReviewThread`.
 *
 * Validated rather than cast. GitHub answers a partly-failed mutation with
 * HTTP 200 and nulls in the payload, and a half-built thread pushed into state
 * renders as a comment with no body — which reads as data loss.
 */
function readThread(value: unknown): ReviewThread | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const path = value['path'];
  if (typeof id !== 'string' || typeof path !== 'string') return null;

  const number = (key: string): number | null =>
    typeof value[key] === 'number' ? value[key] : null;
  const flag = (key: string): boolean => value[key] === true;
  const side = (key: string): 'LEFT' | 'RIGHT' | null =>
    value[key] === 'LEFT' ? 'LEFT' : value[key] === 'RIGHT' ? 'RIGHT' : null;

  const nodes = isRecord(value['comments']) ? value['comments']['nodes'] : undefined;
  const comments = (Array.isArray(nodes) ? nodes : [])
    .map(readComment)
    .filter((comment): comment is ReviewComment => comment !== null);
  const totalCount =
    isRecord(value['comments']) && typeof value['comments']['totalCount'] === 'number'
      ? value['comments']['totalCount']
      : comments.length;

  return {
    id,
    path,
    isResolved: flag('isResolved'),
    isOutdated: flag('isOutdated'),
    line: number('line'),
    startLine: number('startLine'),
    originalLine: number('originalLine'),
    originalStartLine: number('originalStartLine'),
    diffSide: side('diffSide') ?? 'RIGHT',
    startDiffSide: side('startDiffSide'),
    subjectType: value['subjectType'] === 'FILE' ? 'FILE' : 'LINE',
    viewerCanReply: flag('viewerCanReply'),
    viewerCanResolve: flag('viewerCanResolve'),
    viewerCanUnresolve: flag('viewerCanUnresolve'),
    comments: { totalCount, nodes: comments },
  };
}

/** The permission and resolution flags a resolve mutation sends back. */
function readResolution(value: unknown): Partial<ReviewThread> | null {
  if (!isRecord(value)) return null;
  const patch: Partial<ReviewThread> = {};
  if (typeof value['isResolved'] === 'boolean') patch.isResolved = value['isResolved'];
  if (typeof value['viewerCanResolve'] === 'boolean') {
    patch.viewerCanResolve = value['viewerCanResolve'];
  }
  if (typeof value['viewerCanUnresolve'] === 'boolean') {
    patch.viewerCanUnresolve = value['viewerCanUnresolve'];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

const field = (data: JsonValue, mutation: string, key: string): unknown =>
  isRecord(data) && isRecord(data[mutation]) ? data[mutation][key] : undefined;

export interface ReviewSessionProviderProps {
  pullRequest: PullRequestNode;
  prRef: PrRef;
  threads: readonly ReviewThread[];
  /** Injected by tests. Production uses extension storage. */
  drafts?: DraftStore;
  children: ReactNode;
}

export function ReviewSessionProvider({
  pullRequest,
  prRef,
  threads,
  drafts = draftStore,
  children,
}: ReviewSessionProviderProps) {
  const [live, setLive] = useState<readonly ReviewThread[]>(threads);
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [sending, setSending] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [viewed, setViewedStates] = useState<ReadonlyMap<string, FileViewedState>>(
    () => new Map(),
  );
  const [resolveInFlight, setResolveInFlight] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [viewedInFlight, setViewedInFlight] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pending, dispatch] = useReducer(reduce, pullRequest, initialPendingReview);
  /**
   * Threads holding a comment that is queued on the pending review.
   *
   * This session's own knowledge, not GitHub's. A review resumed from the
   * server may hold comments that were queued in another tab or in GitHub's UI
   * and this set cannot know about them — which is exactly why the footer says
   * its count is a floor rather than a total.
   */
  const [unpublished, setUnpublished] = useState<ReadonlySet<string>>(() => new Set());

  const markUnpublished = useCallback((threadId: string) => {
    setUnpublished((current) => new Set(current).add(threadId));
  }, []);

  // A refreshed payload replaces the threads outright. Comparing the prop
  // against the one this state was seeded from is the only way to tell a new
  // payload from a re-render, and doing it in render rather than in an effect
  // means no frame is ever painted from the previous pull request's threads.
  const seed = useRef(threads);
  if (seed.current !== threads) {
    seed.current = threads;
    setLive(threads);
  }

  // Read inside async callbacks, where the closed-over state is a render old.
  const liveNow = useRef(live);
  liveNow.current = live;
  const pendingNow = useRef(pending);
  pendingNow.current = pending;
  // Read inside the mutation callbacks, which run after the render that made
  // them. The state itself would be a render behind, which is precisely the
  // window a double-tap fits through.
  const resolvingNow = useRef(resolveInFlight);
  resolvingNow.current = resolveInFlight;
  const viewingNow = useRef(viewedInFlight);
  viewingNow.current = viewedInFlight;

  const prId = typeof pullRequest.id === 'string' ? pullRequest.id : '';

  const patchThread = useCallback((threadId: string, fields: Partial<ReviewThread>) => {
    setLive((list) =>
      list.map((thread) => (thread.id === threadId ? { ...thread, ...fields } : thread)),
    );
  }, []);

  const clearFailure = useCallback((key: string) => {
    setFailures((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);

  const fail = useCallback((key: string, text: string) => {
    setFailures((current) => new Map(current).set(key, text));
  }, []);

  const [tokenRejected, setTokenRejected] = useState(false);

  const mutate = useCallback(
    async (document: string, variables: Record<string, JsonValue>) => {
      // `pr` lets the worker drop the now-stale cached threads for this pull
      // request instead of serving what the reviewer just changed.
      const response = await request(message('mutate', { document, variables, pr: prRef }));
      // Noticed here because every mutation passes through, so no caller has
      // to remember to check — and a token that has lapsed will fail all of
      // them, not the one that happened to be pressed first.
      if (!response.ok && response.error.kind === 'auth') setTokenRejected(true);
      return response;
    },
    [prRef],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean): Promise<void> => {
      const before = liveNow.current.find((thread) => thread.id === threadId);
      if (before === undefined) return;

      // One at a time on a given thread. The second call would read the
      // optimistic value, send the opposite mutation, and — if both failed —
      // roll back to a state the server never held. Nothing orders the two
      // requests either, so even both succeeding can settle the wrong way.
      if (resolvingNow.current.has(threadId)) return;

      clearFailure(threadId);
      patchThread(threadId, { isResolved: resolved });
      setResolveInFlight((current) => new Set(current).add(threadId));

      const response = await mutate(resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD, {
        threadId,
      });

      setResolveInFlight((current) => {
        const rest = new Set(current);
        rest.delete(threadId);
        return rest;
      });

      if (!response.ok) {
        // Put back exactly what was displaced, and say so. A thread that
        // silently un-resolves itself is a lie the reviewer acts on.
        patchThread(threadId, {
          isResolved: before.isResolved,
          viewerCanResolve: before.viewerCanResolve,
          viewerCanUnresolve: before.viewerCanUnresolve,
        });
        fail(
          threadId,
          `${resolved ? 'Resolving' : 'Reopening'} this thread failed: ${response.error.message}`,
        );
        return;
      }

      const returned = readResolution(
        field(
          response.data.data,
          resolved ? 'resolveReviewThread' : 'unresolveReviewThread',
          'thread',
        ),
      );
      if (returned !== null) patchThread(threadId, returned);
    },
    [clearFailure, fail, mutate, patchThread],
  );

  const reply = useCallback(
    async (threadId: string, body: string): Promise<boolean> => {
      clearFailure(threadId);
      setSending((current) => new Map(current).set(threadId, body));

      // Whichever review is open has to be named. Without it the reply
      // publishes on the spot while the line comments beside it sit queued, so
      // the reviewer submits their review and finds their replies left some
      // time earlier — out of order, and out of context.
      const state = pendingNow.current;
      const response = await mutate(ADD_REPLY, {
        pullRequestReviewThreadId: threadId,
        body,
        ...(state.kind === 'pending' ? { pullRequestReviewId: state.reviewId } : {}),
      });

      setSending((current) => {
        const next = new Map(current);
        next.delete(threadId);
        return next;
      });

      if (!response.ok) {
        fail(threadId, `Posting this reply failed: ${response.error.message}`);
        return false;
      }

      // Queued on the review, so nobody else can see it yet. The thread has to
      // say so: it renders identically either way, and the person who wrote the
      // reply has no reason to think it did not go out.
      if (state.kind === 'pending') markUnpublished(threadId);

      const comment = readComment(
        field(response.data.data, 'addPullRequestReviewThreadReply', 'comment'),
      );
      if (comment !== null) {
        setLive((list) =>
          list.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  comments: {
                    totalCount: thread.comments.totalCount + 1,
                    nodes: [...thread.comments.nodes, comment],
                  },
                }
              : thread,
          ),
        );
      }
      return true;
    },
    [clearFailure, fail, markUnpublished, mutate],
  );

  /**
   * Open a PENDING review and return its id.
   *
   * `START_REVIEW` omits `event`, and that omission is the whole mechanism:
   * `addPullRequestReview` with an event submits a review on the spot instead
   * of leaving one open for comments to attach to.
   *
   * Shared by the two callers that need a review to exist — the reviewer
   * asking for one, and publishing a single comment, which needs one for about
   * a second. Each writes its own message; this only reports what happened.
   */
  const openReview = useCallback(async (): Promise<OpenReviewResult> => {
    const response = await mutate(START_REVIEW, { pullRequestId: prId });
    if (!response.ok) return { ok: false, kind: 'refused', message: response.error.message };

    const review = field(response.data.data, 'addPullRequestReview', 'pullRequestReview');
    const reviewId = isRecord(review) ? review['id'] : undefined;
    // An id-less review is worse than none: every later comment would go to
    // `pullRequestReviewId: undefined` and open a review of its own.
    if (typeof reviewId !== 'string' || reviewId === '') return { ok: false, kind: 'no-id' };

    return { ok: true, reviewId };
  }, [mutate, prId]);

  /**
   * The review the viewer has open on GitHub right now, if any.
   *
   * A re-read rather than a query of its own: the worker already asks this
   * question on every read and puts the answer on the node, and the page has no
   * way to run a query itself — only mutations cross the protocol. Refreshing
   * also leaves the cache holding the truth, so the next surface to look agrees
   * with this one.
   */
  const findOpenReview = useCallback(async (): Promise<string | null> => {
    const response = await request(message('get-pr', { pr: prRef, refresh: true }));
    return response.ok ? openReviewId(response.data?.pullRequest) : null;
  }, [prRef]);

  /**
   * Whether GitHub still has this exact review open.
   *
   * Three answers, not two, and the third is the whole point. `findOpenReview`
   * collapses "nothing is open" and "the question could not be asked" into the
   * same null, which is safe where it is used — a failed lookup there just
   * means no review to join. Here it would be a lie in the dangerous
   * direction: a network blink fails the submit *and* the re-read, and
   * treating that as "gone" would tell the reviewer their queued comments went
   * out when they are still sitting unsent.
   *
   * A different id counts as gone. That review was submitted and another was
   * opened; the one this session holds is no longer there either way.
   */
  const reviewPresence = useCallback(
    async (reviewId: string): Promise<'open' | 'gone' | 'unknown'> => {
      const response = await request(message('get-pr', { pr: prRef, refresh: true }));
      if (!response.ok) return 'unknown';
      return openReviewId(response.data?.pullRequest) === reviewId ? 'open' : 'gone';
    },
    [prRef],
  );

  /**
   * Get a review to write into — a new one, or the one already open.
   *
   * GitHub allows one PENDING review per pull request and answers a second with
   * "User can only have one pending review per pull request". Both ways this
   * page writes a comment begin by opening one, so without this a reviewer
   * holding an open review can do neither.
   *
   * The refusal is not read. Matching GitHub's wording would strand the
   * reviewer again the day it changes, and the wording is not the question: if
   * a review is open, joining it is the right move whatever the refusal said.
   * The cost of asking is one re-read on a path that has already failed.
   */
  const openOrJoinReview = useCallback(async (): Promise<JoinReviewResult> => {
    const opened = await openReview();
    if (opened.ok) return { ...opened, joined: false };

    const existing = await findOpenReview();
    if (existing !== null) return { ok: true, reviewId: existing, joined: true };

    // Nothing is open, so the refusal was about something else. Inventing a
    // review to join would replace a real explanation with a wrong one.
    return opened;
  }, [findOpenReview, openReview]);

  const addThread = useCallback(
    (reviewId: string, { path, body, anchor }: NewThreadInput) =>
      mutate(ADD_THREAD, {
        pullRequestReviewId: reviewId,
        path,
        body,
        line: anchor.line,
        side: anchor.side,
        // Left out entirely rather than sent null: an unsupplied variable is
        // dropped from the coerced input, an explicit null is sent as a null.
        ...(anchor.startLine !== undefined && anchor.startSide !== undefined
          ? { startLine: anchor.startLine, startSide: anchor.startSide }
          : {}),
      }),
    [mutate],
  );

  const takeThread = useCallback(
    (data: JsonValue): ReviewThread | null => {
      const created = readThread(field(data, 'addPullRequestReviewThread', 'thread'));
      if (created !== null) setLive((list) => [...list, created]);
      return created;
    },
    [],
  );

  /** Add one comment to the review the reviewer opened. It stays unposted. */
  const queueThread = useCallback(
    async (reviewId: string, input: NewThreadInput): Promise<boolean> => {
      const added = await addThread(reviewId, input);
      if (!added.ok) {
        fail(NEW_THREAD, `Posting this comment failed: ${added.error.message}`);
        return false;
      }

      const created = takeThread(added.data.data);
      if (created !== null) markUnpublished(created.id);
      dispatch({ type: 'comment-added' });
      return true;
    },
    [addThread, fail, markUnpublished, takeThread],
  );

  /**
   * Post one comment, immediately, on its own.
   *
   * Three round trips for one comment, and every one of them is load-bearing.
   * `addPullRequestReviewThread` has **no standalone mode**: `pullRequestId`
   * does not publish a comment, it opens a PENDING review to hold one. So a
   * reviewer who had not asked for a review and was told "this will post
   * immediately" got neither — the comment sat queued inside a review the page
   * did not know existed, invisible until they next loaded the pull request.
   *
   * This is what GitHub's own "Add single comment" does: open a review, put the
   * comment in it, submit it as COMMENT. The review lives for one round trip
   * and the machine is never told about it, so the pending-review bar does not
   * flash on screen for a comment that is already published.
   *
   * The three failure points are not interchangeable, and the difference is
   * whether the reviewer's writing survives:
   *
   * - **No review.** Nothing happened. Say so; the composer keeps the text.
   * - **No comment.** An empty review is open on GitHub. Enter Pending so it is
   *   visible and can be submitted or discarded, rather than left behind.
   * - **Not submitted.** The comment exists. Returning false here would reopen
   *   the composer over text that is already on GitHub and invite a duplicate,
   *   so this reports success, enters Pending, and moves the explanation to the
   *   footer — which is now on screen, and is where the review gets submitted.
   */
  const publishThread = useCallback(
    async (input: NewThreadInput): Promise<boolean> => {
      const opened = await openOrJoinReview();
      if (!opened.ok) {
        fail(
          NEW_THREAD,
          opened.kind === 'refused'
            ? `Posting this comment failed: ${opened.message}`
            : `Posting this comment failed. ${NO_REVIEW_ID}`,
        );
        return false;
      }
      const { reviewId } = opened;

      /**
       * The reviewer already had a review open, so this comment joins it.
       *
       * Publishing it would mean submitting that whole review — including
       * comments made in another tab or in GitHub's own UI that this page has
       * never seen. Sending someone's half-written review because they left one
       * line of feedback is not a thing to do on their behalf.
       *
       * So the comment is queued and the page says plainly that it was queued.
       * The composer promised "posts immediately" and that turned out not to be
       * available; the reviewer has to hear that from us rather than discover
       * it when nobody replies.
       */
      if (opened.joined) {
        dispatch({ type: 'review-resumed', reviewId, commentCount: 0 });
        const queued = await queueThread(reviewId, input);
        if (queued) {
          fail(
            REVIEW_SUBMIT,
            'You already had a review open on GitHub, so this comment was ' +
              'added to it rather than posted on its own. Nothing on that ' +
              'review is visible to anyone else until you submit it below.',
          );
        }
        return queued;
      }

      const added = await addThread(reviewId, input);
      if (!added.ok) {
        dispatch({ type: 'review-started', reviewId });
        fail(
          NEW_THREAD,
          `Posting this comment failed: ${added.error.message} A review was ` +
            'opened to hold it and is still open — submit or discard it below.',
        );
        return false;
      }
      const created = takeThread(added.data.data);

      const submitted = await mutate(SUBMIT_REVIEW, {
        pullRequestReviewId: reviewId,
        event: 'COMMENT',
      });
      if (!submitted.ok) {
        dispatch({ type: 'review-started', reviewId });
        dispatch({ type: 'comment-added' });
        if (created !== null) markUnpublished(created.id);
        fail(
          REVIEW_SUBMIT,
          `Your comment was saved but has not been posted: ${submitted.error.message} ` +
            'It is queued on a pending review — submit that review below to post it.',
        );
        return true;
      }

      return true;
    },
    [addThread, fail, markUnpublished, mutate, openOrJoinReview, queueThread, takeThread],
  );

  const postThread = useCallback(
    (input: NewThreadInput): Promise<boolean> => {
      clearFailure(NEW_THREAD);
      const state = pendingNow.current;
      return state.kind === 'pending'
        ? queueThread(state.reviewId, input)
        : publishThread(input);
    },
    [clearFailure, publishThread, queueThread],
  );

  /**
   * Whether an open is in flight.
   *
   * A ref, not state: the button's `disabled` and the check below both read
   * state that only moves once the mutation has returned, so a double-click
   * slips between them and issues two `addPullRequestReview` calls. The loser
   * costs a full re-read of the pull request to learn what the winner already
   * knew — and if GitHub's one-pending-review rule is not transactional, both
   * succeed and one review is orphaned with no id on this page to submit or
   * delete it.
   */
  const startingReview = useRef(false);

  const openAndAdopt = useCallback(async (): Promise<boolean> => {
    const opened = await openOrJoinReview();

    if (!opened.ok) {
      fail(
        REVIEW_START,
        opened.kind === 'refused'
          ? `Starting a review failed: ${opened.message}`
          : NO_REVIEW_ID,
      );
      return false;
    }

    // A joined review is `review-resumed`, not `review-started`: the machine
    // uses that distinction to say its comment count is a floor rather than a
    // total, and a joined review really may hold comments made elsewhere.
    dispatch(
      opened.joined
        ? { type: 'review-resumed', reviewId: opened.reviewId, commentCount: 0 }
        : { type: 'review-started', reviewId: opened.reviewId },
    );
    return true;
  }, [fail, openOrJoinReview]);

  const startReview = useCallback(async (): Promise<boolean> => {
    // A second review would orphan the first, along with everything queued on
    // it. The machine refuses the transition; this refuses the request.
    if (pendingNow.current.kind === 'pending') return true;
    if (startingReview.current) return false;
    startingReview.current = true;

    clearFailure(REVIEW_START);
    try {
      return await openAndAdopt();
    } finally {
      // Cleared however it went: this guards against concurrency, not against
      // trying again after a refusal.
      startingReview.current = false;
    }
  }, [clearFailure, openAndAdopt]);



  /**
   * Submit the pending review.
   *
   * A failure here keeps the review exactly as it was. The queued comments
   * exist only inside that PENDING review; returning to Browse because the
   * network blinked would leave the reviewer believing their review went out,
   * with no way to get back to it from this page.
   */
  const submitReview = useCallback(
    async (event: SubmitEvent, body: string): Promise<boolean> => {
      const state = pendingNow.current;
      if (state.kind !== 'pending') return false;

      clearFailure(REVIEW_SUBMIT);
      const summary = body.trim();
      const response = await mutate(SUBMIT_REVIEW, {
        pullRequestReviewId: state.reviewId,
        event,
        // Left out rather than sent empty: `body` is optional, and an empty
        // summary is not a summary.
        ...(summary === '' ? {} : { body: summary }),
      });

      if (!response.ok) {
        // Ask whether the review still exists before promising it does. A
        // reviewer with GitHub open in another tab can submit or discard the
        // same review there, and every use of the id then fails — including
        // this one. Saying "still pending" would be false, and staying in
        // Pending would leave the footer up and route every later comment
        // into a review that is gone, with a reload the only way out.
        if ((await reviewPresence(state.reviewId)) === 'gone') {
          dispatch({ type: 'submitted' });
          setUnpublished(new Set());
          fail(
            REVIEW_SUBMIT,
            'This review is no longer open on GitHub — it was submitted or ' +
              'discarded somewhere else. Anything queued on it went with it.',
          );
          return false;
        }

        fail(
          REVIEW_SUBMIT,
          `Submitting this review failed: ${response.error.message} ` +
            'The review is still pending and none of its comments were discarded.',
        );
        return false;
      }

      dispatch({ type: 'submitted' });
      // Posted now, so nothing is outstanding. Leaving the marks would keep
      // saying otherwise on threads that are live on GitHub.
      setUnpublished(new Set());
      return true;
    },
    [clearFailure, fail, mutate, reviewPresence],
  );

  /**
   * Throw the pending review away.
   *
   * Deleted on the server too. Clearing only the local state would leave the
   * PENDING review and every comment on it sitting on GitHub, so the next visit
   * would resume a review the reviewer believes they abandoned — and their next
   * comment would join it.
   */
  const discardReview = useCallback(async (): Promise<boolean> => {
    const state = pendingNow.current;
    if (state.kind !== 'pending') return false;

    clearFailure(REVIEW_SUBMIT);
    const response = await mutate(DELETE_REVIEW, {
      pullRequestReviewId: state.reviewId,
    });

    if (!response.ok) {
      fail(REVIEW_SUBMIT, `Discarding this review failed: ${response.error.message}`);
      return false;
    }

    dispatch({ type: 'discarded' });
    setUnpublished(new Set());
    return true;
  }, [clearFailure, fail, mutate]);

  /**
   * Mark a file viewed, or take the mark back.
   *
   * This is GitHub's own viewed state, not a local one: a file ticked here is
   * ticked on github.com, and one ticked there arrives ticked in the payload.
   *
   * Optimistic, and `from` is what goes back on failure — the value that was
   * displaced, which is not always `UNVIEWED`. Rolling a `DISMISSED` file back
   * to unviewed would throw away the "this changed after you looked at it"
   * signal the reviewer started with.
   */
  const setViewed = useCallback(
    async (path: string, next: boolean, from: FileViewedState): Promise<void> => {
      // Guarded here rather than only on the checkbox, so the keyboard path
      // and anything added later inherit it instead of rediscovering the race.
      if (viewingNow.current.has(path)) return;

      const key = viewedKey(path);
      clearFailure(key);
      setViewedStates((current) =>
        new Map(current).set(path, next ? 'VIEWED' : 'UNVIEWED'),
      );
      setViewedInFlight((current) => new Set(current).add(path));

      const response = await mutate(next ? MARK_VIEWED : UNMARK_VIEWED, {
        pullRequestId: prId,
        path,
      });

      setViewedInFlight((current) => {
        const rest = new Set(current);
        rest.delete(path);
        return rest;
      });

      if (!response.ok) {
        setViewedStates((current) => new Map(current).set(path, from));
        fail(
          key,
          `${next ? 'Marking' : 'Unmarking'} ${path} as viewed failed: ` +
            `${response.error.message}`,
        );
      }
    },
    [clearFailure, fail, mutate, prId],
  );

  const byPath = useMemo(() => {
    const map = new Map<string, ReviewThread[]>();
    for (const thread of live) {
      const bucket = map.get(thread.path);
      if (bucket === undefined) map.set(thread.path, [thread]);
      else bucket.push(thread);
    }
    return map as ReadonlyMap<string, readonly ReviewThread[]>;
  }, [live]);

  const byId = useMemo(
    () => new Map(live.map((thread) => [thread.id, thread])),
    [live],
  );

  const value = useMemo<ReviewSessionValue>(
    () => ({
      prId,
      prRef,
      threads: live,
      byPath,
      byId,
      pending,
      unpublished,
      drafts,
      failures,
      sending,
      viewed,
      viewedInFlight,
      resolveInFlight,
      tokenRejected,
      setResolved,
      reply,
      postThread,
      startReview,
      submitReview,
      discardReview,
      setViewed,
      clearFailure,
    }),
    [
      prId,
      prRef,
      live,
      byPath,
      byId,
      pending,
      unpublished,
      drafts,
      failures,
      sending,
      viewed,
      viewedInFlight,
      resolveInFlight,
      tokenRejected,
      setResolved,
      reply,
      postThread,
      startReview,
      submitReview,
      discardReview,
      setViewed,
      clearFailure,
    ],
  );

  return (
    <ReviewSessionContext.Provider value={value}>
      {children}
    </ReviewSessionContext.Provider>
  );
}
