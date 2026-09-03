import { describe, expect, it } from 'vitest';
import {
  AuthError,
  GitHubClient,
  HttpError,
  RateLimitError,
  type TokenProvider,
} from './client';
import type { DeniedField } from './graphql-errors';

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

describe('GitHubClient.fetchCompare', () => {
  it('asks the compare endpoint for a diff between two commits', async () => {
    // "Changes since my last review" is exactly `thatSha...headSha`, and the
    // body is the same unified diff `parseUnifiedDiff` already handles.
    const diff = ['diff --git a/a.ts b/a.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    const fake = recordingFetch(() => new Response(diff, { status: 200 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.fetchCompare('octo', 'repo', 'base1', 'head2')).resolves.toBe(
      diff,
    );

    expect(fake.calls[0]?.url).toBe(
      'https://api.github.com/repos/octo/repo/compare/base1...head2',
    );
    expect(headersOf(fake.calls[0]).get('accept')).toBe('application/vnd.github.diff');
    expect(headersOf(fake.calls[0]).get('authorization')).toBe('Bearer t');
  });

  it('escapes a ref that is a branch name with a slash in it', async () => {
    const fake = recordingFetch(() => new Response('', { status: 200 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await client.fetchCompare('octo', 'repo', 'release/1.0', 'main');

    expect(fake.calls[0]?.url).toBe(
      'https://api.github.com/repos/octo/repo/compare/release%2F1.0...main',
    );
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

describe('how the transport is invoked', () => {
  it('calls fetch as a bare function rather than as a method of the client', async () => {
    // Found in a real browser, invisible to every other test in this file.
    //
    // The default transport is the global `fetch`, and `this.fetchImpl(url)`
    // invokes it with the client as its receiver. `fetch` refuses any receiver
    // but its own global: in the service worker — where every request in this
    // extension is actually made — that is
    // "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
    // and the extension cannot reach GitHub at all.
    //
    // Every other test here injects its own plain function, which does not care
    // what `this` is, so the whole suite passed against a client that could not
    // make a single request.
    let receiver: unknown = 'never called';
    const spy = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(new Response('diff --git a/a b/a'));
    };

    const client = new GitHubClient(tokens('t0ken'), spy as unknown as typeof fetch);
    await client.fetchDiff('acme', 'widgets', 42);

    expect(receiver).toBeUndefined();
  });
});

/**
 * A partly-denied read.
 *
 * The failure this covers, in full: a fine-grained token grants the repository
 * but not the Checks permission, so GitHub resolves the entire pull request,
 * nulls out the seven check runs it will not show, and answers 200 with `data`
 * *and* an `errors` array. Throwing there threw away a complete pull request
 * over a missing status-check widget, and the review page — every part of which
 * is written to tolerate a nulled field — never got to see any of it.
 *
 * The tolerance is opt-in, because it must not reach mutations. A mutation that
 * comes back `{ data: { addPullRequestReviewThread: null }, errors: [...] }` has
 * not posted the comment, and returning that data as if it had would lose the
 * reviewer's writing while telling them it was saved.
 */
describe('GitHubClient.graphql on a partly-denied response', () => {
  const CHECKS_DENIED = {
    data: { repository: { pullRequest: { id: 'PR_1', title: 'Add a thing' } } },
    errors: Array.from({ length: 7 }, (_, index) => ({
      type: 'FORBIDDEN',
      path: ['repository', 'pullRequest', 'commits', 'nodes', 0, 'commit', 'statusCheckRollup', 'contexts', 'nodes', index],
      message: 'Resource not accessible by personal access token',
    })),
  };

  it('returns the data when the caller offered to handle the denials', async () => {
    const fake = recordingFetch(() => jsonResponse(CHECKS_DENIED));
    const client = new GitHubClient(tokens('t'), fake.impl);

    const data = await client.graphql('q', {}, () => {});

    expect(data).toEqual(CHECKS_DENIED.data);
  });

  it('hands the denials over, grouped, with the path intact', async () => {
    const fake = recordingFetch(() => jsonResponse(CHECKS_DENIED));
    const client = new GitHubClient(tokens('t'), fake.impl);

    const seen: DeniedField[][] = [];
    await client.graphql('q', {}, (denied) => seen.push(denied));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      {
        message: 'Resource not accessible by personal access token',
        path: 'repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.contexts.nodes.N',
        count: 7,
        type: 'FORBIDDEN',
      },
    ]);
  });

  it('does not call the handler when nothing was denied', async () => {
    const fake = recordingFetch(() => jsonResponse({ data: { repository: { id: 'R_1' } } }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    let called = false;
    await client.graphql('q', {}, () => {
      called = true;
    });

    expect(called).toBe(false);
  });

  it('still rejects when no handler was offered, so a failed mutation cannot look like a success', async () => {
    const fake = recordingFetch(() =>
      jsonResponse({
        data: { addPullRequestReviewThread: null },
        errors: [{ message: 'Resource not accessible by personal access token' }],
      }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.graphql('mutation M { x }', {})).rejects.toThrow(
      'Resource not accessible by personal access token',
    );
  });

  it('rejects even with a handler when there is no data at all', async () => {
    // Nothing resolved. There is nothing to tolerate, and returning null here
    // would push the failure into whatever reads the payload next.
    const fake = recordingFetch(() =>
      jsonResponse({
        data: null,
        errors: [{ message: 'Could not resolve to a Repository', path: ['repository'] }],
      }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    let called = false;
    const err = await client
      .graphql('q', {}, () => {
        called = true;
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(called).toBe(false);
  });

  it('names the path in the thrown message', async () => {
    // Seven copies of one sentence was the whole of the old diagnosis.
    const fake = recordingFetch(() => jsonResponse({ ...CHECKS_DENIED, data: null }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    const err = await client.graphql('q', {}).catch((e: unknown) => e);

    expect(String(err)).toContain('statusCheckRollup');
    expect(String(err)).toContain('7 fields');
  });
});

describe('the rate limits that are not a 403', () => {
  /**
   * Only one shape was recognised: HTTP 403 with `x-ratelimit-remaining: 0`.
   * Everything else fell through to a bare `Error`, which the worker cannot
   * classify — so the reviewer got "Something went wrong" with no reset time,
   * no advice to wait, and not even the "Check your token" button, over a
   * problem that has nothing to do with their token.
   */
  it('reads a GraphQL RATE_LIMITED reply as a rate limit', async () => {
    // The primary GraphQL quota is reported as HTTP 200 with a null `data`,
    // so nothing about the response status says what happened.
    const fake = recordingFetch(() =>
      jsonResponse({
        data: null,
        errors: [
          { type: 'RATE_LIMITED', message: 'API rate limit exceeded for user ID 1.' },
        ],
      }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.graphql('query { viewer { login } }', {})).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('reads HTTP 429 as a rate limit', async () => {
    const fake = recordingFetch(() => new Response('{}', { status: 429 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.fetchDiff('acme', 'widgets', 42)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('takes the wait from Retry-After when there is no reset header', async () => {
    // A secondary rate limit carries `Retry-After` in seconds and leaves
    // `x-ratelimit-remaining` non-zero, so neither of the old signals fires.
    const fake = recordingFetch(
      () =>
        new Response('{}', {
          status: 403,
          headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4999' },
        }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    const error = await client.fetchDiff('acme', 'widgets', 42).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    const resetAt = (error as RateLimitError).resetAt;
    expect(resetAt).not.toBeNull();
    // Roughly a minute out; the exact instant depends on when the test ran.
    const seconds = ((resetAt as Date).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThanOrEqual(61);
  });

  it('still prefers the reset header when both are present', async () => {
    const fake = recordingFetch(
      () =>
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '60', 'x-ratelimit-reset': String(RESET_EPOCH) },
        }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    const error = await client.fetchDiff('acme', 'widgets', 42).catch((e: unknown) => e);

    expect((error as RateLimitError).resetAt?.getTime()).toBe(RESET_EPOCH * 1000);
  });

  it('leaves an ordinary 403 as an ordinary failure', async () => {
    // A permission denial is not a rate limit and the remedy is different:
    // waiting will never fix it.
    const fake = recordingFetch(() => new Response('{}', { status: 403 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.fetchDiff('acme', 'widgets', 42)).rejects.not.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('does not mistake an ordinary GraphQL denial for a rate limit', async () => {
    const fake = recordingFetch(() =>
      jsonResponse({
        data: null,
        errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible.' }],
      }),
    );
    const client = new GitHubClient(tokens('t'), fake.impl);

    await expect(client.graphql('query { viewer { login } }', {})).rejects.not.toBeInstanceOf(
      RateLimitError,
    );
  });
});

describe('what a failed request tells its caller', () => {
  it('carries the status, so a caller can tell 403 from 406', async () => {
    // Without this the status survives only inside a message string, and
    // `fetchDiffPayload` had no way to distinguish "this diff is too big to
    // generate" — the one case worth retrying elsewhere — from a denial or a
    // rate limit, so it retried all of them.
    const fake = recordingFetch(() => new Response('{}', { status: 404 }));
    const client = new GitHubClient(tokens('t'), fake.impl);

    const error = await client.fetchDiff('acme', 'widgets', 42).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });
});
