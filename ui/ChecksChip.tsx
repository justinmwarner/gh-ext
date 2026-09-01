/**
 * The checks rollup, in one chip.
 *
 * A head commit with no checks configured is not the same as checks that have
 * not finished, and neither is a failure — the worker hands over `null` for the
 * first and a state string for the others, and the chip keeps them apart.
 */

import type { CheckRollup } from '@/lib/messages';

type Tone = 'good' | 'bad' | 'pending' | 'neutral';

/**
 * `StatusState` is EXPECTED, ERROR, FAILURE, PENDING or SUCCESS. It is typed as
 * a plain string on the wire, so an unrecognized value is shown rather than
 * silently mapped to something reassuring.
 */
function describe(checks: CheckRollup | null): { label: string; tone: Tone } {
  if (checks === null) return { label: 'No checks', tone: 'neutral' };

  switch (checks.state) {
    case 'SUCCESS':
      return { label: 'Checks passed', tone: 'good' };
    case 'FAILURE':
    case 'ERROR':
      return { label: 'Checks failed', tone: 'bad' };
    case 'PENDING':
    case 'EXPECTED':
      return { label: 'Checks running', tone: 'pending' };
    default:
      return typeof checks.state === 'string' && checks.state !== ''
        ? { label: `Checks ${checks.state.toLowerCase()}`, tone: 'neutral' }
        : { label: 'No checks', tone: 'neutral' };
  }
}

export function ChecksChip({ checks }: { checks: CheckRollup | null }) {
  const { label, tone } = describe(checks);
  return <span className={`chip chip-${tone}`}>{label}</span>;
}
