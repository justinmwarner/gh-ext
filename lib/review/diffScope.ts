/**
 * What the diff column is showing, resolved down to two commits.
 *
 * Every narrowing this page offers is the same request: a compare between two
 * commits. A single commit, a range of them and "since my last review" differ
 * only in which two commits they name, so they are one mechanism with three
 * ways in rather than three features that can disagree with each other.
 *
 * Three-dot, always, and not as a preference. `GET /repos/{o}/{r}/compare/{a}..{b}`
 * answers **404** — verified against the live API on 2026-09-04 — so the only
 * range syntax available is `{a}...{b}`, which is the diff from `merge-base(a, b)`
 * to `b`. Where the two forms could disagree, three-dot is also the one that
 * answers the reviewer's question: after a force-push the two ends may have
 * diverged, and the two-dot form would show the divergence as reverted lines.
 *
 * The scope holds no resolved SHA of its own beyond the commits the reviewer
 * picked. Everything else — the parent to compare against, the pull request's
 * head — is read from the payload at resolve time, so a scope cannot outlive
 * the history it was chosen from.
 *
 * Pure by contract: no DOM, no `chrome.*`, no transport.
 */

import type { PrCommit } from '../github/types';
import type { AnnotationSide } from './threads';

/** The two commits a narrowed diff is taken between. */
export interface ScopeRange {
  base: string;
  head: string;
}

/**
 * Which sides of the on-screen diff number their lines the same way the pull
 * request's own diff does.
 *
 * This is the whole reason a narrowed diff is dangerous. A review thread's
 * `line` is a position in the *pull request's* diff: on the additions side,
 * a line of the file at the pull request's head; on the deletions side, a line
 * of the file at its base. A narrowed diff numbers its additions against its
 * own head and its deletions against its own base, so unless those commits are
 * the same commits, line 42 here is not line 42 there — and it is very likely
 * to exist, so the annotation renders, on the wrong text, silently.
 *
 * Anchoring and the composer both consult this. Being unable to draw a comment
 * costs the reviewer a click into the per-file list; drawing it in the wrong
 * place, or posting one against a line the reviewer never read, does not
 * announce itself at all.
 */
export type AnchorableSides = Record<AnnotationSide, boolean>;

/** The whole pull request. Both sides line up because it *is* the diff. */
export const BOTH_SIDES: AnchorableSides = { additions: true, deletions: true };

/**
 * What the reviewer asked for.
 *
 * `since-review` carries no commit. The commit it compares from is
 * `viewerLatestReview`, which travels in the payload — holding a copy here
 * would let a refreshed payload and a stale scope disagree about which review
 * "my last review" means.
 */
export type DiffScope =
  | { kind: 'whole' }
  | { kind: 'since-review' }
  | { kind: 'commits'; from: string; to: string };

export const WHOLE_DIFF: DiffScope = { kind: 'whole' };

/** What the shell needs to resolve a scope. All of it comes off the payload. */
export interface ScopeContext {
  /** The pull request's commits, oldest first, as GitHub orders them. */
  commits: readonly PrCommit[];
  /** `baseRefOid` — the commit the pull request's own diff starts from. */
  prBase: string | null;
  /** `headRefOid`. */
  prHead: string;
  /** `viewerLatestReview.commit.oid`, or null for a first-time reviewer. */
  reviewedAt: string | null;
}

export type ResolvedScope =
  | { kind: 'whole' }
  | {
      kind: 'narrowed';
      range: ScopeRange;
      /** Short enough for a chip: "Commit 830bef0", "3 commits". */
      label: string;
      sides: AnchorableSides;
    }
  /** The two ends are the same commit, so there is nothing to fetch. */
  | { kind: 'unchanged'; label: string; message: string }
  /** The scope names something this pull request no longer has. */
  | { kind: 'lost'; message: string };

const WHOLE: ResolvedScope = { kind: 'whole' };

/** How a commit is named wherever one has to be named. */
export function commitLabel(commit: PrCommit): string {
  return `${commit.abbreviatedOid} ${commit.messageHeadline}`;
}

const sidesFor = (range: ScopeRange, context: ScopeContext): AnchorableSides => ({
  additions: range.head === context.prHead,
  // Null `prBase` is an older cached payload with no `baseRefOid`. Unknown is
  // treated as "does not line up", because the alternative is anchoring on a
  // guess.
  deletions: context.prBase !== null && range.base === context.prBase,
});

const narrowed = (
  range: ScopeRange,
  label: string,
  context: ScopeContext,
): ResolvedScope => ({
  kind: 'narrowed',
  range,
  label,
  sides: sidesFor(range, context),
});

const LOST_COMMIT =
  'That commit is no longer in this pull request — it was probably force-' +
  'pushed away. Showing the whole pull request instead.';

const NO_PARENT =
  'GitHub did not report a parent for the first commit in that selection, so ' +
  'there is nothing to compare it against. Showing the whole pull request ' +
  'instead.';

const NEVER_REVIEWED =
  'You have not reviewed this pull request yet, so there is no earlier commit ' +
  'to compare against.';

/**
 * Turn a scope into the two commits to compare, or into a reason it cannot be.
 *
 * The force-push case is the point of the `lost` arm, and it is not a
 * precaution. Observed against NixOS/nixpkgs#550556 six days after its
 * force-push: the pre-push commit is gone from `PullRequest.commits`, still
 * answers 200 on its own, and `compare/{orphan}...{new head}` still returns 200
 * with `"status": "diverged"`. So the request does not fail — it succeeds, and
 * the reviewer reads a diff against history this pull request no longer has
 * with nothing on screen to say so. Membership of the current commit list is
 * the check, and it has to happen here rather than in the request, because a
 * request that succeeds is the failure.
 */
export function resolveScope(scope: DiffScope, context: ScopeContext): ResolvedScope {
  if (scope.kind === 'whole') return WHOLE;

  if (scope.kind === 'since-review') {
    const base = context.reviewedAt;
    if (base === null) return { kind: 'lost', message: NEVER_REVIEWED };
    if (base === context.prHead) {
      return {
        kind: 'unchanged',
        label: 'Since your last review',
        message: 'Nothing has landed since your last review.',
      };
    }
    // Deliberately not checked against the commit list. The reviewed commit
    // being gone is not a choice the reviewer can correct, and a three-dot
    // compare still answers the question from the merge base — which is more
    // than they had before, and is what GitHub itself falls back to.
    return narrowed({ base, head: context.prHead }, 'Since your last review', context);
  }

  const byOid = new Map(context.commits.map((commit) => [commit.oid, commit]));
  const from = byOid.get(scope.from);
  const to = byOid.get(scope.to);
  if (from === undefined || to === undefined) {
    return { kind: 'lost', message: LOST_COMMIT };
  }

  // Ordered by position in the history rather than by which was clicked first.
  // Handing GitHub the pair the wrong way round is not an error: the compare
  // answers HTTP 200 with an empty body, which reads as "these commits changed
  // nothing".
  const fromIndex = context.commits.indexOf(from);
  const toIndex = context.commits.indexOf(to);
  const [first, last] = fromIndex <= toIndex ? [from, to] : [to, from];

  // The parent of the *earliest* selected commit, so that selecting one commit
  // and selecting a one-commit range are the same request. Any other choice
  // makes the two controls mean different things by "selected".
  const base = first.parentOid;
  if (base === null) return { kind: 'lost', message: NO_PARENT };

  const count = Math.abs(toIndex - fromIndex) + 1;
  const label = count === 1 ? `Commit ${last.abbreviatedOid}` : `${count} commits`;

  return narrowed({ base, head: last.oid }, label, context);
}
