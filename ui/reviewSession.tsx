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
  RESOLVE_THREAD,
  UNRESOLVE_THREAD,
} from '@/lib/github/mutations';
import type { ReviewComment, ReviewThread } from '@/lib/github/types';
import { type JsonValue, type PrRef, type PullRequestNode, message } from '@/lib/messages';
import type { DraftStore } from '@/lib/review/drafts';
import {
  type PendingReviewState,
  commentTarget,
  initialState,
  reduce,
} from '@/lib/review/pending-review';
import type { CommentAnchor } from '@/lib/review/selection';
import { request } from './background';
import { draftStore } from './draftStore';

/** The failure key for a comment that has no thread to hang off yet. */
export const NEW_THREAD = 'new-thread';

export interface NewThreadInput {
  path: string;
  body: string;
  anchor: CommentAnchor;
}

export interface ReviewSessionValue {
  /** The pull request's node id — the target for a standalone comment. */
  prId: string;
  prRef: PrRef;
  threads: readonly ReviewThread[];
  byPath: ReadonlyMap<string, readonly ReviewThread[]>;
  byId: ReadonlyMap<string, ReviewThread>;
  pending: PendingReviewState;
  drafts: DraftStore;
  /** Keyed by thread id, or `NEW_THREAD` for the composer. */
  failures: ReadonlyMap<string, string>;
  /** Reply bodies still in flight, keyed by thread id. */
  sending: ReadonlyMap<string, string>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  reply(threadId: string, body: string): Promise<boolean>;
  postThread(input: NewThreadInput): Promise<boolean>;
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

/**
 * The review the viewer already has open on the server, if it is still pending.
 *
 * A reviewer who started a review in GitHub's own UI and then came here has an
 * open PENDING review this page knows nothing about. Posting standalone in that
 * state orphans the comment: it is attached to the pull request, the pending
 * review is submitted without it, and nobody is told.
 */
export function initialPendingReview(node: PullRequestNode): PendingReviewState {
  const review = node['viewerLatestReview'];
  if (!isRecord(review) || review['state'] !== 'PENDING') return initialState();

  const reviewId = review['id'];
  if (typeof reviewId !== 'string' || reviewId === '') return initialState();

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
  const [pending, dispatch] = useReducer(reduce, pullRequest, initialPendingReview);

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

  const mutate = useCallback(
    (document: string, variables: Record<string, JsonValue>) =>
      // `pr` lets the worker drop the now-stale cached threads for this pull
      // request instead of serving what the reviewer just changed.
      request(message('mutate', { document, variables, pr: prRef })),
    [prRef],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean): Promise<void> => {
      const before = liveNow.current.find((thread) => thread.id === threadId);
      if (before === undefined) return;

      clearFailure(threadId);
      patchThread(threadId, { isResolved: resolved });

      const response = await mutate(resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD, {
        threadId,
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

      const response = await mutate(ADD_REPLY, {
        pullRequestReviewThreadId: threadId,
        body,
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
    [clearFailure, fail, mutate],
  );

  const postThread = useCallback(
    async ({ path, body, anchor }: NewThreadInput): Promise<boolean> => {
      clearFailure(NEW_THREAD);

      const variables: Record<string, JsonValue> = {
        // Exactly one of pullRequestId / pullRequestReviewId, chosen by the
        // machine. The unused one is left out of the object entirely: an
        // explicit null is sent as a null, which is not the same thing.
        ...commentTarget(pendingNow.current, prId),
        path,
        body,
        line: anchor.line,
        side: anchor.side,
        ...(anchor.startLine !== undefined && anchor.startSide !== undefined
          ? { startLine: anchor.startLine, startSide: anchor.startSide }
          : {}),
      };

      const response = await mutate(ADD_THREAD, variables);
      if (!response.ok) {
        fail(NEW_THREAD, `Posting this comment failed: ${response.error.message}`);
        return false;
      }

      const created = readThread(
        field(response.data.data, 'addPullRequestReviewThread', 'thread'),
      );
      if (created !== null) setLive((list) => [...list, created]);
      dispatch({ type: 'comment-added' });
      return true;
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
      drafts,
      failures,
      sending,
      setResolved,
      reply,
      postThread,
      clearFailure,
    }),
    [
      prId,
      prRef,
      live,
      byPath,
      byId,
      pending,
      drafts,
      failures,
      sending,
      setResolved,
      reply,
      postThread,
      clearFailure,
    ],
  );

  return (
    <ReviewSessionContext.Provider value={value}>
      {children}
    </ReviewSessionContext.Provider>
  );
}
