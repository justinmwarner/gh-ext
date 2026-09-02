export interface TokenProvider {
  getToken(): Promise<string | null>;
}

export class AuthError extends Error {}

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

/** The reset time of this exact response, or null if it did not carry one. */
function parseResetAt(res: Response): Date | null {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null;
}

export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: Date;
}

export class GitHubClient {
  private lastRateLimit: RateLimitStatus | null = null;

  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getRateLimit(): RateLimitStatus | null {
    return this.lastRateLimit;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.request('https://api.github.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    // A GraphQL error arrives with HTTP 200. Checking res.ok is not enough.
    if (json.errors?.length) {
      throw new Error(json.errors.map((e: { message: string }) => e.message).join('; '));
    }
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
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      // Read the reset time off this response, not off lastRateLimit. A 403
      // need not carry all three headers, so lastRateLimit may still be null
      // (a non-null assertion there turns a rate limit into a TypeError) or
      // may hold a stale reset time recorded by an earlier request.
      throw new RateLimitError('GitHub rate limit exceeded', parseResetAt(res));
    }
    if (!res.ok) throw new Error(`GitHub request failed: ${res.status}`);
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
