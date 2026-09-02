/**
 * Assembling a `PrPayload` from GitHub.
 *
 * This is the background worker's data path, lifted out of the worker so it can
 * be tested without a browser. It stays inside the `lib/` contract: no DOM, no
 * `chrome.*`, and no transport of its own — every network call goes through an
 * injected port, exactly as `lib/github/files-fallback.ts` takes its `fetch`.
 *
 * The worker owns the ports (an authorized `GitHubClient`, a cache over
 * extension storage) and nothing else; the ordering rules live here.
 */

import { PrCache, type PrCacheRef } from '../cache';
import {
  type CheckRollup,
  type DiffPayload,
  type PrPayload,
  type PrRef,
  type PrTruncation,
  type PullRequestNode,
  ProtocolFailure,
} from '../messages';
import type { KeyValueStore } from '../review/drafts';
import { AuthError, RateLimitError } from './client';
import { type DeniedField, mergeDenied } from './graphql-errors';
import { parseUnifiedDiff } from './diff';
import { fetchFilesFallback } from './files-fallback';
import { type Connection, type Paged, collectConnection } from './pagination';
import {
  FILES_PAGE_QUERY,
  PULL_REQUEST_QUERY,
  REVIEW_THREADS_PAGE_QUERY,
} from './queries';
import type { PullRequestFile, ReviewThread } from './types';

/**
 * The GitHub calls the assembler makes.
 *
 * A structural subset of `GitHubClient`, so the worker passes its client
 * straight through and a test passes a client built over a fake `fetch`.
 */
export interface GitHubPort {
  /**
   * `onPartial` is how the assembler tells the client it can cope with a
   * response GitHub only partly resolved. Without it a single denied field —
   * a token that grants the repository but not the Checks permission is the
   * common case — throws away a complete pull request.
   */
  graphql<T>(
    document: string,
    variables: Record<string, unknown>,
    onPartial?: (denied: DeniedField[]) => void,
  ): Promise<T>;
  fetchDiff(owner: string, repo: string, number: number): Promise<string>;
}

export interface AssemblyPorts {
  github: GitHubPort;
  cache: PrCache;
  /** Where the head-SHA pointer lives. The same area the cache uses. */
  store: KeyValueStore;
  /**
   * An already-authorized `fetch`, for the REST files fallback. That module
   * does no auth of its own by contract.
   */
  fetchImpl: typeof fetch;
  /** Best-effort cache write. Never awaited: a full store must not fail a read. */
  cacheWrite: (promise: Promise<void>) => void;
  /** Overridden only by tests that need the cap to engage quickly. */
  maxPages?: number;
}

/**
 * The shape of PULL_REQUEST_QUERY's response, as far as the assembler reads it.
 *
 * The query selects a great deal more. Only the fields the assembler itself has
 * to understand — the head SHA it keys the cache on, and the sub-trees it
 * caches or paginates — are named; the rest rides along under the index
 * signature in `PullRequestNode` for the review UI to narrow.
 *
 * Every level is optional because GraphQL nulls out a field it could not
 * resolve while still returning HTTP 200.
 */
export interface RawPullRequest {
  id: string;
  number: number;
  title: string;
  headRefOid: string;
  files?: Connection<PullRequestFile> | null;
  reviewThreads?: Connection<ReviewThread> | null;
  commits?: {
    nodes?: ({ commit?: { statusCheckRollup?: CheckRollup | null } | null } | null)[] | null;
  } | null;
  [extra: string]: unknown;
}

export interface PullRequestQueryData {
  repository?: { pullRequest?: RawPullRequest | null } | null;
}

/** What a follow-up page document returns, whichever connection it walked. */
interface PageQueryData<T> {
  repository?: {
    pullRequest?: {
      files?: Connection<T> | null;
      reviewThreads?: Connection<T> | null;
    } | null;
  } | null;
}

export const prKey = (pr: PrRef): string => `${pr.owner}/${pr.repo}/${pr.number}`;

/**
 * Remembers the head SHA last seen for a pull request.
 *
 * Cache keys include the head SHA, but a caller asking for a pull request does
 * not know it yet — that is what the query returns. This pointer closes the
 * loop so a `get-pr` after a prefetch can be served from storage instead of
 * re-querying, including after the worker has been shut down and restarted.
 */
export const headPointerKey = (pr: PrRef): string => `head:${prKey(pr)}`;

export function readHeadSha(store: KeyValueStore, pr: PrRef): Promise<string | null> {
  return store.get(headPointerKey(pr));
}

/** Serve a payload entirely from cache, or null if any part is missing. */
export async function payloadFromCache(
  ports: Pick<AssemblyPorts, 'cache' | 'store'>,
  pr: PrRef,
): Promise<PrPayload | null> {
  const headSha = await readHeadSha(ports.store, pr);
  if (headSha === null) return null;

  const ref: PrCacheRef = { ...pr, headSha };
  const [node, diff, threads, checks, truncated, denied] = await Promise.all([
    ports.cache.get<PrPayload['pullRequest']>('pr', ref),
    ports.cache.get<PrPayload['diff']>('diff', ref),
    ports.cache.get<ReviewThread[]>('threads', ref),
    ports.cache.get<CheckRollup | null>('checks', ref),
    ports.cache.get<PrTruncation>('truncated', ref),
    ports.cache.get<DeniedField[]>('denied', ref),
  ]);

  // All of it or none. A partial payload would render a review page with
  // silently missing threads — or, without the flags, one that cannot say so.
  // `denied` is in the list for that second reason: a cached payload that had
  // forgotten a refusal would quietly go back to claiming there are no checks.
  if (
    !node.hit ||
    !diff.hit ||
    !threads.hit ||
    !checks.hit ||
    !truncated.hit ||
    !denied.hit
  ) {
    return null;
  }

  return {
    ref: pr,
    headSha,
    pullRequest: node.value,
    threads: threads.value,
    checks: checks.value,
    diff: diff.value,
    truncated: truncated.value,
    denied: denied.value,
  };
}

/**
 * A diff, and the head commit the copy was cached under.
 *
 * `cachedAt` is null for a freshly fetched diff. When it is set, the assembler
 * has to check it against the SHA the query just reported: the probe runs
 * before the query answers, so it can only key on the last SHA this worker
 * saw, and a new commit makes that the wrong diff.
 */
interface DiffLoad {
  diff: DiffPayload;
  cachedAt: string | null;
}

/**
 * Read the diff, preferring a cached copy.
 *
 * Takes only the pull request's coordinates, which is the whole point: the REST
 * diff endpoint needs nothing the caller does not already have, so this can run
 * against the head-SHA pointer left by a previous visit while the GraphQL query
 * is still in flight.
 */
async function loadDiff(ports: AssemblyPorts, pr: PrRef): Promise<DiffLoad> {
  const pointer = await readHeadSha(ports.store, pr);
  if (pointer !== null) {
    const cached = await ports.cache.get<DiffPayload>('diff', { ...pr, headSha: pointer });
    if (cached.hit) return { diff: cached.value, cachedAt: pointer };
  }
  return { diff: await fetchDiffPayload(ports, pr), cachedAt: null };
}

async function fetchDiffPayload(ports: AssemblyPorts, pr: PrRef): Promise<DiffPayload> {
  try {
    const raw = await ports.github.fetchDiff(pr.owner, pr.repo, pr.number);
    return { source: 'unified', files: parseUnifiedDiff(raw), truncated: false };
  } catch (error) {
    // Auth and quota failures are about the request, not the diff, and
    // retrying them against a different endpoint only burns another call.
    if (error instanceof AuthError || error instanceof RateLimitError) throw error;

    // GitHub refuses to generate a unified diff past a size threshold. The
    // files endpoint still answers, with less per file.
    const fallback = await fetchFilesFallback(
      pr.owner,
      pr.repo,
      pr.number,
      ports.fetchImpl,
    );
    return {
      source: 'files-api',
      files: fallback.files,
      truncated: fallback.truncated,
    };
  }
}

/**
 * Somewhere to put what GitHub refused, across every round trip of one read.
 *
 * Handed to each `graphql` call. Its presence is also what tells the client the
 * caller can survive a partly-resolved response at all — without it, one denied
 * field throws away the whole pull request.
 */
function deniedCollector() {
  const groups: DeniedField[][] = [];
  return {
    collect: (denied: DeniedField[]) => {
      groups.push(denied);
    },
    result: () => mergeDenied(groups),
  };
}

type Collect = (denied: DeniedField[]) => void;

function collectFiles(
  ports: AssemblyPorts,
  pr: PrRef,
  first: Connection<PullRequestFile> | null | undefined,
  onPartial: Collect,
): Promise<Paged<PullRequestFile>> {
  return collectConnection(
    first,
    async (after) => {
      const data = await ports.github.graphql<PageQueryData<PullRequestFile>>(
        FILES_PAGE_QUERY,
        { owner: pr.owner, repo: pr.repo, number: pr.number, after },
        onPartial,
      );
      return data?.repository?.pullRequest?.files;
    },
    ports.maxPages,
  );
}

function collectThreads(
  ports: AssemblyPorts,
  pr: PrRef,
  first: Connection<ReviewThread> | null | undefined,
  onPartial: Collect,
): Promise<Paged<ReviewThread>> {
  return collectConnection(
    first,
    async (after) => {
      const data = await ports.github.graphql<PageQueryData<ReviewThread>>(
        REVIEW_THREADS_PAGE_QUERY,
        { owner: pr.owner, repo: pr.repo, number: pr.number, after },
        onPartial,
      );
      return data?.repository?.pullRequest?.reviewThreads;
    },
    ports.maxPages,
  );
}

/**
 * Replace a connection's first page with the merged list.
 *
 * `pageInfo` is rewritten rather than left alone: after the walk, `hasNextPage`
 * means "the cap stopped us", not "there was a second page", and leaving the
 * original cursor in place would invite a consumer to resume a walk that is
 * already finished.
 */
function merged<T>(original: Connection<T> | null | undefined, paged: Paged<T>) {
  return {
    ...(original ?? {}),
    nodes: paged.nodes,
    pageInfo: { hasNextPage: paged.truncated, endCursor: null },
  };
}

/**
 * A promise's outcome as a value.
 *
 * The handlers are attached the moment the work starts, so a rejection is never
 * unobserved even while the assembler is deliberately looking at something else
 * first. `Promise.all` cannot be used for that: it reports whichever failure
 * lands first, and the order these are reported in is the point.
 */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

const unwrap = <T>(settled: Settled<T>): T => {
  if (!settled.ok) throw settled.error;
  return settled.value;
};

export async function assemblePullRequest(
  ports: AssemblyPorts,
  pr: PrRef,
): Promise<PrPayload> {
  // Two independent round trips, started together. The diff endpoint needs
  // only the coordinates the caller already has — `headRefOid` is a cache key,
  // not a request parameter — so running them in series spent the whole cold
  // start budget on two network latencies before anything could render.
  // Offering to handle denials is what makes a partly-resolved response
  // survivable: a token that grants the repository but not the Checks
  // permission gets the whole pull request back with the check runs nulled and
  // one error per denial, and refusing that response threw all of it away.
  const denials = deniedCollector();

  const queryPromise = ports.github.graphql<PullRequestQueryData>(
    PULL_REQUEST_QUERY,
    { owner: pr.owner, repo: pr.repo, number: pr.number },
    denials.collect,
  );
  // Settled, not awaited. A diff failure must not be reported ahead of a
  // missing pull request — "no such PR" is the useful answer and a diff error
  // would bury it — and must not sit unhandled while the query is inspected.
  const diffPromise = settle(loadDiff(ports, pr));

  const data = await queryPromise;

  const node = data.repository?.pullRequest;
  if (!node) {
    throw new ProtocolFailure(
      'not-found',
      `No pull request ${prKey(pr)} — check the repository name and the token's access.`,
    );
  }

  const ref: PrCacheRef = { ...pr, headSha: node.headRefOid };

  // Follow-up pages could only be asked for once the first page arrived, but
  // they need not wait on the diff that is still in flight beside them.
  const pagesPromise = settle(
    Promise.all([
      collectFiles(ports, pr, node.files, denials.collect),
      collectThreads(ports, pr, node.reviewThreads, denials.collect),
    ]),
  );

  const diffLoad = unwrap(await diffPromise);

  let diff = diffLoad.diff;
  if (diffLoad.cachedAt !== null && diffLoad.cachedAt !== ref.headSha) {
    // The probe could only key on the previous head commit, and the query just
    // superseded it. A diff of the wrong commit is worse than a slow one.
    diff = await fetchDiffPayload(ports, pr);
  }

  const [files, threads] = unwrap(await pagesPromise);

  const truncated: PrTruncation = {
    files: files.truncated,
    threads: threads.truncated,
  };

  const fullNode: PullRequestNode = {
    ...node,
    files: merged(node.files, files),
    reviewThreads: merged(node.reviewThreads, threads),
  };
  const checks = node.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;

  // Read after every round trip has reported, so a denial raised only while
  // walking the second page of threads is in it too.
  const denied = denials.result();

  // Nothing is written until every part of the payload is in hand, so a
  // failure halfway through leaves the cache as it was rather than half filled
  // with a pull request whose diff or thread tail never arrived.
  if (diffLoad.cachedAt !== ref.headSha) {
    ports.cacheWrite(ports.cache.set('diff', ref, diff));
  }
  ports.cacheWrite(ports.store.set(headPointerKey(pr), ref.headSha));
  ports.cacheWrite(ports.cache.set('pr', ref, fullNode));
  ports.cacheWrite(ports.cache.set('threads', ref, threads.nodes));
  ports.cacheWrite(ports.cache.set('checks', ref, checks));
  ports.cacheWrite(ports.cache.set('truncated', ref, truncated));
  ports.cacheWrite(ports.cache.set('denied', ref, denied));

  return {
    ref: pr,
    headSha: ref.headSha,
    pullRequest: fullNode,
    threads: threads.nodes,
    checks,
    diff,
    truncated,
    denied,
  };
}
