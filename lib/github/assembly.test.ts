/**
 * The background worker's data path.
 *
 * Three things are pinned here that a reviewer cannot see by reading the code:
 * that the two cold-start round trips overlap rather than queue, that a diff
 * failure never masks a missing pull request, and that a pull request with more
 * than one page of files or threads does not silently lose the tail.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { PrCache } from '../cache';
import type { KeyValueStore } from '../review/drafts';
import {
  type AssemblyPorts,
  type GitHubPort,
  assemblePullRequest,
  headPointerKey,
  payloadFromCache,
} from './assembly';
import { GitHubClient, type TokenProvider } from './client';
import type { DeniedField } from './graphql-errors';
import { MAX_PAGES } from './pagination';

const PR = { owner: 'acme', repo: 'widgets', number: 42 };
const HEAD = 'a'.repeat(40);

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;

function memoryStore(): KeyValueStore & { raw: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    raw: map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
    remove: async (k) => {
      map.delete(k);
    },
    keys: async () => [...map.keys()],
  };
}

/** Let every already-scheduled microtask and timer callback run. */
const settleAll = async (turns = 5): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

interface FileNode {
  path: string;
  additions: number;
  deletions: number;
  changeType: string;
  viewerViewedState: string;
}

const file = (path: string): FileNode => ({
  path,
  additions: 1,
  deletions: 0,
  changeType: 'MODIFIED',
  viewerViewedState: 'UNVIEWED',
});

const thread = (id: string) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'src/a.ts',
  line: 1,
  startLine: 1,
  originalLine: 1,
  originalStartLine: 1,
  diffSide: 'RIGHT',
  startDiffSide: null,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: true,
  viewerCanUnresolve: false,
  comments: { totalCount: 1, nodes: [] },
});

const page = <T>(nodes: T[], cursor: string | null) => ({
  nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});

interface PrDataOptions {
  headRefOid?: string;
  files?: ReturnType<typeof page<FileNode>>;
  reviewThreads?: ReturnType<typeof page<ReturnType<typeof thread>>>;
}

function prData(options: PrDataOptions = {}) {
  return {
    repository: {
      pullRequest: {
        id: 'PR_kwDOABCD',
        number: PR.number,
        title: 'Cache the diff on head SHA',
        headRefOid: options.headRefOid ?? HEAD,
        files: options.files ?? page([file('src/a.ts')], null),
        reviewThreads: options.reviewThreads ?? page([thread('T1')], null),
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
      },
    },
  };
}

/** Which document a call carries, read off its operation name. */
function operationOf(document: string): 'pr' | 'files' | 'threads' {
  if (document.includes('query PullRequestFilesPage')) return 'files';
  if (document.includes('query PullRequestReviewThreadsPage')) return 'threads';
  return 'pr';
}

interface StubOptions {
  pr?: unknown;
  filesPage?: (after: string) => unknown;
  threadsPage?: (after: string) => unknown;
  graphqlError?: Error;
  diff?: string;
  diffError?: Error;
  /** Fields GitHub refused, reported the way the real client reports them. */
  denied?: DeniedField[];
}

/** A `GitHubPort` that answers from fixtures and records what it was asked. */
function stubGitHub(options: StubOptions = {}) {
  const calls: string[] = [];
  const port: GitHubPort = {
    async graphql<T>(
      document: string,
      variables: Record<string, unknown>,
      onPartial?: (denied: DeniedField[]) => void,
    ): Promise<T> {
      const operation = operationOf(document);
      calls.push(`graphql:${operation}`);
      if (options.graphqlError) throw options.graphqlError;
      if (options.denied && options.denied.length > 0) onPartial?.(options.denied);
      if (operation === 'files') {
        return options.filesPage?.(String(variables['after'])) as T;
      }
      if (operation === 'threads') {
        return options.threadsPage?.(String(variables['after'])) as T;
      }
      return (options.pr ?? prData()) as T;
    },
    async fetchDiff(): Promise<string> {
      calls.push('diff');
      if (options.diffError) throw options.diffError;
      return options.diff ?? SAMPLE_DIFF;
    },
  };
  return { port, calls };
}

function testPorts(github: GitHubPort, store = memoryStore()) {
  const writes: Promise<void>[] = [];
  const ports: AssemblyPorts = {
    github,
    cache: new PrCache(store),
    store,
    fetchImpl: async () => {
      throw new Error('the files fallback must not be reached in this test');
    },
    cacheWrite: (promise) => {
      writes.push(promise);
    },
  };
  // Cache writes are fire-and-forget in production; tests join them so the
  // store is settled before they read it back.
  const flushWrites = () => Promise.all(writes);
  return { ports, store, flushWrites };
}

/**
 * A `fetch` that records every request and answers only when told to.
 *
 * The point of the concurrency test is what has been *issued* while nothing has
 * come back, which needs a transport the test holds open.
 */
function gatedFetch() {
  const urls: string[] = [];
  const gates: Array<(response: Response) => void> = [];
  const impl: typeof fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input.toString());
    return new Promise<Response>((resolve) => {
      gates.push(resolve);
    });
  };
  return { impl, urls, gates };
}

const tokens = (token: string): TokenProvider => ({ getToken: async () => token });

/** Node only emits this event while something is listening for it. */
function captureUnhandled() {
  const seen: unknown[] = [];
  const listener = (reason: unknown) => {
    seen.push(reason);
  };
  process.on('unhandledRejection', listener);
  return { seen, stop: () => void process.off('unhandledRejection', listener) };
}

let capture: ReturnType<typeof captureUnhandled> | null = null;
afterEach(() => {
  capture?.stop();
  capture = null;
});

describe('assemblePullRequest — the two cold-start round trips', () => {
  it('issues the query and the diff request before either one answers', async () => {
    const gate = gatedFetch();
    const client = new GitHubClient(tokens('t0ken'), gate.impl);
    const { ports } = testPorts(client);

    const payload = assemblePullRequest(ports, PR);
    // Nothing is answered — only the token read and the cache probe are let
    // through — so anything issued by now was issued concurrently.
    await settleAll();

    expect(gate.urls).toEqual([
      'https://api.github.com/graphql',
      'https://api.github.com/repos/acme/widgets/pulls/42',
    ]);

    gate.gates[0]?.(new Response(JSON.stringify({ data: prData() }), { status: 200 }));
    gate.gates[1]?.(new Response(SAMPLE_DIFF, { status: 200 }));

    const resolved = await payload;
    expect(resolved.headSha).toBe(HEAD);
    expect(resolved.diff.files).toHaveLength(1);
  });

  it('reports a missing pull request rather than the diff failure', async () => {
    capture = captureUnhandled();
    const stub = stubGitHub({
      pr: { repository: { pullRequest: null } },
      diffError: new Error('GitHub request failed: 500'),
    });
    const { ports } = testPorts(stub.port);

    await expect(assemblePullRequest(ports, PR)).rejects.toThrow(/No pull request/);

    // A rejected diff started alongside the query must not surface as an
    // unhandled rejection while the query is being inspected.
    await settleAll();
    expect(capture.seen).toEqual([]);
  });

  it('caches nothing when the diff fails but the pull request exists', async () => {
    const stub = stubGitHub({ diffError: new Error('GitHub request failed: 500') });
    const { ports, store } = testPorts(stub.port);
    ports.fetchImpl = async () => {
      throw new Error('files fallback also failed');
    };

    await expect(assemblePullRequest(ports, PR)).rejects.toThrow();
    await settleAll();

    expect([...store.raw.keys()]).toEqual([]);
  });

  it('reuses a cached diff for the same head SHA instead of re-fetching', async () => {
    const stub = stubGitHub();
    const { ports, store, flushWrites } = testPorts(stub.port);

    await assemblePullRequest(ports, PR);
    await flushWrites();
    stub.calls.length = 0;

    const second = await assemblePullRequest(ports, PR);

    expect(stub.calls).not.toContain('diff');
    expect(second.diff.files).toHaveLength(1);
    expect(store.raw.get(headPointerKey(PR))).toBe(HEAD);
  });

  it('discards a cached diff left over from a superseded head commit', async () => {
    const stub = stubGitHub();
    const { ports, flushWrites } = testPorts(stub.port);

    await assemblePullRequest(ports, PR);
    await flushWrites();
    stub.calls.length = 0;

    // A new commit landed: the pointer still names the old SHA, and the diff
    // cached under it is a diff of the wrong commit.
    const moved = stubGitHub({ pr: prData({ headRefOid: 'b'.repeat(40) }) });
    ports.github = moved.port;
    const second = await assemblePullRequest(ports, PR);

    expect(moved.calls).toContain('diff');
    expect(second.headSha).toBe('b'.repeat(40));
  });
});

describe('assemblePullRequest — pagination', () => {
  it('follows the file cursor to the last page', async () => {
    const stub = stubGitHub({
      pr: prData({ files: page([file('a'), file('b')], 'c1') }),
      filesPage: (after) => ({
        repository: {
          pullRequest: {
            files:
              after === 'c1'
                ? page([file('c'), file('d')], 'c2')
                : page([file('e')], null),
          },
        },
      }),
    });
    const { ports } = testPorts(stub.port);

    const payload = await assemblePullRequest(ports, PR);
    const files = (payload.pullRequest['files'] as { nodes: FileNode[] }).nodes;

    expect(files.map((f) => f.path)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(payload.truncated.files).toBe(false);
  });

  it('keeps each thread comment connection, so a short one can be spotted', async () => {
    // `comments(first: 50)` is not paginated. A thread with more replies than
    // that has to be *detectable* rather than silently short, which is what
    // totalCount alongside the returned nodes is for.
    const stub = stubGitHub({
      pr: prData({ reviewThreads: page([thread('T1')], null) }),
    });
    const { ports } = testPorts(stub.port);

    const payload = await assemblePullRequest(ports, PR);
    const comments = payload.threads[0]?.comments;

    expect(comments?.totalCount).toBe(1);
    expect(comments?.nodes).toEqual([]);
  });

  it('follows the review thread cursor to the last page', async () => {
    const stub = stubGitHub({
      pr: prData({ reviewThreads: page([thread('T1'), thread('T2')], 'c1') }),
      threadsPage: (after) => ({
        repository: {
          pullRequest: {
            reviewThreads:
              after === 'c1'
                ? page([thread('T3'), thread('T4')], 'c2')
                : page([thread('T5')], null),
          },
        },
      }),
    });
    const { ports } = testPorts(stub.port);

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.threads.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(payload.truncated.threads).toBe(false);
  });

  it('stops at the page cap and says the list is incomplete', async () => {
    // A connection that never admits to a last page. Without a cap this loops
    // until the hour's quota is gone.
    const endless = { repository: { pullRequest: { files: page([file('x')], 'more') } } };
    const stub = stubGitHub({
      pr: prData({ files: page([file('a')], 'c1') }),
      filesPage: () => endless,
    });
    const { ports } = testPorts(stub.port);
    ports.maxPages = 3;

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.truncated.files).toBe(true);
    expect(payload.truncated.threads).toBe(false);
    // Three pages in total: the one the main query returned, plus two.
    expect(stub.calls.filter((c) => c === 'graphql:files')).toHaveLength(2);
  });

  it('caps an endless connection even with no cap configured', async () => {
    const endless = { repository: { pullRequest: { files: page([file('x')], 'more') } } };
    const stub = stubGitHub({
      pr: prData({ files: page([file('a')], 'c1') }),
      filesPage: () => endless,
    });
    const { ports } = testPorts(stub.port);

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.truncated.files).toBe(true);
    expect(stub.calls.filter((c) => c === 'graphql:files')).toHaveLength(MAX_PAGES - 1);
  });

  it('stops at the page cap for review threads too', async () => {
    const endless = {
      repository: { pullRequest: { reviewThreads: page([thread('X')], 'more') } },
    };
    const stub = stubGitHub({
      pr: prData({ reviewThreads: page([thread('T1')], 'c1') }),
      threadsPage: () => endless,
    });
    const { ports } = testPorts(stub.port);
    ports.maxPages = 4;

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.truncated.threads).toBe(true);
    expect(stub.calls.filter((c) => c === 'graphql:threads')).toHaveLength(3);
  });

  it('carries the truncation flags through the cache', async () => {
    const endless = { repository: { pullRequest: { files: page([file('x')], 'more') } } };
    const stub = stubGitHub({
      pr: prData({ files: page([file('a')], 'c1') }),
      filesPage: () => endless,
    });
    const { ports, flushWrites } = testPorts(stub.port);
    ports.maxPages = 2;

    await assemblePullRequest(ports, PR);
    await flushWrites();

    const cached = await payloadFromCache(ports, PR);
    expect(cached?.truncated).toEqual({ files: true, threads: false });
  });
});

/**
 * A pull request GitHub only partly answered.
 *
 * The real case: a fine-grained token grants the repository but not the Checks
 * permission, so the seven check runs come back null with one error each while
 * the pull request itself, its files, its threads and its diff are all present
 * and correct. Every consumer below this point already copes with a nulled
 * `statusCheckRollup` — `checksSummary(null)` has a branch for it — so the
 * payload must be assembled, not abandoned.
 *
 * What it must not do is stay quiet about it. `checks: null` renders as "No
 * checks", and telling a reviewer a pull request has no CI when the truth is
 * that they are not allowed to see it is worse than the crash was.
 */
describe('a partly-denied response', () => {
  const CHECKS_DENIED: DeniedField[] = [
    {
      message: 'Resource not accessible by personal access token',
      path: 'repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.contexts.nodes.N',
      count: 7,
    },
  ];

  it('assembles the pull request anyway', async () => {
    const github = stubGitHub({ denied: CHECKS_DENIED });
    const { ports } = testPorts(github.port);

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.pullRequest.title).toBe('Cache the diff on head SHA');
    expect(payload.diff.files).toHaveLength(1);
    expect(payload.threads).toHaveLength(1);
  });

  it('carries what was refused into the payload', async () => {
    const github = stubGitHub({ denied: CHECKS_DENIED });
    const { ports } = testPorts(github.port);

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.denied).toEqual(CHECKS_DENIED);
  });

  it('reports nothing denied on an ordinary read', async () => {
    const github = stubGitHub();
    const { ports } = testPorts(github.port);

    const payload = await assemblePullRequest(ports, PR);

    expect(payload.denied).toEqual([]);
  });

  it('still remembers what was refused when the payload is served from cache', async () => {
    // A cached payload that forgot the denial would render "No checks" on the
    // second visit, which is the same lie arriving a minute later.
    const store = memoryStore();
    const github = stubGitHub({ denied: CHECKS_DENIED });
    const { ports, flushWrites } = testPorts(github.port, store);

    await assemblePullRequest(ports, PR);
    await flushWrites();

    const cached = await payloadFromCache(ports, PR);

    expect(cached?.denied).toEqual(CHECKS_DENIED);
  });
});
