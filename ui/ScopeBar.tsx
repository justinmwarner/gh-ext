/**
 * What the diff column is showing, said out loud, always.
 *
 * A diff scoped to one commit and the whole pull request render identically —
 * same cards, same tree, same line numbers — and the difference between them
 * is the difference between "nobody changed that" and "nobody changed that
 * *in this commit*". A reviewer who has forgotten which one they are on can
 * approve a pull request having read a tenth of it.
 *
 * So this is not a status line that appears when something is narrowed. It is
 * on screen for every state including the ordinary one, because a control that
 * only exists when it has something to say is one the reviewer stops looking
 * for.
 *
 * It is also where every scope control lives. They used to be split between
 * the top bar and nothing, which is how "since my last review" ended up as a
 * feature of its own rather than one preset among several.
 */

import type { ResolvedScope } from '@/lib/review/diffScope';

const NEVER_REVIEWED =
  'You have not reviewed this pull request yet, so there is no earlier commit ' +
  'to compare against.';

const SHORT_LIST =
  'GitHub sent 250 of this pull request’s commits and reports no more, so ' +
  'the list you are choosing from is not the whole history. Open it on GitHub ' +
  'to see the rest.';

const NO_LIST =
  'This pull request’s commits could not be read, so there is nothing to ' +
  'choose from. Reload to try again.';

export interface ScopeBarProps {
  /** The scope the reviewer asked for, resolved against the current history. */
  scope: ResolvedScope;
  /** How many commits the picker has. Fewer than the pull request may have. */
  commitCount: number;
  /** GitHub sent fewer commits than it says exist, or none at all. */
  commitsTruncated: boolean;
  /** False for a first-time reviewer: there is nothing to compare from. */
  sinceReviewAvailable: boolean;
  /** Whether the preset is the thing currently narrowing the column. */
  sinceReviewActive: boolean;
  /** True while the narrowed diff is being fetched. */
  busy: boolean;
  /** Why the comparison could not be shown. Null when nothing went wrong. */
  requestError: string | null;
  onOpenPicker: () => void;
  onSinceReview: () => void;
  onShowAll: () => void;
}

/**
 * One word for the state, on a data attribute.
 *
 * Read by the stylesheet so a narrowed column is visibly not the whole one,
 * and by the tests, which is the same guarantee stated twice.
 */
function scopeState(scope: ResolvedScope): string {
  switch (scope.kind) {
    case 'whole':
      return 'whole';
    case 'lost':
      return 'lost';
    case 'unchanged':
      return 'unchanged';
    case 'narrowed':
      return 'narrowed';
  }
}

function showing(scope: ResolvedScope, commitCount: number): string {
  switch (scope.kind) {
    case 'whole':
      return commitCount === 0
        ? 'Showing the whole pull request'
        : `Showing all ${commitCount} commits`;
    case 'lost':
    case 'unchanged':
      // The whole diff is what is actually on screen in both of these, and the
      // reason sits beside it. Saying "showing commit abc1234" here would name
      // a diff the reviewer is not looking at.
      return `Showing all ${commitCount} commits`;
    case 'narrowed':
      return `Showing ${scope.label}`;
  }
}

export function ScopeBar({
  scope,
  commitCount,
  commitsTruncated,
  sinceReviewAvailable,
  sinceReviewActive,
  busy,
  requestError,
  onOpenPicker,
  onSinceReview,
  onShowAll,
}: ScopeBarProps) {
  return (
    <div className="scope-bar" data-scope={scopeState(scope)}>
      <p className="scope-showing">
        {busy ? 'Comparing…' : showing(scope, commitCount)}
      </p>

      <div className="scope-actions">
        <button
          type="button"
          className="button"
          // Nothing to choose from, and a picker that opens on an empty list is
          // a control that appears to be broken.
          disabled={commitCount === 0}
          title={commitCount === 0 ? NO_LIST : undefined}
          onClick={onOpenPicker}
        >
          Choose commits…
        </button>
        {/* Disabled rather than hidden when there is no prior review. A control
            that appears and disappears with the pull request is one the
            reviewer has to rediscover; a disabled one explains itself. */}
        <button
          type="button"
          className="button"
          aria-pressed={sinceReviewActive}
          disabled={!sinceReviewAvailable || busy}
          title={sinceReviewAvailable ? undefined : NEVER_REVIEWED}
          onClick={onSinceReview}
        >
          Since my last review
        </button>
        {scope.kind !== 'whole' && (
          <button type="button" className="button" onClick={onShowAll}>
            Show all commits
          </button>
        )}
      </div>

      {/* `status` rather than `alert`: none of these is a failure of something
          the reviewer just did, and an assertive announcement on every toggle
          would talk over them while they read. */}
      {(scope.kind === 'lost' || scope.kind === 'unchanged' || commitsTruncated) && (
        <p className="scope-note" role="status">
          {scope.kind === 'lost' || scope.kind === 'unchanged' ? scope.message : null}
          {commitsTruncated && (commitCount === 0 ? NO_LIST : SHORT_LIST)}
        </p>
      )}

      {requestError !== null && (
        <p className="scope-note" role="alert">
          {`That comparison could not be loaded: ${requestError} Showing the whole pull request.`}
        </p>
      )}
    </div>
  );
}
