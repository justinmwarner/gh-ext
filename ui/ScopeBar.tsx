/**
 * The one row above the diff: what is on screen, and how to change it.
 *
 * A diff scoped to one commit and the whole pull request render identically —
 * same cards, same tree, same line numbers — and the difference between them
 * is the difference between "nobody changed that" and "nobody changed that
 * *in this commit*". A reviewer who has forgotten which one they are on can
 * approve a pull request having read a tenth of it. So the sentence saying
 * which is on screen sits beside the control that sets it, and both sit
 * directly on top of the thing they describe.
 *
 * It is one row because it was three. The Files view had a bar of its own for
 * the file counts, the strip had a caption under it naming whichever commit
 * the pointer was on, and the scope buttons sat off to the side. Each was
 * defensible alone; together they were three rows of chrome above a diff that
 * wants the room, and they left the strip unable to meet the content below it,
 * which is the whole of what makes a tab look attached to what it opens.
 *
 * Now: sentence on the left, tabs across the middle, everything else behind a
 * kebab. The sentence is the part that varies in length, so it goes where
 * growing costs nothing — the tabs shift right and the strip scrolls.
 */

import type { DiffScope, ResolvedScope } from '@/lib/review/diffScope';
import type { PrCommit } from '@/lib/github/types';
import { CommitTabs } from './CommitTabs';
import { MenuButton, type MenuItem } from './MenuButton';
import type { ChangeTotals } from './reviewFiles';

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

/** Non-breaking, so the counts cannot be broken across a wrap. */
const SEPARATOR = ' ';

export interface ScopeBarProps {
  /** The scope the reviewer asked for, resolved against the current history. */
  scope: ResolvedScope;
  /** Oldest first. The strip numbers these, and numbers nothing else. */
  commits: readonly PrCommit[];
  /** The unresolved scope, which is what the strip presses its numbers from. */
  chosen: DiffScope;
  onScope: (scope: DiffScope) => void;
  /**
   * How much is on screen — summed over the list the column is drawing, not
   * over the pull request. While a narrowed diff is showing, a total for the
   * whole pull request would contradict the diff underneath it.
   */
  changed: ChangeTotals;
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
 * One word for what is on screen, on a data attribute.
 *
 * Read by the stylesheet so a narrowed column is visibly not the whole one,
 * and by the tests, which is the same guarantee stated twice.
 *
 * `failed` is a separate state from `narrowed` and not a decoration on it. A
 * comparison that could not be loaded leaves the *whole* diff on screen, so a
 * bar still reading "showing commit 830bef0" would be describing a diff the
 * reviewer is not looking at — which is the one thing this row exists to make
 * impossible.
 */
function scopeState(scope: ResolvedScope, failed: boolean): string {
  if (failed) return 'failed';
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

/**
 * What the sentence adds to the counts, or nothing.
 *
 * Nothing is the ordinary case on purpose. The pressed "All" tab already says
 * the column is showing everything, and "showing all 8 commits" beside it is
 * the same fact twice in the row with the least width to spare.
 */
function showing(
  scope: ResolvedScope,
  busy: boolean,
  failed: boolean,
): string | null {
  if (busy) return 'Comparing…';
  // Every arm but `narrowed` leaves the whole diff on screen, and so does a
  // narrowed one whose request did not answer.
  if (failed || scope.kind !== 'narrowed') return null;
  return `Showing ${scope.label}`;
}

export function ScopeBar({
  scope,
  commits,
  chosen,
  onScope,
  changed,
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
  const failed = requestError !== null;
  const narrowing = showing(scope, busy, failed);

  const items: MenuItem[] = [
    {
      id: 'choose',
      label: 'Choose commits…',
      onSelect: onOpenPicker,
      // Nothing to choose from, and a picker that opens on an empty list is a
      // control that appears to be broken.
      disabled: commitCount === 0,
      title: commitCount === 0 ? NO_LIST : undefined,
    },
    {
      id: 'since',
      label: 'Since my last review',
      onSelect: onSinceReview,
      checked: sinceReviewActive,
      disabled: !sinceReviewAvailable || busy,
      title: sinceReviewAvailable ? undefined : NEVER_REVIEWED,
    },
  ];

  // Only once there is something to come back from. Unlike the two above it,
  // this one has no state to explain while the whole diff is showing — it
  // would just be a dead row in the menu.
  if (scope.kind !== 'whole' || failed) {
    items.push({ id: 'all', label: 'Show all commits', onSelect: onShowAll });
  }

  return (
    <div className="scope-bar" data-scope={scopeState(scope, failed)}>
      {/* Left, because it is the part that varies in length. Growing here
          shifts the tabs right and costs nothing; growing between them would
          move the numbers under the reviewer's pointer. */}
      <p className="scope-status">
        {`${changed.files} ${changed.files === 1 ? 'file' : 'files'} changed`}
        <span className="scope-counts">
          <span className="additions">{`+${changed.additions}`}</span>
          {SEPARATOR}
          <span className="deletions">{`−${changed.deletions}`}</span>
        </span>
        {narrowing !== null && <span className="scope-showing">{narrowing}</span>}
      </p>

      <CommitTabs commits={commits} scope={chosen} onScope={onScope} />

      <MenuButton label="Commit options" items={items} />

      {/* `status` rather than `alert`: none of these is a failure of something
          the reviewer just did, and an assertive announcement on every toggle
          would talk over them while they read. */}
      {(scope.kind === 'lost' ||
        scope.kind === 'unchanged' ||
        commitsTruncated ||
        // A pull request has at least one commit, so an empty list is never
        // the honest answer — it means the lookup came back with nothing.
        commitCount === 0) && (
        <p className="scope-note" role="status">
          {scope.kind === 'lost' || scope.kind === 'unchanged' ? scope.message : null}
          {commitCount === 0 ? NO_LIST : commitsTruncated ? SHORT_LIST : null}
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
