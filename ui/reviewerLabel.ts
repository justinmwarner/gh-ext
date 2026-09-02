/**
 * A reviewer, said in words.
 *
 * Shared by the top bar's avatar row and the Overview's reviewer list, because
 * they must not disagree. A team slug and a bot login look exactly like a
 * username at a glance, so the kind is spelled out rather than left to be
 * inferred from a missing avatar.
 */

import type { Reviewer, ReviewerKind } from './prNode';

const KINDS: Record<ReviewerKind, string> = {
  user: '',
  team: ' (team)',
  bot: ' (bot)',
  unknown: '',
};

const VERDICTS: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'commented',
  DISMISSED: 'review dismissed',
  PENDING: 'review pending',
};

export function reviewerLabel(reviewer: Reviewer): string {
  const name = `${reviewer.login}${KINDS[reviewer.kind]}`;
  if (reviewer.state === null) return `${name} — review requested`;
  // A state this build does not recognize is shown rather than dropped: an
  // unlabelled reviewer reads as one who has not answered.
  return `${name} — ${VERDICTS[reviewer.state] ?? reviewer.state.toLowerCase()}`;
}

export function reviewerTone(reviewer: Reviewer): 'good' | 'bad' | 'neutral' {
  if (reviewer.state === 'APPROVED') return 'good';
  if (reviewer.state === 'CHANGES_REQUESTED') return 'bad';
  return 'neutral';
}
