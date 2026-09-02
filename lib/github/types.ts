export type DiffSide = 'LEFT' | 'RIGHT';
export type ThreadSubjectType = 'LINE' | 'FILE';
export type FileViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';
export type PatchStatus =
  | 'ADDED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'MODIFIED' | 'CHANGED';
export type ReviewState =
  | 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' | 'DISMISS';

export interface ReviewComment {
  id: string;
  author: { login: string; avatarUrl: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

/**
 * A thread's comments, as the connection GraphQL actually returns.
 *
 * Not a bare array: `comments(first: 50)` is not paginated — a thread with more
 * than fifty replies is vanishingly rare next to a pull request with more than
 * a hundred files, and one more round trip per thread is not worth it. But the
 * fifty-first has to be *detectable*, so `totalCount` travels with the nodes
 * and `totalCount > nodes.length` means the rest are on GitHub.
 */
export interface ReviewCommentConnection {
  /** Every comment on the thread, including any beyond the page returned. */
  totalCount: number;
  nodes: ReviewComment[];
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  /** null whenever isOutdated is true. Never assume a number. */
  line: number | null;
  /** Equals `line` for single-line threads — it is NOT null. */
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: DiffSide;
  /** null for single-line threads. */
  startDiffSide: DiffSide | null;
  subjectType: ThreadSubjectType;
  viewerCanReply: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: ReviewCommentConnection;
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewerViewedState: FileViewedState;
}
