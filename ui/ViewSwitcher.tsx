/**
 * The vertical rail that swaps what the page is showing.
 *
 * Three views rather than one page with everything on it: the diff, the
 * conversations, and what the change claims to do. Each gets the whole window,
 * because each was previously squeezed into a corner of the rail and none of
 * them read well there.
 *
 * A real `tablist` — arrow keys move between views and wrap, Home and End go to
 * the ends, and only the active tab is in the tab order so Tab reaches the view
 * rather than walking the rail. Selection follows focus: there are three views,
 * showing one costs nothing, and making the reviewer press Enter as well is
 * ceremony.
 *
 * The icons are drawn here rather than pulled in. This project takes no new
 * dependencies, and three 16px glyphs are not a reason to break that.
 */

import type { KeyboardEvent, ReactNode } from 'react';

/** A stack of lines with a couple marked: a diff, at 16px. */
function FilesIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M2 3.25A.75.75 0 0 1 2.75 2.5h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.25Zm0 3.5a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 2 6.75Zm0 3.5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z"
      />
    </svg>
  );
}

/** A speech bubble with a tail. */
function ConversationsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M2.75 2h10.5A1.75 1.75 0 0 1 15 3.75v7A1.75 1.75 0 0 1 13.25 12.5H8.06l-3.03 2.28A.75.75 0 0 1 3.83 14.2V12.5h-1.08A1.75 1.75 0 0 1 1 10.75v-7A1.75 1.75 0 0 1 2.75 2Zm0 1.5a.25.25 0 0 0-.25.25v7c0 .138.112.25.25.25h1.83a.75.75 0 0 1 .75.75v.94l2.03-1.53a.75.75 0 0 1 .45-.16h5.44a.25.25 0 0 0 .25-.25v-7a.25.25 0 0 0-.25-.25Z"
      />
    </svg>
  );
}

/** An i in a circle. */
function OverviewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9 3.25a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-3a.75.75 0 0 1 0-1.5h.5a.75.75 0 0 1 .75.75ZM8 5.5A.9.9 0 1 1 8 3.7a.9.9 0 0 1 0 1.8Z"
      />
    </svg>
  );
}

export const VIEWS = [
  { id: 'files', label: 'Files', Icon: FilesIcon },
  { id: 'conversations', label: 'Conversations', Icon: ConversationsIcon },
  { id: 'overview', label: 'Overview', Icon: OverviewIcon },
] as const;

export type ReviewView = (typeof VIEWS)[number]['id'];

export const viewId = (view: ReviewView): string => `review-view-${view}`;
export const viewTabId = (view: ReviewView): string => `review-tab-${view}`;

/** Past this the number stops being a count and starts being a width. */
const BADGE_LIMIT = 99;

export interface ViewSwitcherProps {
  active: ReviewView;
  /** Open threads on the whole pull request, for the badge. */
  unresolved: number;
  onSelect: (view: ReviewView) => void;
}

/** Where an arrow key lands, wrapping at both ends. */
function nextView(from: number, key: string): ReviewView | null {
  const last = VIEWS.length - 1;
  if (key === 'ArrowDown') return VIEWS[from === last ? 0 : from + 1]?.id ?? null;
  if (key === 'ArrowUp') return VIEWS[from === 0 ? last : from - 1]?.id ?? null;
  if (key === 'Home') return VIEWS[0]?.id ?? null;
  if (key === 'End') return VIEWS[last]?.id ?? null;
  return null;
}

export function ViewSwitcher({ active, unresolved, onSelect }: ViewSwitcherProps) {
  const index = VIEWS.findIndex((view) => view.id === active);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextView(index, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    // Focus follows selection, so the arrows keep working from the tab they
    // just landed on rather than from the one that was left behind.
    document.getElementById(viewTabId(next))?.focus();
  };

  return (
    <div
      className="viewswitcher"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Views"
      onKeyDown={onKeyDown}
    >
      {VIEWS.map(({ id, label, Icon }) => {
        // Only ever on Conversations, and only when there is something to
        // say. A zero badge is a control that draws the eye to nothing.
        const badge: ReactNode =
          id === 'conversations' && unresolved > 0 ? (
            <span className="view-badge" aria-hidden="true">
              {unresolved > BADGE_LIMIT ? `${BADGE_LIMIT}+` : unresolved}
            </span>
          ) : null;

        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={viewTabId(id)}
            className={`view-tab${id === active ? ' view-tab-active' : ''}`}
            // The label is spelled out rather than left to the text content:
            // the badge is inside the button, and "Conversations 3" is not a
            // name — it is a name and a number read as one word.
            aria-label={badge === null ? label : `${label}, ${unresolved} unresolved`}
            aria-selected={id === active}
            aria-controls={viewId(id)}
            tabIndex={id === active ? 0 : -1}
            onClick={() => onSelect(id)}
          >
            <span className="view-icon">
              <Icon />
              {badge}
            </span>
            <span className="view-label" aria-hidden="true">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
