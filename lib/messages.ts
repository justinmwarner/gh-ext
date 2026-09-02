/**
 * The typed protocol spoken between the background service worker and every
 * page that talks to it: the GitHub content script, the review page, and the
 * options page.
 *
 * This module is pure. It names no `chrome.*`/`browser.*` API — the transport
 * lives in `entrypoints/`, and both ends import their types from here so a
 * change to a request shape breaks the sender and the handler together.
 *
 * Everything below crosses `runtime.sendMessage`, which Chrome serializes as
 * JSON. So no `Date`, no `Map`, no `undefined` used as a meaningful value:
 * instants are epoch milliseconds and absence is `null`.
 */

import type { BlobResult } from './github/blobs';
import type { ParsedDiffFile } from './github/diff';
import type { DeniedField } from './github/graphql-errors';
import type { FallbackDiffFile } from './github/files-fallback';
import type { ReviewThread } from './github/types';

/** A pull request's coordinates. The unit of work for the whole protocol. */
export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * `repository.pullRequest` as PULL_REQUEST_QUERY returns it.
 *
 * Only the fields the plumbing itself reads are named. The query selects a good
 * deal more; the index signature says so honestly rather than pretending this
 * is the complete shape, and the review UI narrows what it needs.
 */
export interface PullRequestNode {
  id: string;
  number: number;
  title: string;
  /** The head commit SHA. Half of every cache key. */
  headRefOid: string;
  [extra: string]: unknown;
}

/**
 * `commits.nodes[0].commit.statusCheckRollup`. Null when the head commit has no
 * checks at all — which is different from checks that are still pending.
 */
export interface CheckRollup {
  state: string;
  [extra: string]: unknown;
}

/**
 * Where the file list came from. GitHub refuses to generate a unified diff for
 * very large pull requests, and the fallback carries strictly less information
 * (see `lib/github/files-fallback.ts`), so the consumer has to know which it
 * got rather than guess.
 */
export type DiffPayload =
  | { source: 'unified'; files: ParsedDiffFile[]; truncated: false }
  | { source: 'files-api'; files: FallbackDiffFile[]; truncated: boolean };

/**
 * Which of the payload's paginated lists stopped short.
 *
 * `files` and `reviewThreads` are followed to the end of their cursors, but not
 * past a hard page cap — a connection that keeps promising more must not be
 * able to spin the worker. When the cap engages the list really is incomplete,
 * and the reviewer has to be told: the difference between "this pull request
 * has no more comments" and "we dropped them" is not one they can infer.
 *
 * Both false on a normal pull request, which is the overwhelming majority.
 */
export interface PrTruncation {
  files: boolean;
  threads: boolean;
}

/** Everything the review page needs for a first paint. */
export interface PrPayload {
  ref: PrRef;
  /** The SHA every part of this payload was read at. */
  headSha: string;
  pullRequest: PullRequestNode;
  threads: ReviewThread[];
  checks: CheckRollup | null;
  diff: DiffPayload;
  /** Lists that hit the page cap. Never omitted, so a consumer cannot forget. */
  truncated: PrTruncation;
  /**
   * Fields GitHub refused to resolve. Empty on a normal read.
   *
   * A GraphQL response is not pass or fail: a token that grants the repository
   * but not, say, the Checks permission gets the whole pull request back with
   * the check runs nulled out and one error per denial. Everything downstream
   * copes with the null — but `checks: null` renders as "No checks", and a
   * reviewer told a pull request has no CI when the truth is that they may not
   * see it has been misinformed rather than merely underserved.
   *
   * So the refusal travels with the payload it damaged. Never omitted, for the
   * same reason `truncated` is not.
   */
  denied: DeniedField[];
}

/**
 * A narrowed diff: everything between two commits of one pull request.
 *
 * Always the unified arm. The compare endpoint either produces a diff or fails
 * — there is no files-endpoint fallback for it — so a caller that got one of
 * these has real patches for every file in it.
 */
export interface CompareDiff {
  base: string;
  head: string;
  files: ParsedDiffFile[];
}

export interface PrefetchAck {
  /**
   * False when a prefetch for this pull request was already running, so the
   * caller knows its request was folded into an existing one rather than
   * dropped.
   */
  started: boolean;
}

export interface OpenReviewAck {
  /** The tab that was navigated to the review page. */
  tabId: number;
}

export interface MutationResult {
  /** The GraphQL `data` object for the mutation that was run. */
  data: JsonValue;
}

export interface TokenValidation {
  login: string;
}

export interface RateLimitSnapshot {
  remaining: number;
  limit: number;
  /** Epoch milliseconds. */
  resetAt: number;
}

/**
 * Every exchange, as a request shape paired with its response shape.
 *
 * This map is the single source of truth. `MessageOf` and `ResultOf` read off
 * it, so a handler that returns the wrong payload for a kind does not compile.
 */
export interface ProtocolMap {
  /** Content script → worker: start warming the cache for this pull request. */
  'prefetch-pr': { request: { pr: PrRef }; response: PrefetchAck };

  /**
   * Content script → worker: navigate the sending tab to the review page.
   *
   * The worker does the navigating. A content script cannot navigate to an
   * extension page without `review.html` being web-accessible, which would let
   * github.com probe for the extension.
   */
  'open-review': { request: { pr: PrRef }; response: OpenReviewAck };

  /** Review page → worker: the assembled payload, from cache where possible. */
  'get-pr': {
    request: {
      pr: PrRef;
      /** Bypass the cache and re-read from GitHub. */
      refresh?: boolean;
    };
    response: PrPayload;
  };

  /**
   * Review page → worker: run a GraphQL mutation.
   *
   * `document` is one of the exported constants in `lib/github/mutations.ts` —
   * never a string built at the call site. Supplying `pr` lets the worker drop
   * the now-stale cached threads and checks for that pull request instead of
   * waiting out their TTL.
   */
  mutate: {
    request: {
      document: string;
      variables: Record<string, JsonValue>;
      pr?: PrRef;
    };
    response: MutationResult;
  };

  /**
   * Review page → worker: the diff between two commits of this pull request.
   *
   * "Changes since my last review", as `base...head`. The fetch belongs here
   * rather than on the page for the same reason every other one does: the
   * worker holds the token, and the review page never calls `fetch`.
   *
   * `base` is the head commit of the reviewer's previous review, read from
   * `viewerLatestReview.commit.oid`; `head` is the pull request's current head.
   * The body comes back in the same unified format the full diff does, so the
   * files are the same `ParsedDiffFile` shape and everything downstream — the
   * parser, the file list, thread anchoring — is unchanged.
   */
  'compare-diff': {
    request: { pr: PrRef; base: string; head: string };
    response: CompareDiff;
  };

  /**
   * Review page → worker: one file's whole contents at one commit.
   *
   * What makes "expand unchanged context" possible. A patch carries only the
   * lines it changed, so Pierre marks the parsed diff `isPartial` and draws no
   * expand affordance at all until it is handed both sides of the file in full;
   * `ref` is the base commit for one call and the head commit for the other.
   *
   * Here rather than on the page for the reason every other fetch is: the page
   * has no token and never calls `fetch`. The reply is a result rather than an
   * error for the three cases that are facts about the file — no such side, too
   * large, not text — because each needs its own sentence on screen.
   */
  'get-blob': {
    request: { pr: PrRef; path: string; ref: string };
    response: BlobResult;
  };

  /** Options page → worker: does the stored token work, and who is it? */
  'validate-token': { request: Record<string, never>; response: TokenValidation };

  /**
   * Options page → worker: the rate limit headers seen on the worker's most
   * recent GitHub request, or null if it has not made one since it started.
   */
  'get-rate-limit': {
    request: Record<string, never>;
    response: RateLimitSnapshot | null;
  };
}

export type MessageKind = keyof ProtocolMap;

/** The full wire shape of one request: its payload plus its discriminant. */
export type MessageOf<K extends MessageKind> = { kind: K } & ProtocolMap[K]['request'];

/** The payload a handler for `K` must produce. */
export type ResultOf<K extends MessageKind> = ProtocolMap[K]['response'];

/** The request union. What `runtime.onMessage` receives. */
export type Message = { [K in MessageKind]: MessageOf<K> }[MessageKind];

export type ProtocolErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'bad-request'
  | 'unknown';

/**
 * A failure, flattened for the wire. `Error` instances do not survive
 * `sendMessage`, so the worker classifies before it replies and the UI switches
 * on `kind` rather than matching on message text.
 */
export interface ProtocolError {
  kind: ProtocolErrorKind;
  message: string;
  /**
   * Epoch milliseconds when the GitHub quota refills. Only ever set for
   * `rate-limit`, and null even then when GitHub sent no usable reset header.
   */
  resetAt: number | null;
}

/**
 * A failure raised by the worker itself, already classified for the wire.
 *
 * The only class in this module. It lives here rather than in the worker
 * because `ProtocolErrorKind` does: the pure modules the worker delegates to
 * have to be able to say "not found" without importing an entrypoint, and
 * `toProtocolError` has to be able to recognise it.
 */
export class ProtocolFailure extends Error {
  constructor(
    readonly protocolKind: ProtocolErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: ProtocolError };

/** The reply to a `K` request. */
export type ResponseOf<K extends MessageKind> = Ok<ResultOf<K>> | Err;

/** The response union. */
export type Response = { [K in MessageKind]: ResponseOf<K> }[MessageKind];

/**
 * Every declared kind, as a lookup table.
 *
 * Typed as `Record<MessageKind, true>` on purpose: adding a kind to
 * `ProtocolMap` without adding it here is a compile error, so the runtime guard
 * can never silently fall behind the types.
 */
const MESSAGE_KINDS: Record<MessageKind, true> = {
  'prefetch-pr': true,
  'open-review': true,
  'get-pr': true,
  mutate: true,
  'compare-diff': true,
  'get-blob': true,
  'validate-token': true,
  'get-rate-limit': true,
};

/**
 * Build a request.
 *
 * The only supported way to produce one. Callers name a kind that has to exist
 * in `ProtocolMap`, and the payload is checked against that kind — so neither
 * end ever writes a bare message string.
 */
export function message<K extends MessageKind>(
  kind: K,
  payload: ProtocolMap[K]['request'],
): MessageOf<K> {
  return { kind, ...payload } as MessageOf<K>;
}

/**
 * Narrow a reply to a failure.
 *
 * Callers get back `unknown` from `sendMessage` — including `undefined` when
 * the worker was not listening at all — so both ends check rather than assume.
 */
export function isErr(value: unknown): value is Err {
  return typeof value === 'object' && value !== null && (value as Err).ok === false;
}

/**
 * Narrow an untrusted value to a request.
 *
 * The worker validates before dispatching. `runtime.onMessage` only carries
 * messages from this extension, but an older content script left over from a
 * previous version is still a plausible sender.
 */
export function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  // hasOwnProperty, not `in`: `{ kind: 'toString' }` would otherwise pass.
  return (
    typeof kind === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_KINDS, kind)
  );
}
