/**
 * Reading `statusCheckRollup` into something the Overview can list.
 *
 * `contexts` is a union of `CheckRun` and `StatusContext`, and both turn up on
 * real pull requests — `nodejs/node#60000` carried 41 of the first and 32 of
 * the second on a single commit. A reader that understands only `CheckRun`
 * drops the legacy commit statuses silently, and a check that renders as
 * nothing is indistinguishable from a check that does not exist.
 *
 * So the two members are not branched on at all. Both carry a name, a URL, a
 * one-line detail and a state under different field names; each is read
 * wherever it lives, and a member this build has never heard of still produces
 * a row rather than a blank.
 *
 * Every value of `CheckConclusionState` and `StatusState` from the API
 * reference is mapped. Anything outside those tables degrades to the value
 * itself in words: GitHub has grown these enums before, and "Quantum
 * uncertainty" is a worse label than the real one but a far better one than an
 * empty cell.
 */

import type { CheckRollup } from '@/lib/messages';

export type CheckTone = 'good' | 'bad' | 'pending' | 'neutral';

export interface CheckContext {
  /** Stable within one rollup. Names repeat across apps, so the index is in it. */
  key: string;
  name: string;
  /** The state, in words. Never empty. */
  label: string;
  tone: CheckTone;
  /** Only ever an http(s) URL, or null. */
  url: string | null;
  /** The app that ran it, or the status's own description. */
  detail: string | null;
}

export type ChecksSummary =
  | { kind: 'none' }
  | {
      kind: 'contexts';
      contexts: CheckContext[];
      /** Contexts beyond the first page. `contexts(first: 100)` caps. */
      withheld: number;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Server-supplied data reaching an `href`. Only http(s) may. */
const readUrl = (value: unknown): string | null => {
  const text = readString(value);
  if (text === null) return null;
  return text.startsWith('https://') || text.startsWith('http://') ? text : null;
};

/** `QUANTUM_UNCERTAINTY` → `Quantum uncertainty`. */
function humanize(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Every member of `CheckConclusionState`. */
const CONCLUSIONS: Record<string, { label: string; tone: CheckTone }> = {
  SUCCESS: { label: 'Passed', tone: 'good' },
  FAILURE: { label: 'Failed', tone: 'bad' },
  TIMED_OUT: { label: 'Timed out', tone: 'bad' },
  STARTUP_FAILURE: { label: 'Failed to start', tone: 'bad' },
  ACTION_REQUIRED: { label: 'Action required', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  NEUTRAL: { label: 'Neutral', tone: 'neutral' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
  STALE: { label: 'Stale', tone: 'neutral' },
};

/** Every member of `StatusState`. */
const STATES: Record<string, { label: string; tone: CheckTone }> = {
  SUCCESS: { label: 'Passed', tone: 'good' },
  FAILURE: { label: 'Failed', tone: 'bad' },
  ERROR: { label: 'Errored', tone: 'bad' },
  PENDING: { label: 'Pending', tone: 'pending' },
  EXPECTED: { label: 'Expected', tone: 'pending' },
};

/**
 * `CheckStatusState`, which is what a run has instead of a conclusion until it
 * finishes. A run that is still going is not a run with no result.
 */
const RUN_STATUSES: Record<string, { label: string; tone: CheckTone }> = {
  QUEUED: { label: 'Queued', tone: 'pending' },
  IN_PROGRESS: { label: 'Running', tone: 'pending' },
  WAITING: { label: 'Waiting', tone: 'pending' },
  PENDING: { label: 'Pending', tone: 'pending' },
  REQUESTED: { label: 'Requested', tone: 'pending' },
  COMPLETED: { label: 'No result reported', tone: 'neutral' },
};

function describe(row: Record<string, unknown>): { label: string; tone: CheckTone } {
  const conclusion = readString(row['conclusion']);
  if (conclusion !== null) {
    return CONCLUSIONS[conclusion] ?? { label: humanize(conclusion), tone: 'neutral' };
  }

  const state = readString(row['state']);
  if (state !== null) {
    return STATES[state] ?? { label: humanize(state), tone: 'neutral' };
  }

  const status = readString(row['status']);
  if (status !== null) {
    return RUN_STATUSES[status] ?? { label: humanize(status), tone: 'neutral' };
  }

  return { label: 'No result reported', tone: 'neutral' };
}

/** The app behind a run, when the rollup carries it. */
function appName(row: Record<string, unknown>): string | null {
  const suite = row['checkSuite'];
  if (!isRecord(suite)) return null;
  const app = suite['app'];
  return isRecord(app) ? readString(app['name']) : null;
}

function readContext(value: unknown, index: number): CheckContext {
  if (!isRecord(value)) {
    return {
      key: `${index}`,
      name: 'Unnamed check',
      label: 'No result reported',
      tone: 'neutral',
      url: null,
      detail: null,
    };
  }

  // `name` on a CheckRun, `context` on a StatusContext. Neither is guaranteed:
  // GraphQL nulls out a field it could not resolve and still returns 200.
  const name = readString(value['name']) ?? readString(value['context']) ?? 'Unnamed check';
  const { label, tone } = describe(value);

  const typename = readString(value['__typename']);
  const unrecognized = typename !== 'CheckRun' && typename !== 'StatusContext';

  return {
    key: `${index}:${name}`,
    name,
    label,
    tone,
    url: readUrl(value['detailsUrl']) ?? readUrl(value['targetUrl']),
    detail:
      readString(value['description']) ??
      appName(value) ??
      // Said rather than hidden: a row this build cannot fully read should
      // admit it instead of looking like a check with no detail.
      (unrecognized ? `Unrecognized check type${typename === null ? '' : ` (${typename})`}` : null),
  };
}

/**
 * The rollup, read.
 *
 * `null` in, `{ kind: 'none' }` out — a head commit with no CI configured is
 * not an error and not a pending check, and the Overview has to be able to say
 * so. `pierrecomputer/pierre#1` really does come back this way.
 */
export function checksSummary(rollup: CheckRollup | null): ChecksSummary {
  if (rollup === null) return { kind: 'none' };

  const contexts = rollup['contexts'];
  const nodes = isRecord(contexts) && Array.isArray(contexts['nodes']) ? contexts['nodes'] : [];
  const totalCount =
    isRecord(contexts) && typeof contexts['totalCount'] === 'number'
      ? contexts['totalCount']
      : nodes.length;

  return {
    kind: 'contexts',
    contexts: nodes.map(readContext),
    withheld: Math.max(0, totalCount - nodes.length),
  };
}
