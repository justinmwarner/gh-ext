/**
 * Whose turn it is, worked out from what GitHub already said.
 *
 * This is the whole of the dashboard's organising rule and it is deliberately
 * one pure function over one plain object. Nothing here reads storage, calls
 * GitHub, or knows what a bucket looks like on screen — which is what lets the
 * rules be argued about in a test file rather than in a component.
 *
 * There are no manual tags. Every bucket below is derived on every load, so it
 * cannot go stale, needs nothing stored, and reads the same on a second
 * machine. `lib/dashboard/overrides.ts` is the one place a reviewer overrules
 * it, and that override is stamped so it cannot outlive the fact it overruled.
 *
 * Derived from docs/superpowers/specs/2026-09-13-pull-request-dashboard-design.md
 * section 1, whose field list was executed against the live schema on
 * 2026-09-13.
 */

/**
 * One pull request, flattened.
 *
 * Plain JSON by construction — these cross `runtime.sendMessage`, so instants
 * are epoch milliseconds and absence is `null`, per `lib/messages.ts`.
 *
 * Deliberately not the GraphQL node. The query selects nested connections and
 * unions; everything that survives into here is a scalar the rules or the row
 * actually read, which is what keeps the rules readable.
 */
export interface PrSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  /** `owner/name`. One string because nothing here ever needs the halves. */
  repo: string;
  isPrivate: boolean;
  /** Null for a deleted account, which GitHub still returns pull requests for. */
  author: string | null;
  isDraft: boolean;
  createdAt: number;
  updatedAt: number;
  headRefOid: string;
  viewerDidAuthor: boolean;
  /**
   * Whether this account is on the reviewer list and has not answered yet.
   *
   * From the `review-requested:@me` search rather than from a field, because
   * `reviewRequests` empties the moment a review is submitted and this has to
   * stay true for a request that is still outstanding.
   */
  reviewRequestedFromViewer: boolean;
  reviewDecision: string | null;
  /**
   * The reviewer's own last review, and the commit it was written against.
   *
   * `commitOid` is null when GitHub could not anchor the review to a commit.
   * That null is load-bearing — see {@link pushedSince}.
   */
  viewerLatestReview: { state: string; commitOid: string | null } | null;
  /** How many reviewers are still being waited on. */
  reviewRequestCount: number;
  /** `statusCheckRollup.state`, or null when the head commit has no checks. */
  checks: string | null;
  mergeStateStatus: string | null;
  unresolvedCount: number;
  /**
   * Of those, how many were last spoken in by somebody else.
   *
   * The count that decides whether a conversation is waiting on the author.
   * A thread the author replied to last is one they have already answered,
   * and counting it would put their own pull request permanently in
   * blocked-on-you.
   */
  unresolvedNotByViewer: number;
  /**
   * Whether the thread list was capped before it ended.
   *
   * The query asks for 25 threads per pull request, which is a cost decision
   * rather than a belief about how many there are. When it engages the two
   * counts above are floors, and the row has to say so — the difference
   * between "three conversations are open" and "at least three are" is not one
   * a reviewer can infer from a number.
   */
  threadsTruncated: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  isReadByViewer: boolean;
}

export type BucketId =
  | 'waiting-on-you'
  | 'blocked-on-you'
  | 'ready-to-merge'
  | 'waiting-on-others'
  | 'quiet'
  | 'drafts';

/**
 * The one fact that put a pull request where it is.
 *
 * A code rather than a sentence, because two of them need a number formatted
 * beside them and one needs a relative time — both jobs for the surface that
 * is drawing, not for the rule that decided. A row that listed every signal
 * would be a row nobody reads, so there is exactly one of these per pull
 * request.
 */
export type Reason =
  | { kind: 'review-requested' }
  | { kind: 'pushed-since-review' }
  | { kind: 'changes-requested' }
  | { kind: 'unresolved'; count: number }
  | { kind: 'conflicts' }
  | { kind: 'checks-failing' }
  | { kind: 'approved-and-clean' }
  | { kind: 'awaiting-reviewers'; count: number }
  | { kind: 'approved-not-clean'; status: string | null }
  | { kind: 'draft' }
  | { kind: 'quiet'; days: number }
  | { kind: 'nothing' };

export interface Classification {
  bucket: BucketId;
  reason: Reason;
}

export interface ClassifyOptions {
  /** Epoch milliseconds. Injected so staleness is testable without a clock. */
  now: number;
  /** How long without movement before something counts as gone quiet. */
  stalenessDays: number;
}

/**
 * The buckets, in the order they are shown.
 *
 * Not the order they are evaluated in — {@link classify} tests drafts first so
 * that a draft cannot reach the top of the list through some other rule, and
 * shows them last because a draft is not asking anything of anybody. Two
 * orders, stated separately, because collapsing them is how a draft with
 * failing checks ends up above a review somebody is waiting on.
 *
 * Every label says whose turn it is. "Waiting on you" tells a reviewer what to
 * do about it; "Needs review" describes a field. PRODUCT.md's voice section is
 * why that is a rule here rather than a preference.
 */
export const BUCKET_ORDER: readonly { id: BucketId; label: string; blurb: string }[] = [
  {
    id: 'waiting-on-you',
    label: 'Waiting on you',
    blurb: 'Asked for your review, or changed since you gave it.',
  },
  {
    id: 'blocked-on-you',
    label: 'Blocked on you',
    blurb: 'Yours, and it cannot move until you do something.',
  },
  {
    id: 'ready-to-merge',
    label: 'Ready to merge',
    blurb: 'Approved, mergeable, and nobody has pressed the button.',
  },
  {
    id: 'waiting-on-others',
    label: 'Waiting on others',
    blurb: 'Yours, and out of your hands for now.',
  },
  { id: 'quiet', label: 'Quiet', blurb: 'Nothing has moved here in a while.' },
  { id: 'drafts', label: 'Drafts', blurb: 'Not asking anything of anybody yet.' },
];

/**
 * Which buckets ageing is not allowed to move.
 *
 * Two, and the list is short on purpose. `waiting-on-you` is another person
 * blocked on this reviewer — a review request does not expire, and neither
 * does a branch somebody pushed after being reviewed. `drafts` is already
 * where nothing is being asked of anybody, so there is nowhere quieter to send
 * it.
 *
 * `blocked-on-you` used to be on this list, on the reasoning that work you owe
 * does not become less yours by ageing. That reasoning is fine and the rule
 * was still wrong: run against a real account it put **47 of 52** pull
 * requests in one bucket, because every abandoned branch with red CI or a
 * stale conflict is, technically, blocked on its author. A bucket holding
 * nine tenths of the list has stopped sorting anything, and "old and not
 * needed" is a distinction the dashboard was asked for. Nothing is hidden by
 * the move — Quiet is a heading on the same page.
 */
const NEVER_GOES_QUIET: readonly BucketId[] = ['waiting-on-you', 'drafts'];

/**
 * Did the head move after the reviewer's last review?
 *
 * False when there is no review, and — the case worth naming — false when the
 * review records no commit. GitHub leaves `commit` null on a review it could
 * not anchor, and `null !== headRefOid` is true, so comparing without this
 * guard reports a push on every unanchored review. That is the loudest way to
 * be wrong on this page: it puts a pull request nobody touched at the top of
 * the list under a sentence claiming somebody did.
 */
function pushedSince(pr: PrSummary): boolean {
  const review = pr.viewerLatestReview;
  if (review === null || review.commitOid === null) return false;
  return review.commitOid !== pr.headRefOid;
}

/** Whole days between two instants, rounded down. Never negative. */
function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

/**
 * Somebody else's pull request that is waiting on this reviewer, or null.
 *
 * Two ways in. An outstanding request is the ordinary one. A push after a
 * review is the one github.com cannot filter for, and it is the commonest
 * reason a review quietly stalls — somebody answered the comments days ago and
 * the reviewer has no way to notice.
 */
function waitingOnYou(pr: PrSummary): Reason | null {
  if (pr.viewerDidAuthor) return null;
  if (pr.reviewRequestedFromViewer && pr.viewerLatestReview === null) {
    return { kind: 'review-requested' };
  }
  if (pushedSince(pr)) return { kind: 'pushed-since-review' };
  return null;
}

/**
 * The reviewer's own pull request that cannot move without them, or null.
 *
 * Ordered by how much work the answer is, cheapest first, so the sentence on
 * the row is the one the reviewer can act on soonest. Changes requested is a
 * person waiting; a conflict is a rebase; a red check is a debugging session.
 */
function blockedOnYou(pr: PrSummary): Reason | null {
  if (!pr.viewerDidAuthor) return null;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { kind: 'changes-requested' };
  if (pr.unresolvedNotByViewer > 0) {
    return { kind: 'unresolved', count: pr.unresolvedNotByViewer };
  }
  if (pr.mergeStateStatus === 'DIRTY') return { kind: 'conflicts' };
  if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') return { kind: 'checks-failing' };
  return null;
}

/** The reviewer's own pull request that is out of their hands, or null. */
function waitingOnOthers(pr: PrSummary): Reason | null {
  if (!pr.viewerDidAuthor) return null;
  if (pr.reviewDecision === 'REVIEW_REQUIRED' && pr.reviewRequestCount > 0) {
    return { kind: 'awaiting-reviewers', count: pr.reviewRequestCount };
  }
  if (pr.reviewDecision === 'APPROVED') {
    return { kind: 'approved-not-clean', status: pr.mergeStateStatus };
  }
  return null;
}

/**
 * Which bucket a pull request belongs in, and the fact that decided it.
 *
 * Evaluation order, first match winning, then one reclassification for age.
 * The order *is* the rule, so changing it is changing the product rather than
 * tidying the code.
 */
export function classify(pr: PrSummary, options: ClassifyOptions): Classification {
  const classified = derive(pr);

  // The one reclassification. Everything except the two exemptions above can
  // go quiet, including something already there — so a row that fell through
  // every rule says *why* it is quiet rather than carrying `nothing`.
  const idle = daysBetween(pr.updatedAt, options.now);
  if (idle >= options.stalenessDays && !NEVER_GOES_QUIET.includes(classified.bucket)) {
    return { bucket: 'quiet', reason: { kind: 'quiet', days: idle } };
  }
  return classified;
}

/** The bucket before age is considered. First match wins, so order is the rule. */
function derive(pr: PrSummary): Classification {
  if (pr.isDraft) return { bucket: 'drafts', reason: { kind: 'draft' } };

  const yours = waitingOnYou(pr);
  if (yours !== null) return { bucket: 'waiting-on-you', reason: yours };

  const blocked = blockedOnYou(pr);
  if (blocked !== null) return { bucket: 'blocked-on-you', reason: blocked };

  return settledOrWaiting(pr);
}

/** The three buckets left once nothing is waiting on the reviewer. */
function settledOrWaiting(pr: PrSummary): Classification {
  if (
    pr.viewerDidAuthor &&
    pr.reviewDecision === 'APPROVED' &&
    pr.mergeStateStatus === 'CLEAN'
  ) {
    return { bucket: 'ready-to-merge', reason: { kind: 'approved-and-clean' } };
  }

  const others = waitingOnOthers(pr);
  if (others !== null) return { bucket: 'waiting-on-others', reason: others };

  return { bucket: 'quiet', reason: { kind: 'nothing' } };
}
