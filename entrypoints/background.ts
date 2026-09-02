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
import { PrCache, type PrCacheRef } from '@/lib/cache';
import {
  type AssemblyPorts,
  assemblePullRequest,
  payloadFromCache,
  prKey,
  readHeadSha,
} from '@/lib/github/assembly';
import { AuthError, GitHubClient, RateLimitError } from '@/lib/github/client';
import { reviewHash } from '@/lib/github/pr-url';
import { ChromeTokenProvider, chromeKeyValueStore } from '@/lib/github/token-provider';
import {
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
    const cacheWrite = (promise: Promise<void>): void => {
      void promise.catch((error: unknown) => {
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

    /** Assemble, folding concurrent callers for the same pull request together. */
    function assembleOnce(pr: PrRef): Promise<PrPayload> {
      const key = prKey(pr);
      const running = inflight.get(key);
      if (running) return running;

      const promise = assemblePullRequest(ports, pr).finally(() => {
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
        const headSha = await readHeadSha(cacheStore, pr);
        if (headSha !== null) {
          const ref: PrCacheRef = { ...pr, headSha };
          cacheWrite(cache.invalidate('threads', ref));
          cacheWrite(cache.invalidate('checks', ref));
          cacheWrite(cache.invalidate('pr', ref));
        }
      }

      return { data };
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
