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
import { logWarn } from '@/lib/log';
import { followLoggingSetting } from '@/lib/settings-store';
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
import {
  AuthError,
  GitHubClient,
  MissingTokenError,
  RateLimitError,
} from '@/lib/github/client';
import { NO_PROBE, type Probe, diagnose, statedDiagnosis } from '@/lib/github/diagnosis';
import { evidenceOf, worthProbing } from '@/lib/github/evidence';
import { parseUnifiedDiff } from '@/lib/github/diff';
import { reviewHash } from '@/lib/github/pr-url';
import { type OpenReason, openTarget } from '@/lib/review/openTarget';
import { readSettings } from '@/lib/settings-store';
import {
  ChromeTokenProvider,
  chromeKeyValueStore,
  invalidatesCachedReads,
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

/**
 * The part of `sender.tab` this worker uses.
 *
 * Structural rather than the browser's own `Tab`, because these two fields are
 * the whole of what is read and both arrive without the `tabs` permission. A
 * nominal type here would be a claim to more of the tab than is being touched.
 */
interface SenderTab {
  id?: number;
  index?: number;
}

/** The token check the options page's validate button runs. */
const VIEWER_QUERY = 'query { viewer { login } }';

/**
 * The two questions asked after a failure that might be about access.
 *
 * Deliberately the smallest query that separates the causes: `viewer` proves
 * the token is accepted and names whose it is, and `repository` resolving or
 * not says whether this repository is inside its grant. Nothing else is
 * selected — the point is one cheap round trip on a path that is already
 * failing, not a second attempt at the read.
 */
const DIAGNOSE_QUERY = `query Diagnose($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) { id }
}`;

export default defineBackground({
  type: 'module',
  main() {
    // Before anything that might warn. Registered at the top of `main` so it
    // survives the worker being killed and restarted, like every other
    // listener here.
    void followLoggingSetting();

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
      if (!token) throw new MissingTokenError();
      // Built through Headers so a caller passing Headers or an entry array is
      // not silently dropped by an object spread.
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    };

    /** Cache writes are best effort — a full storage area must not fail a read. */
    const cacheWrite = (write: () => Promise<void>): void => {
      void write().catch((error: unknown) => {
        logWarn('cache write failed', error);
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
        logWarn('prefetch failed', prKey(pr), error);
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

    /**
     * `storage.session` key holding the review tabs this worker opened.
     *
     * A registry rather than a lookup, because finding a review tab by URL
     * means `tabs.query({ url })`, and that is the one tabs call needing the
     * `tabs` permission this extension deliberately does not request. Creating,
     * navigating, getting and watching tabs all work without it.
     *
     * `session` rather than `local`: a tab id means nothing after a browser
     * restart, and the pull request cache lives there for the same reason.
     */
    const REVIEW_TABS_KEY = 'review-tabs';

    async function reviewTabs(): Promise<Record<string, number>> {
      const stored = await browser.storage.session.get(REVIEW_TABS_KEY);
      const raw = stored[REVIEW_TABS_KEY];
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

      // Rebuilt field by field rather than cast: this survives a browser
      // restart badly enough already without also trusting its shape.
      const tabs: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'number') tabs[key] = value;
      }
      return tabs;
    }

    async function rememberReviewTab(key: string, tabId: number): Promise<void> {
      const tabs = await reviewTabs();
      tabs[key] = tabId;
      await browser.storage.session.set({ [REVIEW_TABS_KEY]: tabs });
    }

    /** By tab rather than by pull request — `onRemoved` only knows the tab. */
    async function forgetReviewTab(tabId: number): Promise<void> {
      const tabs = await reviewTabs();
      let changed = false;
      for (const [key, value] of Object.entries(tabs)) {
        if (value === tabId) {
          delete tabs[key];
          changed = true;
        }
      }
      if (changed) await browser.storage.session.set({ [REVIEW_TABS_KEY]: tabs });
    }

    /**
     * The review tab open for this pull request, or null.
     *
     * `tabs.get` rejects for a tab that no longer exists, which is the only way
     * to notice one closed while this worker was asleep and `onRemoved` had
     * nobody to tell.
     */
    async function existingReviewTab(key: string): Promise<number | null> {
      const tabs = await reviewTabs();
      const tabId = tabs[key];
      if (tabId === undefined) return null;

      try {
        await browser.tabs.get(tabId);
        return tabId;
      } catch {
        await forgetReviewTab(tabId);
        return null;
      }
    }

    /**
     * Show a pull request on the review page.
     *
     * The navigation happens here, not in the content script. A page on
     * github.com cannot navigate to an extension resource unless that resource
     * is listed in web_accessible_resources, which would also let github.com
     * probe for it and fingerprint the extension.
     *
     * *Where* it opens is also decided here, and for a different reason: it is
     * a stored preference, and resolving it in the content script would put the
     * reviewer's settings on github.com. The choice itself is
     * `lib/review/openTarget.ts`; this function only carries it out.
     */
    async function openReview(
      pr: PrRef,
      reason: OpenReason,
      sender: SenderTab | undefined,
    ): Promise<OpenReviewAck> {
      if (sender?.id === undefined || sender.index === undefined) {
        throw new ProtocolFailure('bad-request', 'open-review must be sent from a tab');
      }

      const url = browser.runtime.getURL(`/review.html${reviewHash(pr)}`);
      const key = prKey(pr);
      const [settings, existingTabId] = await Promise.all([
        readSettings(),
        existingReviewTab(key),
      ]);

      const action = openTarget({
        settings,
        reason,
        url,
        existingTabId,
        sender: { tabId: sender.id, index: sender.index },
      });

      switch (action.kind) {
        case 'none':
          return { tabId: action.tabId, reused: true };

        case 'focus': {
          const tab = await browser.tabs.get(action.tabId);
          await browser.tabs.update(action.tabId, { active: true });
          // Activating a tab inside a window that is not frontmost does not
          // put it in front of anybody. `windowId` arrives on the `tabs.get`
          // above and needs no permission of its own.
          if (tab.windowId !== undefined) {
            await browser.windows.update(tab.windowId, { focused: true });
          }
          return { tabId: action.tabId, reused: true };
        }

        case 'create-tab': {
          const tab = await browser.tabs.create({
            url: action.url,
            active: action.active,
            openerTabId: action.openerTabId,
            index: action.index,
          });
          const tabId = tab.id ?? null;
          if (tabId !== null) await rememberReviewTab(key, tabId);
          return { tabId, reused: false };
        }

        case 'create-window': {
          const created = await browser.windows.create({
            url: action.url,
            focused: action.focused,
          });
          const tabId = created?.tabs?.[0]?.id ?? null;
          if (tabId !== null) await rememberReviewTab(key, tabId);
          return { tabId, reused: false };
        }

        case 'update-tab': {
          await browser.tabs.update(action.tabId, { url: action.url });
          // Deliberately not remembered. The registry means "tabs this worker
          // opened to show a review"; this one is the reviewer's own tab, on
          // loan. Recording it would let a later click — after the destination
          // setting changed — reveal a tab that has long since navigated back
          // to github.com, in the belief that it is a review.
          return { tabId: action.tabId, reused: false };
        }
      }
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
     * The diff between two commits of this pull request.
     *
     * Every narrowing the page offers arrives here — a single commit, a range
     * of them, and "changes since my last review" alike — because all three
     * are the same request. Here rather than on the review page because every
     * network call is here: the page has no token and cannot get one. The body
     * is parsed with the same `parseUnifiedDiff` the full diff goes through,
     * so the file shape the page receives is identical either way.
     *
     * Only three-dot is ever sent, and not as a preference: `/compare/{a}..{b}`
     * answers 404. See `lib/review/diffScope.ts`.
     *
     * Still uncached, and the reason is now weaker than it was. It used to be
     * that the reviewer asked for one comparison by pressing a toggle; with a
     * commit picker they may walk a history and come back, and each visit is a
     * fresh request. A compare between two commits is immutable, so it *could*
     * be cached forever — but not in `PrCache` as it stands, whose keys end in
     * a single head SHA and whose sweep would treat every compare entry as
     * belonging to a superseded commit and delete it. Left alone rather than
     * bolted on: one request per selection is well inside the hour's quota,
     * and the page holds the answer for as long as it is showing it.
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
      if (!invalidatesCachedReads(changes, areaName)) return;
      inflight.clear();
      blobs.clear();
      imageBytes.clear();
      void forgetCachedReads(cacheStore).catch((error: unknown) => {
        logWarn('could not clear the cache', error);
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
     * One extra question to GitHub, asked only once something has already
     * failed.
     *
     * This is what turns "either the repository does not exist or your token
     * cannot see it" into a statement. The two facts it establishes — whether
     * the token is accepted at all, and whether this repository resolves for
     * it — between them rule out every access-shaped cause but one.
     *
     * Costs a round trip, so it is spent only on failures that could plausibly
     * be about access (see `worthProbing`), and never on a rate limit, where
     * the extra request is both useless and the last thing the quota needs.
     *
     * Resolves rather than rejects, always. A probe that fails has learned
     * nothing, which is `NO_PROBE`; it must never replace the original failure
     * with its own, because the reviewer's problem is the first one.
     */
    async function probeAccess(pr: PrRef | null): Promise<Probe> {
      try {
        if (pr === null) {
          const data = await client.graphql<{ viewer: { login: string } | null }>(
            VIEWER_QUERY,
            {},
          );
          return { ...NO_PROBE, login: data?.viewer?.login ?? null };
        }

        // `onPartial` is the whole point: a repository this token cannot see
        // comes back as null *beside* a populated `viewer`, with one NOT_FOUND
        // in `errors`. Without tolerating that, the probe would throw on
        // exactly the case it exists to identify.
        const data = await client.graphql<{
          viewer: { login: string } | null;
          repository: { id: string } | null;
        }>(DIAGNOSE_QUERY, { owner: pr.owner, name: pr.repo }, () => {});

        const login = data?.viewer?.login ?? null;
        // Only claimed when the token demonstrably worked. A null repository
        // beside a null viewer means the whole query failed to resolve, which
        // says nothing about this repository in particular.
        if (login === null) return NO_PROBE;
        return {
          login,
          repository: data?.repository == null ? 'invisible' : 'visible',
          tokenRejected: false,
        };
      } catch (error) {
        // Before the `AuthError` it extends. A token cleared between the
        // original failure and this probe would otherwise be reported as
        // "GitHub rejected your token" — a sentence about a token that is not
        // there, which is the exact species of wrong this all exists to end.
        if (error instanceof MissingTokenError) return NO_PROBE;
        // GitHub refusing the token outright is itself an answer, and the most
        // decisive one available.
        if (error instanceof AuthError) return { ...NO_PROBE, tokenRejected: true };
        logWarn('the access probe could not run', error);
        return NO_PROBE;
      }
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

    /**
     * A caught error, as the whole of what the page will be told.
     *
     * The single funnel. `toProtocolError` still decides `kind`, which is what
     * routes between the setup page, the unlock page and the error page and
     * must not change shape. Everything this adds is the part that used to be
     * missing: which failure this actually is, proved where it can be.
     *
     * Ordered so nothing is diagnosed twice. A rate limit and a missing token
     * are already known for certain by the time they reach here, so they are
     * stated; only what is left is reasoned about, and only what is worth a
     * round trip is probed.
     */
    async function explainFailure(
      error: unknown,
      pr: PrRef | null,
    ): Promise<ProtocolError> {
      const base = toProtocolError(error);

      // Never touched GitHub, so there is no evidence and nothing to infer.
      if (base.kind === 'bad-request') return base;

      if (error instanceof RateLimitError) {
        return { ...base, diagnosis: statedDiagnosis('rate-limited') };
      }
      if (error instanceof MissingTokenError) {
        return { ...base, diagnosis: statedDiagnosis('no-token') };
      }

      const evidence = evidenceOf(error);
      const probe = worthProbing(error, evidence) ? await probeAccess(pr) : NO_PROBE;
      // `pr` is only used to name the repository in the observed lines, so a
      // request that has no pull request — the options page's token check —
      // still gets a diagnosis, just without those two sentences.
      return { ...base, diagnosis: diagnose(pr, evidence, probe) };
    }

    const ok = <K extends MessageKind>(data: ResultOf<K>): ResponseOf<K> => ({
      ok: true,
      data,
    });

    async function route(message: Message, tab: SenderTab | undefined): Promise<Response> {
      try {
        switch (message.kind) {
          case 'prefetch-pr':
            return ok<'prefetch-pr'>(prefetch(message.pr));
          case 'open-review':
            return ok<'open-review'>(await openReview(message.pr, message.reason, tab));
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
        // `pr` where the request carried one. Two kinds do not, and for those
        // the diagnosis is about the token alone rather than about access to
        // any particular repository.
        const pr = 'pr' in message ? (message.pr ?? null) : null;
        return { ok: false, error: await explainFailure(error, pr) };
      }
    }

    /**
     * Drop a review tab from the registry when it closes.
     *
     * Registered at the top level of `main` so it survives the worker being
     * killed and restarted, like every other listener here. It is not the only
     * way an entry leaves — a tab closed while this worker was asleep is
     * noticed later by `existingReviewTab` — but it is the cheap one.
     */
    browser.tabs.onRemoved.addListener((tabId) => {
      void forgetReviewTab(tabId).catch((error: unknown) => {
        logWarn('could not forget a review tab', error);
      });
    });

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
        void route(raw, sender.tab).then(sendResponse);
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

