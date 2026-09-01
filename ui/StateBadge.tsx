/**
 * Open, Draft, Merged or Closed.
 *
 * Colour alone would not say it — the badge always carries the word, so it
 * survives a screen reader and a colour-blind reviewer alike.
 */

import type { PrState } from './prNode';

const LABELS: Record<PrState, string> = {
  OPEN: 'Open',
  DRAFT: 'Draft',
  MERGED: 'Merged',
  CLOSED: 'Closed',
};

export function StateBadge({ state }: { state: PrState }) {
  return <span className={`badge badge-${state.toLowerCase()}`}>{LABELS[state]}</span>;
}
