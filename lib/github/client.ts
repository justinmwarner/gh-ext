import {
  type DeniedField,
  describeDenied,
  isRateLimited,
  normalizeErrors,
} from './graphql-errors';

export interface TokenProvider {
  getToken(): Promise<string | null>;
}

export class AuthError extends Error {}

/**
 * A request GitHub refused, with the status it refused with.
 *
 * The status is a field rather than only a sentence because callers act on it.
 * `fetchDiffPayload` retries against a different endpoint when GitHub cannot
 * generate a diff, and must not retry a denial, a missing repository or a
 * throttle — three cases where the second request is guaranteed to fail too,
 * and where reporting the *fallback's* error hides the real one.
 */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`GitHub request failed: ${status}`);
  }
}

export class RateLimitError extends Error {
  /**
   * When the quota refills, or null when GitHub did not send a usable
   * `x-ratelimit-reset` header. Callers must handle null rather than assume a
   * countdown is available.
   */
  constructor(
    message: string,
    readonly resetAt: Date | null,
  ) {
    super(message);
  }
}

/**
 * The reset time of this exact response, or null if it did not carry one.
 *
 * Two headers, in this order. `x-ratelimit-reset` is an absolute instant and
 * is what a primary limit sends. `Retry-After` is a relative number of seconds
 * and is what a *secondary* limit sends — a different mechanism, with none of
 * the `x-ratelimit-*` headers alongside it, so without reading it a secondary
 * limit has no countdown at all.
 */
function parseResetAt(res: Response): Date | null {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000);

  const after = Number(res.headers.get('retry-after'));
  return Number.isFinite(after) && after > 0 ? new Date(Date.now() + after * 1000) : null;
}

/**
 * Whether this response is GitHub asking for the request to stop, not fail.
 *
 * Three shapes, because GitHub has three. The primary limit is a 403 with the
 * remaining count at zero. A secondary limit is a 403 or 429 carrying
 * `Retry-After` and leaves the remaining count untouched. And 429 on its own
 * is the plain answer to too many requests. Missing any of them means the
 * reviewer is told "Something went wrong" over a problem that fixes itself.
 */
function isRateLimitResponse(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  return (
    res.headers.get('x-ratelimit-remaining') === '0' ||
    res.headers.get('retry-after') !== null
  );
}

export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: Date;
}

export class GitHubClient {
  private lastRateLimit: RateLimitStatus | null = null;

  /**
   * The transport, wrapped so it is never called as a method of this object.
   *
   * Not a parameter property, and the wrapper is not decoration. `fetch` is a
   * global function that refuses any receiver but its own global, and
   * `this.fetchImpl(url, init)` hands it this client — which in the background
   * service worker, where every request in this extension is actually made,
   * fails with "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal
   * invocation" before a single byte leaves. The arrow drops the receiver and
   * calls it plainly, which is what `fetch` requires.
   *
   * Invisible to a test that injects its own transport, because an ordinary
   * function does not care what `this` is. Found in a real browser.
   */
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly tokens: TokenProvider,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  getRateLimit(): RateLimitStatus | null {
    return this.lastRateLimit;
  }

  /**
   * Run a document.
   *
   * A GraphQL response is not pass or fail, and treating it as one is how a
   * whole review page was lost to a missing status-check widget. GitHub answers
   * HTTP 200 with `data` populated *and* an `errors` array whenever it resolved
   * most of a query but not all of it — the usual cause being a fine-grained
   * token that grants the repository and not one field inside it. The denied
   * field comes back null; everything else is complete and correct.
   *
   * `onPartial` is how a caller says it can cope with that. Supply one and a
   * response that still carries data is returned, with the denials handed over
   * so they can be shown rather than swallowed. Supply nothing and any error is
   * fatal, exactly as before.
   *
   * That default is not timidity, it is the only safe rule for mutations. A
   * mutation answering `{ data: { addPullRequestReviewThread: null }, errors:
   * [...] }` has not posted the comment, and returning that data as a success
   * would destroy the reviewer's writing while telling them it was saved. Reads
   * opt in; mutations must not.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    onPartial?: (denied: DeniedField[]) => void,
  ): Promise<T> {
    const res = await this.request('https://api.github.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    const denied = normalizeErrors(json.errors);

    // Nothing resolved, so there is nothing to tolerate. Returning null here
    // would only move the failure to whoever reads the payload next, where it
    // would arrive stripped of any explanation.
    // Before the general case, because a spent quota arrives as an ordinary
    // HTTP 200 and would otherwise become a bare Error the worker cannot
    // classify. Thrown even when `onPartial` was supplied: a rate limit is not
    // a field the caller can do without, it is the whole read failing.
    if (isRateLimited(denied)) {
      throw new RateLimitError(describeDenied(denied), parseResetAt(res));
    }

    const fatal = denied.length > 0 && (onPartial === undefined || json.data == null);
    if (fatal) throw new Error(describeDenied(denied));

    if (denied.length > 0) onPartial?.(denied);
    return json.data as T;
  }

  async fetchDiff(owner: string, repo: string, number: number): Promise<string> {
    const res = await this.request(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      { headers: { accept: 'application/vnd.github.diff' } },
    );
    return res.text();
  }

  /**
   * The diff between two commits, in the same unified format as `fetchDiff`.
   *
   * This is how "changes since my last review" is answered: `base` is the head
   * commit of the reviewer's previous review and `head` is the current head, so
   * the body is exactly the part of the pull request they have not seen.
   *
   * Refs are encoded because a ref is not always a SHA — a branch name may
   * carry a slash, which would otherwise open a path segment of its own. The
   * `...` between them is the compare syntax and is deliberately left alone.
   */
  async fetchCompare(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<string> {
    const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const res = await this.request(
      `https://api.github.com/repos/${owner}/${repo}/compare/${range}`,
      { headers: { accept: 'application/vnd.github.diff' } },
    );
    return res.text();
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const token = await this.tokens.getToken();
    if (!token) throw new AuthError('No GitHub token configured');

    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });

    this.recordRateLimit(res);

    if (res.status === 401) throw new AuthError('GitHub rejected the token');
    if (isRateLimitResponse(res)) {
      // Read the reset time off this response, not off lastRateLimit. A 403
      // need not carry all three headers, so lastRateLimit may still be null
      // (a non-null assertion there turns a rate limit into a TypeError) or
      // may hold a stale reset time recorded by an earlier request.
      throw new RateLimitError('GitHub rate limit exceeded', parseResetAt(res));
    }
    if (!res.ok) throw new HttpError(res.status);
    return res;
  }

  private recordRateLimit(res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const limit = res.headers.get('x-ratelimit-limit');
    const resetAt = parseResetAt(res);
    if (remaining && limit && resetAt) {
      this.lastRateLimit = {
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt,
      };
    }
  }
}
