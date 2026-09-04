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

/**
 * One commit in a pull request's history, as the picker and the scope need it.
 *
 * `parentOid` is the first parent and is what makes "show me just this commit"
 * expressible: the only diff endpoint this extension may use compares two
 * commits, so a single commit is the compare between it and what came before
 * it. Taking the previous *entry in the list* instead would be wrong twice —
 * the first commit of a pull request has no previous entry, and a list that
 * interleaves commits merged in from the base branch can put a commit next to
 * one that is not its parent.
 *
 * Nullable because GraphQL nulls out what it could not resolve, and because a
 * root commit genuinely has none. Either way there is no earlier point to
 * compare against, which the caller has to say rather than guess at.
 */
export interface PrCommit {
  oid: string;
  /** GitHub's own abbreviation. Its length varies with the repository's size. */
  abbreviatedOid: string;
  messageHeadline: string;
  /** ISO 8601, as GitHub sends it. */
  committedDate: string;
  /** The author's GitHub login, or null for a commit by a non-user email. */
  authorLogin: string | null;
  /** The name on the commit itself. Null when GitHub resolved neither. */
  authorName: string | null;
  parentOid: string | null;
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewerViewedState: FileViewedState;
}
