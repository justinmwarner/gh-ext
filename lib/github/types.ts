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
  comments: ReviewComment[];
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewerViewedState: FileViewedState;
}
