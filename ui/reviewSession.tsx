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
  DELETE_COMMENT,
  DELETE_REVIEW,
  MARK_VIEWED,
  RESOLVE_THREAD,
  START_REVIEW,
  SUBMIT_REVIEW,
  THREAD_PERMISSIONS,
  UNMARK_VIEWED,
  UNRESOLVE_THREAD,
  UPDATE_COMMENT,
} from '@/lib/github/mutations';
import type {
  FileViewedState,
  ReviewComment,
  ReviewEvent,
  ReviewThread,
} from '@/lib/github/types';
import { type JsonValue, type PrRef, type PullRequestNode, message } from '@/lib/messages';
import { type DraftLocation, type DraftStore } from '@/lib/review/drafts';
import { type PendingReviewState, initialState, reduce } from '@/lib/review/pending-review';
import {
  type PostingComment,
  beginPost,
  dropPost,
  failPost,
  nextPostId,
  retryPost,
} from '@/lib/review/posting';
import type { CommentAnchor } from '@/lib/review/selection';
import { request } from './background';
import { draftStore } from './draftStore';

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
 * The failure key for one comment's edit or delete.
 *
 * Per comment rather than per thread, unlike the reply and the resolve. A
 * thread has one reply box and one resolve control, so a thread-keyed message
 * lands next to the thing that failed; it has as many comments as it likes, and
 * "Deleting this comment failed" under a thread of six says nothing about
 * which.
 */
export const commentKey = (commentId: string): string => `comment:${commentId}`;

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

/**
 * What happened to one comment, reported rather than written to state.
 *
 * The two paths that write a comment used to fail against a page-level key of
 * their own, which was fine while a composer was still on screen to show it.
 * It is not fine now: the box closes on the press, so the message belongs on
 * the entry in `posting` — and only the caller knows which entry that is. So
 * they say what happened and `postThread` decides where it goes.
 *
 * `ok` is not "published" — see `publishThread`, which reports success for a
 * comment that reached GitHub but is sitting on a review it could not submit.
 * The comment exists either way, which is the question this answers.
 */
type PostOutcome = { ok: true } | { ok: false; message: string };

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
   * Keyed by thread id, by `REVIEW_START` / `REVIEW_SUBMIT` for the review
   * itself, by `commentKey(id)` and by `viewedKey(path)`.
   *
   * A new comment is not in here. It is posted optimistically, so by the time
   * it can fail its composer has closed and a page-level message would have
   * nowhere to appear and nothing to identify which of the reviewer's three
   * comments it was about. Its reason goes on the entry in `posting`, which
   * is drawn on the line the comment was written on.
   */
  failures: ReadonlyMap<string, string>;
  /** Reply bodies still in flight, keyed by thread id. */
  sending: ReadonlyMap<string, string>;
  /**
   * New comments on their way to GitHub, and the ones that did not get there.
   *
   * The optimistic half of posting a comment. An entry appears the instant the
   * reviewer presses the button and is replaced by the real thread in the same
   * render that adds it, so the line never holds both. An entry with an
   * `error` is a comment that exists nowhere else — see `lib/review/posting.ts`.
   */
  posting: readonly PostingComment[];
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
   * Comments whose edit or delete has not answered yet, by comment id.
   *
   * One set for both, because a comment cannot be being rewritten and destroyed
   * at the same time and the guard is the same either way: a second press must
   * not send a second mutation.
   */
  commentInFlight: ReadonlySet<string>;
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
  /**
   * Rewrite one comment's body, published or still queued.
   *
   * `body` is the finished text, not a delta — the mutation replaces the body
   * outright. False means the words are still only on this page and the caller
   * must keep them; true means GitHub has them.
   */
  editComment(commentId: string, body: string): Promise<boolean>;
  /**
   * Destroy one comment on GitHub. Irreversible, and nothing keeps a copy.
   *
   * The caller confirms first. This does not ask — a session method that put a
   * dialog on screen would be a rule enforced in the one place it cannot be
   * seen from.
   */
  deleteComment(commentId: string): Promise<boolean>;
  /**
   * Write a new comment, optimistically.
   *
   * Returns as soon as the entry is on screen rather than when GitHub has it,
   * and the caller is expected not to wait: the composer closes on the press.
   * The promise is still there, resolving to whether it landed, because the
   * tests assert on the settled state and a retry needs something to await.
   *
   * Nothing is lost by not waiting. Until GitHub answers, the comment is an
   * entry in {@link ReviewSessionValue.posting} drawn on its own line; if the
   * post fails the entry stays there, holding the words, with the reason on it
   * and a retry beside it.
   */
  postThread(input: NewThreadInput): Promise<boolean>;
  /** Send a failed comment again. Does nothing to one already in flight. */
  retryPost(postId: string): Promise<boolean>;
  /**
   * Throw away a comment that could not be posted, and its saved draft.
   *
   * The only thing on this page that deliberately destroys the reviewer's own
   * writing, so it is never called except from a control they pressed.
   */
  discardPost(postId: string): void;
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
    // Both default to false on anything but a literal `true`. A permission
    // invented for a field the payload did not carry offers a control that can
    // only fail, and on the delete that failure is irreversible on the second
    // attempt rather than the first.
    viewerCanUpdate: value['viewerCanUpdate'] === true,
    viewerCanDelete: value['viewerCanDelete'] === true,
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

/**
 * The permission and resolution flags a thread payload carries.
 *
 * Field by field, and absent is not false. These arrive from two places — a
 * resolve mutation and {@link THREAD_PERMISSIONS} — and a document that
 * selected three of the four must leave the fourth alone rather than clear it.
 */
function readResolution(value: unknown): Partial<ReviewThread> | null {
  if (!isRecord(value)) return null;
  const patch: Partial<ReviewThread> = {};
  if (typeof value['isResolved'] === 'boolean') patch.isResolved = value['isResolved'];
  if (typeof value['viewerCanReply'] === 'boolean') {
    patch.viewerCanReply = value['viewerCanReply'];
  }
  if (typeof value['viewerCanResolve'] === 'boolean') {
    patch.viewerCanResolve = value['viewerCanResolve'];
  }
  if (typeof value['viewerCanUnresolve'] === 'boolean') {
    patch.viewerCanUnresolve = value['viewerCanUnresolve'];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * The threads a `nodes(ids:)` reply actually carried, paired with their id.
 *
 * Positional matching is not available: GraphQL answers an id it could not
 * resolve with a null in the list, and an inline fragment on the wrong type
 * with an empty object. Both are ordinary — a thread can be deleted between
 * the submit and this read — so each entry names itself or is dropped.
 */
function readThreadFlags(value: unknown): Map<string, Partial<ReviewThread>> {
  const found = new Map<string, Partial<ReviewThread>>();
  if (!Array.isArray(value)) return found;

  for (const node of value) {
    if (!isRecord(node)) continue;
    const id = node['id'];
    if (typeof id !== 'string') continue;
    const patch = readResolution(node);
    if (patch !== null) found.set(id, patch);
  }
  return found;
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
  const [posting, setPosting] = useState<readonly PostingComment[]>(() => []);
  const [viewed, setViewedStates] = useState<ReadonlyMap<string, FileViewedState>>(
    () => new Map(),
  );
  const [resolveInFlight, setResolveInFlight] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [viewedInFlight, setViewedInFlight] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [commentInFlight, setCommentInFlight] = useState<ReadonlySet<string>>(
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

  /**
   * The same fact one level down: which *comments* are queued.
   *
   * Not exposed, and not a duplicate of the set above. The badge is per thread
   * because that is what carries it, but deleting a comment asks a per-comment
   * question — was this one of the queued ones, so that the footer's count and
   * the thread's badge both have to move? A thread routinely holds a published
   * comment and one queued reply, and the thread-level set cannot tell them
   * apart.
   *
   * Only ever holds comments this session queued. That is the same limit the
   * footer already states: a resumed review may hold comments made elsewhere,
   * and they were never counted, so deleting one has nothing to subtract.
   */
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Forget both, together, whenever the review they described has gone.
   *
   * Together because they are one fact recorded twice, and a leftover comment
   * id is not inert: after a submit, those comments are published, and a
   * `queued` set still holding them would make deleting one of them decrement
   * the count of whatever review the reviewer opens next.
   */
  const forgetQueued = useCallback(() => {
    setUnpublished(new Set());
    setQueued(new Set());
  }, []);

  const markUnpublished = useCallback((threadId: string) => {
    setUnpublished((current) => new Set(current).add(threadId));
  }, []);

  const markQueued = useCallback((commentIds: readonly string[]) => {
    if (commentIds.length === 0) return;
    setQueued((current) => {
      const next = new Set(current);
      for (const id of commentIds) next.add(id);
      return next;
    });
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
  const commentingNow = useRef(commentInFlight);
  commentingNow.current = commentInFlight;
  const queuedNow = useRef(queued);
  queuedNow.current = queued;
  const postingNow = useRef(posting);
  postingNow.current = posting;
  const unpublishedNow = useRef(unpublished);
  unpublishedNow.current = unpublished;

  const prId = typeof pullRequest.id === 'string' ? pullRequest.id : '';

  const patchThread = useCallback((threadId: string, fields: Partial<ReviewThread>) => {
    setLive((list) =>
      list.map((thread) => (thread.id === threadId ? { ...thread, ...fields } : thread)),
    );
  }, []);

  /**
   * Replace one comment's fields wherever it turns out to live.
   *
   * By comment id alone, without the thread: the mutation that produces this
   * takes only the comment id, and asking the caller to also carry the thread
   * id is asking it to keep two things in step for no gain.
   */
  const patchComment = useCallback(
    (commentId: string, fields: Partial<ReviewComment>) => {
      setLive((list) =>
        list.map((thread) =>
          thread.comments.nodes.some((comment) => comment.id === commentId)
            ? {
                ...thread,
                comments: {
                  ...thread.comments,
                  nodes: thread.comments.nodes.map((comment) =>
                    comment.id === commentId ? { ...comment, ...fields } : comment,
                  ),
                },
              }
            : thread,
        ),
      );
    },
    [],
  );

  /**
   * Take a deleted comment out of state — and its thread with it, if it was the
   * last one.
   *
   * **GitHub deletes a review thread along with its final comment.** An empty
   * thread left behind here is a card with nothing in it anchored to a line of
   * the diff, and every control on it fails against an id that no longer
   * resolves.
   *
   * `totalCount` is decremented rather than recomputed from the nodes, because
   * it counts comments past the fifty the query fetched. It is floored at the
   * number actually on screen so it can never claim fewer comments than are
   * being drawn.
   *
   * The two queued-comment bookkeepings are the reason this is not three lines.
   * The footer's count and the thread's "Not posted yet" badge both describe
   * comments that are not on the pull request yet, and a delete is the one
   * thing that can make either of them false: a count that goes on offering to
   * submit a comment that no longer exists, and a badge on a thread whose only
   * unposted comment has just gone.
   */
  const dropComment = useCallback((commentId: string) => {
    const thread = liveNow.current.find((candidate) =>
      candidate.comments.nodes.some((comment) => comment.id === commentId),
    );
    if (thread === undefined) return;

    const nodes = thread.comments.nodes.filter((comment) => comment.id !== commentId);
    const totalCount = Math.max(nodes.length, thread.comments.totalCount - 1);
    const threadGone = totalCount === 0;

    setLive((list) =>
      threadGone
        ? list.filter((candidate) => candidate.id !== thread.id)
        : list.map((candidate) =>
            candidate.id === thread.id
              ? { ...candidate, comments: { totalCount, nodes } }
              : candidate,
          ),
    );

    const wasQueued = queuedNow.current.has(commentId);
    if (wasQueued) {
      dispatch({ type: 'comment-removed' });
      setQueued((current) => {
        const rest = new Set(current);
        rest.delete(commentId);
        return rest;
      });
    }

    // Cleared when the thread has gone, and when the comment that was holding
    // the badge up has. The second case is guarded on `wasQueued` because that
    // is the only case where this session knows which comments were queued —
    // a resumed review's are unknown, and clearing the badge on a guess would
    // tell the reviewer their comment is public when it is not.
    const stillQueued = nodes.some((comment) => queuedNow.current.has(comment.id));
    if (threadGone || (wasQueued && !stillQueued)) {
      setUnpublished((current) => {
        if (!current.has(thread.id)) return current;
        const rest = new Set(current);
        rest.delete(thread.id);
        return rest;
      });
    }
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
      // Which comment is queued, not just which thread holds one. Deleting
      // this reply later has to take the badge off a thread whose other
      // comments are public.
      if (comment !== null && state.kind === 'pending') markQueued([comment.id]);
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
    [clearFailure, fail, markQueued, markUnpublished, mutate],
  );

  /**
   * Rewrite one comment's body.
   *
   * Not optimistic, which is the opposite of `setResolved` beside it, and the
   * asymmetry is deliberate. A resolve is a flag with two values and the wrong
   * one costs a glance; a body is the writing itself, and showing a correction
   * as saved and then reverting it is the reviewer believing their typo is
   * fixed when the original is still what everyone else reads. There is nothing
   * to gain by guessing: the round trip is one request and the editor stays on
   * screen throughout.
   *
   * No review id is passed, on purpose. A queued comment already belongs to a
   * review; naming one here could only ever name a different one.
   */
  const editComment = useCallback(
    async (commentId: string, body: string): Promise<boolean> => {
      // A second save would race the first and could settle on the older text.
      if (commentingNow.current.has(commentId)) return false;

      const key = commentKey(commentId);
      clearFailure(key);
      setCommentInFlight((current) => new Set(current).add(commentId));

      const response = await mutate(UPDATE_COMMENT, {
        pullRequestReviewCommentId: commentId,
        body,
      });

      setCommentInFlight((current) => {
        const rest = new Set(current);
        rest.delete(commentId);
        return rest;
      });

      if (!response.ok) {
        fail(key, `Saving this edit failed: ${response.error.message}`);
        return false;
      }

      // Mutations do not opt into partial responses, so `ok` means GitHub
      // really applied it — which is why `{ body }` is a safe fallback for a
      // payload that came back in an unexpected shape. It is what was sent,
      // and it is now what is stored.
      const payload = field(
        response.data.data,
        'updatePullRequestReviewComment',
        'pullRequestReviewComment',
      );
      const updated = readComment(payload);
      patchComment(commentId, updated ?? { body });
      return true;
    },
    [clearFailure, fail, mutate, patchComment],
  );

  /**
   * Destroy one comment on GitHub.
   *
   * Not optimistic either, and for a stronger reason than the edit above: there
   * is no rollback. A comment removed from the page and then restored because
   * the request failed reads as the delete having been undone by somebody else,
   * and the reviewer has no way to tell that from the truth. So nothing moves
   * until GitHub has agreed.
   *
   * The confirmation lives in the component, not here. A session method that
   * put a dialog on screen would enforce the rule in the one place nobody
   * reviewing the UI would look for it.
   */
  const deleteComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (commentingNow.current.has(commentId)) return false;

      const key = commentKey(commentId);
      clearFailure(key);
      setCommentInFlight((current) => new Set(current).add(commentId));

      // `id`, not `pullRequestReviewCommentId` — the delete input is spelled
      // differently from the update input. See DELETE_COMMENT.
      const response = await mutate(DELETE_COMMENT, { id: commentId });

      setCommentInFlight((current) => {
        const rest = new Set(current);
        rest.delete(commentId);
        return rest;
      });

      if (!response.ok) {
        fail(key, `Deleting this comment failed: ${response.error.message}`);
        return false;
      }

      dropComment(commentId);
      return true;
    },
    [clearFailure, dropComment, fail, mutate],
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
   * Ask again what may be done to the threads a review has just published.
   *
   * The bug this exists for is small on screen and thoroughly confusing: you
   * write a comment, submit the review, and the conversation you just posted
   * has a Resolve button you cannot press. Reloading fixes it, which is the
   * whole diagnosis — GitHub has been right the entire time and only the copy
   * on this page was stale.
   *
   * It is stale because of when it was written down. A thread queued on a
   * PENDING review is described by `addPullRequestReviewThread` as it is *at
   * that moment*: unpublished, and not everything is permitted on one of those.
   * Submitting turns it into an ordinary thread on the pull request and touches
   * nothing here, so the flags go on describing a thread that no longer exists
   * in that form.
   *
   * Asked rather than assumed — see {@link THREAD_PERMISSIONS}. Deciding that a
   * submitted review implies a resolvable thread would be wrong for anyone who
   * may review a repository without being able to write to it.
   *
   * Failure is silent and deliberately so. Nothing was lost: the review is
   * submitted, every comment is on GitHub, and the worst case is the disabled
   * button that was there before this ran. An error about a request the
   * reviewer did not make, on top of a submit that worked, would read as the
   * submit having gone wrong.
   */
  const republish = useCallback(
    async (threadIds: readonly string[]): Promise<void> => {
      // `nodes` caps at 100 ids. A review holding more than that is not a case
      // worth a second round trip — the ones past the cap keep the flags they
      // had, which is exactly the state this whole function is improving on.
      const ids = threadIds.slice(0, 100);
      if (ids.length === 0) return;

      const response = await mutate(THREAD_PERMISSIONS, { ids });
      if (!response.ok) return;

      const flags = readThreadFlags(
        isRecord(response.data.data) ? response.data.data['nodes'] : undefined,
      );
      for (const [id, patch] of flags) patchThread(id, patch);
    },
    [mutate, patchThread],
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

  /**
   * Both shapes of comment, told apart by what is left out.
   *
   * The rule is the same one `ADD_THREAD` documents and it is why the file case
   * works at all: an unsupplied variable is dropped from the coerced input,
   * whereas an explicit null is sent as a null. A thread about the file has no
   * line and no side, and GitHub reads their *absence* beside
   * `subjectType: FILE`; sending `line: null` would be a statement about a line
   * rather than silence about one.
   *
   * `subjectType` is left unsupplied for a line comment, which is what every
   * comment this page has ever posted did — and every one of them came back a
   * LINE thread, so GitHub's default is not in doubt. Sending `'LINE'`
   * explicitly would make the two branches symmetric and state on the wire what
   * the request means, which is a real argument. It loses to the fact that
   * `line` and `side` already state it: a second field carrying the same fact
   * is a field that can contradict the first, and adding it would change every
   * request the existing path makes in order to change nothing.
   */
  const addThread = useCallback(
    (reviewId: string, { path, body, anchor }: NewThreadInput) =>
      mutate(ADD_THREAD, {
        pullRequestReviewId: reviewId,
        path,
        body,
        ...(anchor.subject === 'file'
          ? { subjectType: 'FILE' }
          : {
              line: anchor.line,
              side: anchor.side,
              ...(anchor.startLine !== undefined && anchor.startSide !== undefined
                ? { startLine: anchor.startLine, startSide: anchor.startSide }
                : {}),
            }),
      }),
    [mutate],
  );

  /**
   * Adopt the thread GitHub just made, and retire the entry standing in for it.
   *
   * Both in one call, and that is the whole point of the call existing. React
   * batches the two updates into a single commit, so the annotation array for
   * that file changes exactly once and the row swaps the optimistic card for
   * the real one in place. Done as two steps a round trip apart — which is
   * what this used to be — the line holds the finished comment *and* the thing
   * that was standing in for it, showing the same words twice, and then
   * re-lays out a second time when the stand-in goes.
   */
  const takeThread = useCallback(
    (data: JsonValue, postId: string): ReviewThread | null => {
      const created = readThread(field(data, 'addPullRequestReviewThread', 'thread'));
      if (created !== null) setLive((list) => [...list, created]);
      setPosting((list) => dropPost(list, postId));
      return created;
    },
    [],
  );

  /** Add one comment to the review the reviewer opened. It stays unposted. */
  const queueThread = useCallback(
    async (
      reviewId: string,
      input: NewThreadInput,
      postId: string,
    ): Promise<PostOutcome> => {
      const added = await addThread(reviewId, input);
      if (!added.ok) {
        return { ok: false, message: `Posting this comment failed: ${added.error.message}` };
      }

      const created = takeThread(added.data.data, postId);
      if (created !== null) {
        markUnpublished(created.id);
        markQueued(created.comments.nodes.map((comment) => comment.id));
      }
      dispatch({ type: 'comment-added' });
      return { ok: true };
    },
    [addThread, markQueued, markUnpublished, takeThread],
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
    async (input: NewThreadInput, postId: string): Promise<PostOutcome> => {
      const opened = await openOrJoinReview();
      if (!opened.ok) {
        return {
          ok: false,
          message:
            opened.kind === 'refused'
              ? `Posting this comment failed: ${opened.message}`
              : `Posting this comment failed. ${NO_REVIEW_ID}`,
        };
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
        const queued = await queueThread(reviewId, input, postId);
        if (queued.ok) {
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
        return {
          ok: false,
          message:
            `Posting this comment failed: ${added.error.message} A review was ` +
            'opened to hold it and is still open — submit or discard it below.',
        };
      }
      const created = takeThread(added.data.data, postId);

      const submitted = await mutate(SUBMIT_REVIEW, {
        pullRequestReviewId: reviewId,
        event: 'COMMENT',
      });
      if (!submitted.ok) {
        dispatch({ type: 'review-started', reviewId });
        dispatch({ type: 'comment-added' });
        if (created !== null) {
          markUnpublished(created.id);
          markQueued(created.comments.nodes.map((comment) => comment.id));
        }
        fail(
          REVIEW_SUBMIT,
          `Your comment was saved but has not been posted: ${submitted.error.message} ` +
            'It is queued on a pending review — submit that review below to post it.',
        );
        // Success, on purpose. The comment reached GitHub — `takeThread` has
        // already put the real thread on the line — so reporting a failure
        // here would leave the entry in `posting` holding a second copy of
        // words that are now on the pull request, offering to send them again.
        // The thing that went wrong is the review, and it is said on the
        // footer, which the `review-started` above has just put on screen.
        return { ok: true };
      }

      // The review this thread was written into existed for the two round
      // trips above and is now submitted, so the thread is real — but the copy
      // held here was described mid-way through that, while it was still inside
      // an unsubmitted review. Without this the reviewer posts a comment and
      // finds Resolve greyed out on it until they reload.
      if (created !== null) await republish([created.id]);
      return { ok: true };
    },
    [
      addThread,
      fail,
      markQueued,
      markUnpublished,
      mutate,
      openOrJoinReview,
      queueThread,
      republish,
      takeThread,
    ],
  );

  /**
   * Where a comment's draft lives, for the one copy that outlives this page.
   *
   * The composer writes the draft before handing the comment over and no
   * longer waits around to clear it, so clearing it is this file's job now.
   * Built from the same three fields the composer used, which is what makes
   * the two agree — see `draftKey`.
   *
   * Null for a comment about the file, because there is no draft to clear: a
   * draft is keyed by line and side, and the composer that writes one only ever
   * opens on a line. Inventing a key here instead would settle the storage
   * format for file drafts in the one place that never writes one.
   */
  const draftFor = useCallback(
    ({ path, anchor }: NewThreadInput): DraftLocation | null =>
      anchor.subject === 'file'
        ? null
        : { prId, path, line: anchor.line, side: anchor.side },
    [prId],
  );

  /**
   * Send one entry from `posting`, and record what happened to it.
   *
   * Shared by the first attempt and every retry, so a retry cannot drift from
   * the thing it is retrying. The entry is the argument rather than the id
   * because the caller has just put it there and reading it back out of state
   * would be reading a render-old copy.
   */
  const sendPost = useCallback(
    async (postId: string, input: NewThreadInput): Promise<boolean> => {
      const state = pendingNow.current;
      let outcome: PostOutcome;
      try {
        outcome =
          state.kind === 'pending'
            ? await queueThread(state.reviewId, input, postId)
            : await publishThread(input, postId);
      } catch (error: unknown) {
        // Nothing below this is allowed to throw past here. The composer has
        // closed, so an escaping error would leave the entry saying "Sending…"
        // for the rest of the session with no retry, no discard and no
        // explanation — the words on screen and unreachable. A thrown error is
        // a failed post like any other; it just has to say less about why.
        outcome = {
          ok: false,
          message:
            'Posting this comment failed before GitHub could answer: ' +
            `${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (!outcome.ok) {
        // The entry stays, holding the words, and so does the draft on disk.
        // Between them the comment survives a failed post, a closed tab and a
        // restarted browser, which is what principle 4 asks for.
        setPosting((list) => failPost(list, postId, outcome.message));
        return false;
      }

      // GitHub has the comment, so the draft is a second copy of something
      // already posted. Left behind, it would seed the next composer opened on
      // that line with a comment the reviewer already made.
      const location = draftFor(input);
      if (location !== null) void drafts.clear(location).catch(() => undefined);
      return true;
    },
    [draftFor, drafts, publishThread, queueThread],
  );

  const postThread = useCallback(
    (input: NewThreadInput): Promise<boolean> => {
      // Before the first `await` in `sendPost`, so the entry is on screen in
      // the same commit as the press that made it. This is the whole of
      // "optimistic": the caller closes its composer without waiting, and the
      // words it was holding are already drawn on the line underneath it.
      const postId = nextPostId();
      setPosting((list) => beginPost(list, postId, input));
      return sendPost(postId, input);
    },
    [sendPost],
  );

  const retryPostById = useCallback(
    (postId: string): Promise<boolean> => {
      const entry = postingNow.current.find((candidate) => candidate.id === postId);
      // Only a failed entry can be retried. A second press while one is in
      // flight would post the comment twice, which is the one mistake a retry
      // button is uniquely able to make.
      if (entry === undefined || entry.error === null) return Promise.resolve(false);

      setPosting((list) => retryPost(list, postId));
      return sendPost(postId, entry);
    },
    [sendPost],
  );

  const discardPost = useCallback(
    (postId: string): void => {
      const entry = postingNow.current.find((candidate) => candidate.id === postId);
      // In flight is not discardable. The request is already out and GitHub
      // may well accept it, so taking the entry away would hide a comment
      // that is about to be on the pull request.
      if (entry === undefined || entry.error === null) return;

      setPosting((list) => dropPost(list, postId));
      // The saved copy goes too, or the next composer on that line would open
      // holding the comment the reviewer just threw away. Null is a comment
      // about the file, which never had one — see `draftFor`.
      const location = draftFor(entry);
      if (location !== null) void drafts.clear(location).catch(() => undefined);
    },
    [draftFor, drafts],
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
          forgetQueued();
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
      // Read before the marks are cleared: this is the only record of which
      // threads the review was holding, and `forgetQueued` is about to empty
      // it.
      const published = [...unpublishedNow.current];
      // Posted now, so nothing is outstanding. Leaving the marks would keep
      // saying otherwise on threads that are live on GitHub.
      forgetQueued();
      await republish(published);
      return true;
    },
    [clearFailure, fail, forgetQueued, mutate, republish, reviewPresence],
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
    forgetQueued();
    return true;
  }, [clearFailure, fail, forgetQueued, mutate]);

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
      posting,
      viewed,
      viewedInFlight,
      resolveInFlight,
      commentInFlight,
      tokenRejected,
      setResolved,
      reply,
      editComment,
      deleteComment,
      postThread,
      retryPost: retryPostById,
      discardPost,
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
      posting,
      viewed,
      viewedInFlight,
      resolveInFlight,
      commentInFlight,
      tokenRejected,
      setResolved,
      reply,
      editComment,
      deleteComment,
      postThread,
      retryPostById,
      discardPost,
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
