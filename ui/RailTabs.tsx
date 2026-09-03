/**
 * The rail's tab strip: which page is showing above the file tree.
 *
 * Two pages rather than four sections stacked in a disclosure. The Overview
 * used to carry everything the diff column cannot show, which meant the thing
 * a reviewer looks at most — what is still outstanding — was at the bottom of
 * a scrolling box under a description of arbitrary length.
 *
 * A real `tablist`, because the keyboard behaviour is the whole difference
 * between this and two buttons: arrows move between tabs and wrap, Home and
 * End go to the ends, and only the active tab is in the tab order so Tab
 * reaches the page rather than walking the strip.
 *
 * Selection follows focus. With two tabs and no cost to showing either, making
 * the reviewer press Enter as well is ceremony.
 */

import type { KeyboardEvent } from 'react';

export const RAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'conversations', label: 'Conversations' },
] as const;

export type RailTab = (typeof RAIL_TABS)[number]['id'];

export const panelId = (tab: RailTab): string => `rail-panel-${tab}`;
export const tabId = (tab: RailTab): string => `rail-tab-${tab}`;

export interface RailTabsProps {
  active: RailTab;
  onSelect: (tab: RailTab) => void;
}

/** Where an arrow key lands, wrapping at both ends. */
function nextTab(from: number, key: string): RailTab | null {
  const last = RAIL_TABS.length - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return RAIL_TABS[from === last ? 0 : from + 1]?.id ?? null;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return RAIL_TABS[from === 0 ? last : from - 1]?.id ?? null;
  }
  if (key === 'Home') return RAIL_TABS[0]?.id ?? null;
  if (key === 'End') return RAIL_TABS[last]?.id ?? null;
  return null;
}

export function RailTabs({ active, onSelect }: RailTabsProps) {
  const index = RAIL_TABS.findIndex((tab) => tab.id === active);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextTab(index, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    // Focus follows selection, so the arrow keys keep working from the tab
    // they just landed on rather than from the one that was left behind.
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className="rail-tabs" role="tablist" aria-label="Pull request" onKeyDown={onKeyDown}>
      {RAIL_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          className={`rail-tab${tab.id === active ? ' rail-tab-active' : ''}`}
          aria-selected={tab.id === active}
          aria-controls={panelId(tab.id)}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
