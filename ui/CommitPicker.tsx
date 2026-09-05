/**
 * Choosing which commits the column shows.
 *
 * Two gestures, and the second is the reason this is a panel rather than a
 * `<select>`: picking one commit is a click, and picking a range is "compare
 * from here" on one row followed by a click on another. Both are ordinary
 * buttons, so both work from the keyboard — a shift-click range would be
 * unreachable for anyone who does not use a mouse, and this list is long
 * enough that it matters.
 *
 * Ordered oldest first, the order GitHub returns and the order a branch reads
 * in. The commit picker on GitHub's own Files-changed tab reads the same way,
 * and a reviewer arriving from it should not have to re-learn the direction.
 *
 * Range selection is deliberately anchored rather than modal: after "compare
 * from here" the list stays exactly where it was, with the anchor marked, so
 * the second click is a click on the list the reviewer is already reading.
 */

import { useEffect, useRef, useState } from 'react';
import type { PrCommit } from '@/lib/github/types';
import { commitLabel } from '@/lib/review/diffScope';
import { shortDate } from './timestamp';

export interface CommitPickerProps {
  commits: readonly PrCommit[];
  /** The two ends currently showing, so the list can mark them. */
  selected: { from: string; to: string } | null;
  onPick: (from: string, to: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}

/** Where each oid sits, so a range can be marked without scanning per row. */
const positions = (commits: readonly PrCommit[]): Map<string, number> =>
  new Map(commits.map((commit, index) => [commit.oid, index]));

export function CommitPicker({
  commits,
  selected,
  onPick,
  onShowAll,
  onClose,
}: CommitPickerProps) {
  /** The first end of a range, once the reviewer has named one. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes, and the panel takes focus so it does. Both are what every
  // other overlay on this page does; a dialog the keyboard cannot leave is
  // worse than no dialog.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  const index = positions(commits);
  const range =
    selected === null
      ? null
      : {
          lo: Math.min(index.get(selected.from) ?? -1, index.get(selected.to) ?? -1),
          hi: Math.max(index.get(selected.from) ?? -1, index.get(selected.to) ?? -1),
        };

  const choose = (oid: string): void => {
    // An anchor makes this the far end of a range; without one it is a single
    // commit, which `resolveScope` treats as the one-commit range it is.
    onPick(anchor ?? oid, oid);
    setAnchor(null);
    onClose();
  };

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        className="overlay commit-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Commits"
        tabIndex={-1}
        ref={panel}
        // The backdrop closes; a click on the panel itself must not travel up
        // to it and close the thing that was just clicked.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="overlay-head">
          <h2>Commits</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="commit-picker-hint" role="status">
          {anchor === null
            ? 'Choose a commit to see only what it changed, or start a range with “compare from”.'
            : 'Now choose the other end of the range.'}
        </p>

        <ul className="commit-list">
          <li>
            <button type="button" className="commit-row" onClick={onShowAll}>
              <span className="commit-headline">All commits</span>
            </button>
          </li>

          {commits.map((commit, position) => {
            const inRange =
              range !== null && position >= range.lo && position <= range.hi;
            return (
              <li key={commit.oid}>
                <button
                  type="button"
                  className="commit-row"
                  data-commit={commit.oid}
                  data-selected={inRange ? '' : undefined}
                  // Named rather than merely labelled, because the accessible
                  // name is the whole of what a screen reader gets and
                  // "830bef0" on its own says nothing about which change it is.
                  aria-label={`Select commit ${commitLabel(commit)}`}
                  aria-pressed={inRange}
                  onClick={() => {
                    choose(commit.oid);
                  }}
                >
                  <code className="commit-oid">{commit.abbreviatedOid}</code>
                  <span className="commit-headline">{commit.messageHeadline}</span>
                  <span className="commit-meta">
                    {commit.authorLogin ?? commit.authorName ?? 'unknown author'}
                    {' · '}
                    {shortDate(commit.committedDate)}
                  </span>
                </button>
                <button
                  type="button"
                  className="commit-anchor"
                  aria-label={`Compare from ${commitLabel(commit)}`}
                  aria-pressed={anchor === commit.oid}
                  onClick={() => {
                    setAnchor((current) => (current === commit.oid ? null : commit.oid));
                  }}
                >
                  {anchor === commit.oid ? 'From here' : 'Compare from'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
