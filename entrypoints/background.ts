/**
 * The background service worker.
 *
 * It owns the only `GitHubClient` in the extension, the pull request cache, the
 * prefetcher and the message router. Nothing else performs a network call: the
 * content script runs on github.com and the review page is an extension page,
 * and routing every request through here keeps the token out of both of them
 * and keeps rate limit accounting in one place.
 *
 * The data path itself — what to fetch, in what order, and what to cache — is
 * `lib/github/assembly.ts`, so it can be tested without a browser. This file is
 * the wiring: extension storage, the token, the message channel.
 *
 * Everything runs inside `main()`. WXT imports this file into Node during the
 * build to read its options, where the extension APIs are stubs that throw.
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  PrCache,
  type PrCacheRef,
  forgetCachedReads,
  writeGenerations,
} from '@/lib/cache';
import {
  type AssemblyPorts,
  assemblePullRequest,
  payloadFromCache,
  prKey,
  readHeadSha,
} from '@/lib/github/assembly';
import {
  type BinaryBlobResult,
  fetchBinaryBlob,
} from '@/lib/github/binary-blobs';
import { type BlobResult, BlobCache, fetchBlob } from '@/lib/github/blobs';
import { AuthError, GitHubClient, RateLimitError } from '@/lib/github/client';
import { parseUnifiedDiff } from '@/lib/github/diff';
import { reviewHash } from '@/lib/github/pr-url';
import {
  ChromeTokenProvider,
  chromeKeyValueStore,
  isTokenChange,
} from '@/lib/github/token-provider';
import {
  type CompareDiff,
  type Err,
  type JsonValue,
  type Message,
  type MessageKind,
  type MutationResult,
  type OpenReviewAck,
  type PrPayload,
  type PrRef,
  type PrefetchAck,
  type ProtocolError,
  ProtocolFailure,
  type RateLimitSnapshot,
  type Response,
  type ResponseOf,
  type ResultOf,
  type TokenValidation,
  isMessage,
} from '@/lib/messages';

/** The token check the options page's validate button runs. */
const VIEWER_QUERY = 'query { viewer { login } }';

export default defineBackground({
  type: 'module',
  main() {
    const tokens = new ChromeTokenProvider();
    const client = new GitHubClient(tokens);

    // `session` rather than `local`: the cache is disposable, is cleared when
    // the browser closes, and is never written to disk.
    const cacheStore = chromeKeyValueStore('session');
    const cache = new PrCache(cacheStore);

    /**
     * In-flight assemblies, so a prefetch and the `get-pr` that follows it
     * share one round trip. Deduplication only — nothing durable lives here,
     * because this map dies with the worker.
     */
    const inflight = new Map<string, Promise<PrPayload>>();

    /**
     * An authorized `fetch` for `fetchFilesFallback`, which by contract does no
     * auth of its own. `GitHubClient` does not expose its transport, so the
     * header is attached here.
     */
    const authorizedFetch: typeof fetch = async (input, init) => {
      const token = await tokens.getToken();
      if (!token) throw new AuthError('No GitHub token configured');
      // Built through Headers so a caller passing Headers or an entry array is
      // not silently dropped by an object spread.
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    };

    /** Cache writes are best effort — a full storage area must not fail a read. */
    const cacheWrite = (write: () => Promise<void>): void => {
      void write().catch((error: unknown) => {
        console.warn('[fast-review] cache write failed', error);
      });
    };

    const ports: AssemblyPorts = {
      github: client,
      cache,
      store: cacheStore,
      fetchImpl: authorizedFetch,
      cacheWrite,
    };

    /**
     * How many times each pull request has been mutated from this worker.
     *
     * A read takes several round trips, and a mutation can land in the middle
     * of one. The mutation invalidates the affected slots; the read then
     * finishes and writes what it fetched *before* the mutation straight back,
     * with a fresh TTL. The reviewer reloads inside that window and the thread
     * they watched resolve is unresolved again, with nothing to explain it.
     *
     * So each assembly notes the count it started at and declines its cache
     * writes if the count has moved. The payload it returns is still served —
     * only slightly stale, and the page has already applied the mutation
     * optimistically — but it is not allowed to become the cached answer.
     */
    const generations = writeGenerations();

    /** Assemble, folding concurrent callers for the same pull request together. */
    function assembleOnce(pr: PrRef): Promise<PrPayload> {
      const key = prKey(pr);
      const running = inflight.get(key);
      if (running) return running;

      const fresh = generations.fresh(key);
      const scoped: AssemblyPorts = {
        ...ports,
        cacheWrite: (write) => {
          if (!fresh()) return;
          cacheWrite(write);
        },
      };

      const promise = assemblePullRequest(scoped, pr).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, promise);
      return promise;
    }

    function prefetch(pr: PrRef): PrefetchAck {
      if (inflight.has(prKey(pr))) return { started: false };

      // Deliberately not awaited: the content script is only asking the worker
      // to start warming, and a failure here must not surface on the PR page.
      void assembleOnce(pr).catch((error: unknown) => {
        console.warn('[fast-review] prefetch failed', prKey(pr), error);
      });
      return { started: true };
    }

    async function getPr(pr: PrRef, refresh: boolean): Promise<PrPayload> {
      if (!refresh) {
        const running = inflight.get(prKey(pr));
        if (running) return running;

        const cached = await payloadFromCache(ports, pr);
        if (cached) return cached;
      }
      return assembleOnce(pr);
    }

    async function openReview(pr: PrRef, tabId: number | undefined): Promise<OpenReviewAck> {
      if (tabId === undefined) {
        throw new ProtocolFailure('bad-request', 'open-review must be sent from a tab');
      }

      // The navigation happens here, not in the content script. A page on
      // github.com cannot navigate to an extension resource unless that
      // resource is listed in web_accessible_resources, which would also let
      // github.com probe for it and fingerprint the extension.
      const url = browser.runtime.getURL(`/review.html${reviewHash(pr)}`);
      await browser.tabs.update(tabId, { url });
      return { tabId };
    }

    async function mutate(
      document: string,
      variables: Record<string, JsonValue>,
      pr: PrRef | undefined,
    ): Promise<MutationResult> {
      const data = await client.graphql<JsonValue>(document, variables);

      // The reviewer's own action just invalidated the cached copy. Waiting out
      // the TTL would show them a stale version of what they just changed.
      if (pr) {
        // Bumped before the removals, so an assembly that is already running
        // knows its data predates this mutation and declines to write it back.
        generations.bump(prKey(pr));
        const headSha = await readHeadSha(cacheStore, pr);
        if (headSha !== null) {
          const ref: PrCacheRef = { ...pr, headSha };
          cacheWrite(() => cache.invalidate('threads', ref));
          cacheWrite(() => cache.invalidate('checks', ref));
          cacheWrite(() => cache.invalidate('pr', ref));
        }
      }

      return { data };
    }

    /**
     * The diff between two commits, for "changes since my last review".
     *
     * Here rather than on the review page because every network call is here:
     * the page has no token and cannot get one. The body is parsed with the
     * same `parseUnifiedDiff` the full diff goes through, so the file shape the
     * page receives is identical either way.
     *
     * Deliberately uncached. A compare is keyed on a pair of commits rather
     * than on the head alone, the reviewer asks for it by pressing a toggle
     * rather than on load, and the page holds the answer for as long as it is
     * showing it.
     */
    async function compareDiff(
      pr: PrRef,
      base: string,
      head: string,
    ): Promise<CompareDiff> {
      if (base === '' || head === '') {
        throw new ProtocolFailure(
          'bad-request',
          'A comparison needs two commits, and one of them was missing.',
        );
      }
      const raw = await client.fetchCompare(pr.owner, pr.repo, base, head);
      return { base, head, files: parseUnifiedDiff(raw) };
    }

    /**
     * Blobs already read, in memory for as long as this worker lives.
     *
     * In memory rather than in `storage.session` on purpose: a file's whole
     * contents are far larger than anything else this extension caches, two of
     * them are read per expanded file, and losing them on a worker restart
     * costs one request the reviewer already waited for once.
     *
     * A blob at a commit cannot change, so there is no TTL and no invalidation
     * — only the budget in `BlobCache`.
     */
    const blobs = new BlobCache();

    /**
     * The same, for the files that are read as bytes rather than as text.
     *
     * A separate cache rather than a wider one, because a path at a commit has
     * two answers here — its text and its bytes — and one map keyed on the pair
     * would hand an image comparison the string form of a PNG.
     *
     * Fewer entries and a larger budget than the text cache above: an image is
     * a hundred times the size of a source file and a reviewer looks at far
     * fewer of them in a sitting. The stored form is base64, so the budget is
     * counted in the inflated size rather than the file's own.
     */
    const imageBytes = new BlobCache<BinaryBlobResult>(24, 32_000_000);

    /**
     * Forget every cached read when the token changes.
     *
     * Nothing in a cache key names an account — deliberately, because a
     * credential's identity has no business in a storage key — so without this
     * the cache outlives the token that filled it. Clearing the token on the
     * options page would leave a whole pull request readable for the rest of
     * the TTL, and replacing it with another account's token would show that
     * account the first one's viewed states, pending review and author flag,
     * then fail every mutation against ids it cannot use.
     *
     * Registered at the top level of `main` so it survives the worker being
     * killed and restarted, like every other listener here.
     */
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (!isTokenChange(changes, areaName)) return;
      inflight.clear();
      blobs.clear();
      imageBytes.clear();
      void forgetCachedReads(cacheStore).catch((error: unknown) => {
        console.warn('[fast-review] could not clear the cache', error);
      });
    });

    /**
     * One side of one file, for `loadDiffFiles` on the review page.
     *
     * `absent`, `too-large` and `binary` come back as values rather than as
     * errors because each is a fact about the file that the reviewer has to be
     * told in its own words. They are cached alongside the successes: a file
     * that had no base side a moment ago still has none.
     */
    async function getBlob(pr: PrRef, path: string, ref: string): Promise<BlobResult> {
      if (path === '' || ref === '') {
        throw new ProtocolFailure(
          'bad-request',
          'A blob needs both a path and a commit, and one of them was missing.',
        );
      }

      const cached = blobs.get(ref, path);
      if (cached !== undefined) return cached;

      const result = await fetchBlob(authorizedFetch, {
        owner: pr.owner,
        repo: pr.repo,
        path,
        ref,
      });
      blobs.set(ref, path, result);
      return result;
    }

    /**
     * One side of one file as bytes, for the image and SVG comparisons.
     *
     * Deliberately a near-copy of `getBlob` above rather than a shared
     * generic: the two differ in the media type they ask for, in what they do
     * with the body, in which cache they consult and in the caps they enforce,
     * which leaves nothing to share but the four-line guard.
     */
    async function getBlobBytes(
      pr: PrRef,
      path: string,
      ref: string,
    ): Promise<BinaryBlobResult> {
      if (path === '' || ref === '') {
        throw new ProtocolFailure(
          'bad-request',
          'A blob needs both a path and a commit, and one of them was missing.',
        );
      }

      const cached = imageBytes.get(ref, path);
      if (cached !== undefined) return cached;

      const result = await fetchBinaryBlob(authorizedFetch, {
        owner: pr.owner,
        repo: pr.repo,
        path,
        ref,
      });
      imageBytes.set(ref, path, result);
      return result;
    }

    async function validateToken(): Promise<TokenValidation> {
      const data = await client.graphql<{ viewer: { login: string } }>(VIEWER_QUERY, {});
      return { login: data.viewer.login };
    }

    /**
     * The rate limit seen on the worker's most recent GitHub request.
     *
     * Null after a worker restart, because `GitHubClient` holds it in memory.
     * That is reported honestly rather than papered over with a stale number.
     */
    function rateLimit(): RateLimitSnapshot | null {
      const status = client.getRateLimit();
      if (!status) return null;
      return {
        remaining: status.remaining,
        limit: status.limit,
        resetAt: status.resetAt.getTime(),
      };
    }

    const ok = <K extends MessageKind>(data: ResultOf<K>): ResponseOf<K> => ({
      ok: true,
      data,
    });

    async function route(message: Message, tabId: number | undefined): Promise<Response> {
      try {
        switch (message.kind) {
          case 'prefetch-pr':
            return ok<'prefetch-pr'>(prefetch(message.pr));
          case 'open-review':
            return ok<'open-review'>(await openReview(message.pr, tabId));
          case 'get-pr':
            return ok<'get-pr'>(await getPr(message.pr, message.refresh === true));
          case 'mutate':
            return ok<'mutate'>(
              await mutate(message.document, message.variables, message.pr),
            );
          case 'compare-diff':
            return ok<'compare-diff'>(
              await compareDiff(message.pr, message.base, message.head),
            );
          case 'get-blob':
            return ok<'get-blob'>(
              await getBlob(message.pr, message.path, message.ref),
            );
          case 'get-blob-bytes':
            return ok<'get-blob-bytes'>(
              await getBlobBytes(message.pr, message.path, message.ref),
            );
          case 'validate-token':
            return ok<'validate-token'>(await validateToken());
          case 'get-rate-limit':
            return ok<'get-rate-limit'>(rateLimit());
        }
      } catch (error) {
        return { ok: false, error: toProtocolError(error) };
      }
    }

    browser.runtime.onMessage.addListener(
      (raw: unknown, sender, sendResponse: (response: Response) => void) => {
        if (!isMessage(raw)) {
          const rejection: Err = {
            ok: false,
            error: {
              kind: 'bad-request',
              message: 'Unrecognized message',
              resetAt: null,
            },
          };
          sendResponse(rejection);
          return false;
        }

        // `route` resolves rather than rejects, so this never drops a caller.
        void route(raw, sender.tab?.id).then(sendResponse);
        // Keeps the channel open for the async sendResponse above. Required.
        return true;
      },
    );
  },
});

function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof RateLimitError) {
    return {
      kind: 'rate-limit',
      message: error.message,
      resetAt: error.resetAt?.getTime() ?? null,
    };
  }
  if (error instanceof AuthError) {
    return { kind: 'auth', message: error.message, resetAt: null };
  }
  if (error instanceof ProtocolFailure) {
    return { kind: error.protocolKind, message: error.message, resetAt: null };
  }
  return {
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    resetAt: null,
  };
}
