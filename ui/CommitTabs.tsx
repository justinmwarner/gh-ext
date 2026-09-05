/**
 * The pull request's commits, as a numbered strip.
 *
 * A branch is a sequence and wants to be shown as one. Numbers rather than
 * subjects because the subjects are long, of wildly varying length, and mostly
 * say the same thing as each other — a strip of them is unscannable, and what a
 * reviewer is doing here is stepping along a history rather than reading it.
 *
 * What a number cannot say, the line underneath says. Whichever commit the
 * pointer or the keyboard is on is spelled out in **one fixed place**, and the
 * fixedness is the point: a tooltip that follows the pointer makes the eye
 * chase it, and the whole value of a strip is that you can sweep along it. It
 * also means the keyboard gets the same thing the pointer does for free, which
 * a hover card would have had to be taught.
 *
 * `role="toolbar"` with a roving tabindex rather than a tablist: these buttons
 * do not control panels, they set one filter, and a pull request with two
 * hundred commits must not be two hundred tab stops.
 */

import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import type { PrCommit } from '@/lib/github/types';
import { type DiffScope, WHOLE_DIFF } from '@/lib/review/diffScope';
import { formatTimestamp } from './timestamp';

export interface CommitTabsProps {
  /** Oldest first, the order GitHub returns and the branch reads in. */
  commits: readonly PrCommit[];
  scope: DiffScope;
  onScope: (scope: DiffScope) => void;
  /**
   * What the line says when nothing is hovered and no number is selected.
   *
   * The whole diff has no commit to describe, and a blank line there would
   * move everything below it the moment the pointer touched the strip. The
   * caller passes what it would have said anyway.
   */
  fallback?: string;
}

/** `null` for the whole diff; otherwise an index into `commits`. */
type Slot = number | null;

const author = (commit: PrCommit): string =>
  commit.authorLogin ?? commit.authorName ?? 'unknown author';

/** The whole commit, for the native tooltip and the accessible name. */
const describe = (commit: PrCommit, index: number): string =>
  `Commit ${index + 1}, ${commit.abbreviatedOid} — ${commit.messageHeadline} — ` +
  `${author(commit)}, ${formatTimestamp(commit.committedDate)}`;

export function CommitTabs({ commits, scope, onScope, fallback = '' }: CommitTabsProps) {
  const [hovered, setHovered] = useState<Slot>(null);
  const [focusSlot, setFocusSlot] = useState<Slot>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const index = useMemo(
    () => new Map(commits.map((commit, at) => [commit.oid, at])),
    [commits],
  );

  /**
   * Which numbers are part of what the column is showing.
   *
   * Every commit in a range, not only its ends: the reviewer is looking at all
   * of them, and pressing two tabs out of five would say the middle three were
   * not selected. Null for `since-review`, which is a scope no number on this
   * strip describes.
   */
  const span = useMemo((): { first: number; last: number } | null => {
    if (scope.kind !== 'commits') return null;
    const from = index.get(scope.from);
    const to = index.get(scope.to);
    if (from === undefined || to === undefined) return null;
    return { first: Math.min(from, to), last: Math.max(from, to) };
  }, [scope, index]);

  const selected = (slot: Slot): boolean =>
    slot === null
      ? scope.kind === 'whole'
      : span !== null && slot >= span.first && slot <= span.last;

  const choose = (slot: Slot, extend: boolean): void => {
    if (slot === null) {
      onScope(WHOLE_DIFF);
      return;
    }
    const commit = commits[slot];
    if (commit === undefined) return;

    // Shift or control extends from whatever is already selected. Shift is the
    // convention for a range and control for a set, but there are no disjoint
    // sets here — the diff between two commits is the span between them — so
    // both mean the same thing rather than one of them meaning nothing.
    //
    // With nothing selected there is no anchor to extend from, so it is an
    // ordinary click.
    const anchor = extend && span !== null ? span : null;
    if (anchor === null) {
      onScope({ kind: 'commits', from: commit.oid, to: commit.oid });
      return;
    }

    // The nearer end of the current selection stays put and the other moves,
    // which is what makes a second shift-click feel like dragging.
    const other = slot <= anchor.first ? anchor.last : anchor.first;
    const first = commits[Math.min(slot, other)];
    const last = commits[Math.max(slot, other)];
    if (first === undefined || last === undefined) return;
    // Ordered the way the history runs. A range whose ends are reversed asks
    // GitHub to compare backwards, which answers with an empty diff.
    onScope({ kind: 'commits', from: first.oid, to: last.oid });
  };

  /**
   * The buttons, as a discriminated union rather than two nullable variables.
   * `slot` and `commit` are the same fact twice, and nothing can correlate them
   * for the compiler — or for the next reader — unless they travel together.
   */
  type Entry = { kind: 'all' } | { kind: 'commit'; index: number; commit: PrCommit };
  const entries: Entry[] = [
    { kind: 'all' },
    ...commits.map((commit, index): Entry => ({ kind: 'commit', index, commit })),
  ];

  const slots: Slot[] = entries.map((entry) => (entry.kind === 'all' ? null : entry.index));
  const key = (slot: Slot): string => (slot === null ? 'all' : String(slot));

  // Exactly one button is in the tab order. A two-hundred-commit pull request
  // is two hundred tab stops otherwise.
  const tabbable: Slot = focusSlot ?? (span === null ? null : span.first);

  const move = (to: Slot): void => {
    setFocusSlot(to);
    elements.current.get(key(to))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = slots.indexOf(focusSlot ?? tabbable);
    if (at === -1) return;

    if (event.key === 'ArrowRight') move(slots[Math.min(at + 1, slots.length - 1)] ?? null);
    else if (event.key === 'ArrowLeft') move(slots[Math.max(at - 1, 0)] ?? null);
    else if (event.key === 'Home') move(slots[0] ?? null);
    else if (event.key === 'End') move(slots[slots.length - 1] ?? null);
    else return;

    event.preventDefault();
  };

  // A strip with only an "All" tab on it is a control that appears broken.
  if (commits.length === 0) return null;

  /**
   * What the line underneath says: the commit under the pointer or the
   * keyboard, and failing that the one the column is actually showing.
   */
  const shown = hovered ?? focusSlot;
  const detail = ((): string => {
    if (shown !== null) {
      const commit = commits[shown];
      return commit === undefined ? '' : describe(commit, shown);
    }
    if (span === null) return fallback;
    if (span.first !== span.last) {
      const first = commits[span.first];
      const last = commits[span.last];
      return first === undefined || last === undefined
        ? ''
        : `${span.last - span.first + 1} commits, ${first.abbreviatedOid} to ${last.abbreviatedOid}`;
    }
    const commit = commits[span.first];
    return commit === undefined ? '' : describe(commit, span.first);
  })();

  return (
    <div className="commit-tabs">
      <div
        className="commit-strip"
        role="toolbar"
        aria-orientation="horizontal"
        aria-label="Scope the diff to a commit"
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHovered(null)}
      >
        {entries.map((entry) => {
          const slot: Slot = entry.kind === 'all' ? null : entry.index;
          const label =
            entry.kind === 'all'
              ? 'All'
              : `Commit ${entry.index + 1}, ${entry.commit.abbreviatedOid}`;

          return (
            <button
              key={key(slot)}
              ref={(node) => {
                if (node === null) elements.current.delete(key(slot));
                else elements.current.set(key(slot), node);
              }}
              type="button"
              className="commit-tab"
              // A digit is not a name. The strip is scannable *because* the
              // button says one character; everything else it has to say goes
              // here and on the title.
              aria-label={label}
              title={
                entry.kind === 'all'
                  ? 'The whole pull request'
                  : describe(entry.commit, entry.index)
              }
              aria-pressed={selected(slot)}
              tabIndex={slot === tabbable ? 0 : -1}
              onMouseEnter={() => setHovered(slot)}
              onFocus={() => setFocusSlot(slot)}
              onBlur={() => setFocusSlot(null)}
              onClick={(event) => {
                choose(slot, event.shiftKey || event.ctrlKey || event.metaKey);
                // Focus stays on the button, but it stops driving the line.
                // Otherwise a range the reviewer has just made goes on being
                // described by whichever of its ends they clicked — which is
                // the one moment they want to be told what the range *is*.
                setFocusSlot(null);
              }}
            >
              {entry.kind === 'all' ? 'All' : entry.index + 1}
            </button>
          );
        })}
      </div>

      {/* One fixed place, always rendered. A line that appears and disappears
          moves everything below it every time the pointer crosses the strip. */}
      <p className="commit-detail" data-testid="commit-details">
        {detail}
      </p>
    </div>
  );
}
