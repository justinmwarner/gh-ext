import { describe, expect, it } from 'vitest';
import { AuthError, GitHubClient, RateLimitError, type TokenProvider } from './client';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** A fake fetch that records every call and replies from `respond`. */
function recordingFetch(respond: (index: number) => Response) {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return respond(calls.length - 1);
  };
  return { impl, calls };
}

const tokens = (token: string | null): TokenProvider => ({
  getToken: async () => token,
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function headersOf(call: RecordedCall | undefined): Headers {
  return new Headers(call?.init.headers);
}

/** 2030-01-01T00:00:00Z, in epoch seconds, as GitHub sends it. */
const RESET_EPOCH = 1893456000;

const RATE_LIMIT_HEADERS = {
  'x-ratelimit-remaining': '4999',
  'x-ratelimit-limit': '5000',
  'x-ratelimit-reset': String(RESET_EPOCH),
};

describe('GitHubClient.graphql', () => {
  it('sends the bearer token and posts the query and variables as JSON', async () => {
    const fake = recordingFetch(() => jsonResponse({ data: { viewer: { login: 'me' } } }));
    const client = new GitHubClient(tokens('t0ken'), fake.impl);

    await client.graphql('query Q { viewer { login } }', { number: 7 });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('https://api.github.com/graphql');
    expect(fake.calls[0]?.init.method).toBe('POST');
    expect(headersOf(fake.calls[0]).get('authorization')).toBe('Bearer t0ken');
    expect(headersOf(fake.calls[0]).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(fake.calls[0]?.init.body))).toEqual({
      query: 'query Q { viewer { login } }',
      variables: { number: 7 },
    });
  });

  it('rejects when the body carries GraphQL errors, even on HTTP 200', async () => {
    // GitHub answers a bad query with status 200 and an `errors` array.
    // Checking res.ok alone would swallow this and return undefined data.
    const fake = recordingFetch(() =>
      jsonResponse({
        data: null,
        errors: [
          { message: 'Could not resolve to a Repository with the name ghost/nope.' },
          { message: 'Field mystery does not exist on PullRequest' },
        ],
      }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    const err = await client.graphql('query Q { nope }', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain('Could not resolve to a Repository with the name ghost/nope.');
    expect(String(err)).toContain('Field mystery does not exist on PullRequest');
  });

  it('resolves with data when there is no errors key', async () => {
    const fake = recordingFetch(() => jsonResponse({ data: { repository: { id: 'R_1' } } }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.graphql('q', {})).resolves.toEqual({ repository: { id: 'R_1' } });
  });

  it('resolves with data when errors is an empty array', async () => {
    const fake = recordingFetch(() =>
      jsonResponse({ data: { repository: { id: 'R_1' } }, errors: [] }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.graphql('q', {})).resolves.toEqual({ repository: { id: 'R_1' } });
  });
});

describe('GitHubClient.fetchDiff', () => {
  it('asks for the diff media type and returns the raw body', async () => {
    const diff = 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
    const fake = recordingFetch(() => new Response(diff, { status: 200 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.fetchDiff('octo', 'repo', 7)).resolves.toBe(diff);

    expect(fake.calls[0]?.url).toBe('https://api.github.com/repos/octo/repo/pulls/7');
    expect(headersOf(fake.calls[0]).get('accept')).toBe('application/vnd.github.diff');
    expect(headersOf(fake.calls[0]).get('authorization')).toBe('Bearer t');
  });
});

describe('GitHubClient error classification', () => {
  it('rejects a 401 with AuthError so the UI can show its setup state', async () => {
    const fake = recordingFetch(() => new Response('{}', { status: 401 }));
    const client = new GitHubClient(tokens('stale'), fake.impl);

    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
  });

  it('rejects a rate-limited 403 with RateLimitError carrying resetAt', async () => {
    const fake = recordingFetch(
      () =>
        new Response('{}', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-reset': String(RESET_EPOCH),
          },
        }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).resetAt).toBeInstanceOf(Date);
    expect((err as RateLimitError).resetAt?.getTime()).toBe(RESET_EPOCH * 1000);
  });

  it('treats a 403 without an exhausted quota as a plain error, not rate limiting', async () => {
    // A permissions failure (SAML, missing scope) is also a 403. Reporting it
    // as rate limiting would send the user off to wait for a reset that fixes
    // nothing.
    const fake = recordingFetch(
      () =>
        new Response('{}', {
          status: 403,
          headers: { ...RATE_LIMIT_HEADERS },
        }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(String(err)).toContain('403');
  });

  it('rejects a rate-limited 403 that omits the reset header instead of crashing', async () => {
    // GitHub does not guarantee all three headers on every 403. Reading
    // resetAt off a possibly-null recorded status would throw a TypeError
    // here, hiding the real failure behind a crash.
    const fake = recordingFetch(
      () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as RateLimitError).resetAt).toBeNull();
  });

  it('does not report a stale reset time from an earlier response', async () => {
    const fake = recordingFetch((i) =>
      i === 0
        ? jsonResponse({ data: {} }, { headers: { ...RATE_LIMIT_HEADERS } })
        : new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    await client.graphql('q', {});
    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).resetAt).toBeNull();
  });

  it('rejects a non-2xx response that is neither 401 nor 403', async () => {
    const fake = recordingFetch(() => new Response('boom', { status: 502 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.graphql('q', {})).rejects.toThrow('502');
  });
});

describe('GitHubClient.getRateLimit', () => {
  it('is null before any request', () => {
    const fake = recordingFetch(() => jsonResponse({ data: {} }));
    expect(new GitHubClient(tokens('t'), fake.impl).getRateLimit()).toBeNull();
  });

  it('records the rate limit headers of a successful response', async () => {
    const fake = recordingFetch(() =>
      jsonResponse({ data: {} }, { headers: { ...RATE_LIMIT_HEADERS } }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    await client.graphql('q', {});

    expect(client.getRateLimit()).toEqual({
      remaining: 4999,
      limit: 5000,
      resetAt: new Date(RESET_EPOCH * 1000),
    });
  });
});

describe('GitHubClient without a token', () => {
  it('rejects with AuthError before attempting any fetch', async () => {
    const fake = recordingFetch(() => jsonResponse({ data: {} }));
    const client = new GitHubClient(tokens(null), fake.impl);

    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects fetchDiff with AuthError before attempting any fetch', async () => {
    const fake = recordingFetch(() => new Response('diff', { status: 200 }));
    const client = new GitHubClient(tokens(null), fake.impl);

    await expect(client.fetchDiff('octo', 'repo', 7)).rejects.toBeInstanceOf(AuthError);
    expect(fake.calls).toHaveLength(0);
  });
});
