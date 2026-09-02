/**
 * Loading the built extension into a real Chromium and cutting it off from the
 * network.
 *
 * Deliberately the **production** build (`.output/chrome-mv3`). Content scripts
 * get no HMR and are absent from the dev manifest, so the dev server is not an
 * honest target for a test that claims the extension works.
 *
 * Two facts make this possible and neither was obvious:
 *
 * - Chromium loads an unpacked extension in headless mode, so this needs no
 *   display.
 * - `context.route` intercepts `fetch` from the extension's own **service
 *   worker**, not merely from pages. That matters more than anything else here:
 *   the review page never fetches, so if worker traffic escaped interception
 *   the test would be talking to github.com.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Route, test as base } from '@playwright/test';
import {
  BASE_SHA,
  HEAD_SHA,
  POSTED_THREAD,
  PR,
  PULL_REQUEST_NODE,
  UNIFIED_DIFF,
  wholeFile,
} from './fixture';

export const EXTENSION_PATH = fileURLToPath(
  new URL('../.output/chrome-mv3', import.meta.url),
);

/** Requests the worker made, so a test can prove what was and was not sent. */
export interface ApiLog {
  operations: string[];
  variables: Record<string, unknown>[];
  urls: string[];
  /**
   * The review this reviewer already has open, if a test wants one.
   *
   * GitHub allows one PENDING review per pull request and refuses a second, so
   * a reviewer holding one cannot open another — which is the state the page
   * has to detect and join rather than fail in. Set it before opening the page.
   */
  pendingReviewId: string | null;
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

/**
 * Which document this is, read off the operation name in the query text.
 *
 * The worker sends whole documents from `lib/github/queries.ts` and
 * `lib/github/mutations.ts`, each of which names its operation, so matching on
 * that name is exact without parsing GraphQL.
 */
const operationOf = (query: string): string =>
  /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'unknown';

function graphqlReply(
  operation: string,
  variables: Record<string, unknown>,
  log: ApiLog,
): unknown {
  switch (operation) {
    case 'ViewerPendingReview':
      return {
        data: {
          repository: {
            pullRequest: {
              viewerLatestReview: null,
              reviews: {
                nodes:
                  log.pendingReviewId === null
                    ? []
                    : [{ id: log.pendingReviewId, state: 'PENDING' }],
              },
            },
          },
        },
      };

    case 'PullRequestReview':
      return { data: { repository: { pullRequest: PULL_REQUEST_NODE } } };

    case 'PullRequestFilesPage':
    case 'PullRequestReviewThreadsPage':
      // Neither connection has a second page. Answering emptily rather than
      // erroring keeps a stray follow-up from failing the whole assembly.
      return {
        data: {
          repository: {
            pullRequest: {
              files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          },
        },
      };

    case 'AddThread':
      return {
        data: {
          addPullRequestReviewThread: {
            thread: {
              ...POSTED_THREAD,
              path: String(variables['path'] ?? POSTED_THREAD.path),
              line: variables['line'] ?? POSTED_THREAD.line,
              comments: {
                totalCount: 1,
                nodes: [
                  {
                    ...POSTED_THREAD.comments.nodes[0],
                    body: String(variables['body'] ?? ''),
                  },
                ],
              },
            },
          },
        },
      };

    case 'StartReview':
      // GitHub allows one pending review per pull request, and this fake obeys
      // that: a reviewer who already has one gets the same refusal they would
      // get from the real API.
      if (log.pendingReviewId !== null) {
        return {
          errors: [
            { message: 'User can only have one pending review per pull request' },
          ],
        };
      }
      return {
        data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_pending' } } },
      };

    case 'SubmitReview':
      return {
        data: {
          submitPullRequestReview: {
            pullRequestReview: { id: 'PRR_pending', state: 'COMMENTED' },
          },
        },
      };

    case 'MarkViewed':
    case 'UnmarkViewed':
      return { data: { [operation]: { pullRequest: { id: PULL_REQUEST_NODE.id } } } };

    case 'ResolveThread':
    case 'UnresolveThread':
      return { data: { [operation]: { thread: { id: variables['threadId'] } } } };

    default:
      // `query { viewer { login } }` has no operation name.
      return { data: { viewer: { login: 'rowan' } } };
  }
}

/**
 * Answer every GitHub request from the fixture, and record it.
 *
 * The catch-all at the end is not politeness — it is the assertion that this
 * test never reaches the real API. Anything unrecognized is aborted rather than
 * passed through, so a request this file forgot fails the test that needed it
 * instead of quietly succeeding against github.com.
 */
export async function routeGitHub(context: BrowserContext): Promise<ApiLog> {
  const log: ApiLog = { operations: [], variables: [], urls: [], pendingReviewId: null };

  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    log.urls.push(url.pathname + url.search);

    if (url.pathname === '/graphql') {
      const body = request.postDataJSON() as {
        query: string;
        variables: Record<string, unknown>;
      };
      const operation = operationOf(body.query);
      log.operations.push(operation);
      log.variables.push(body.variables ?? {});
      await json(route, graphqlReply(operation, body.variables ?? {}, log));
      return;
    }

    if (url.pathname === `/repos/${PR.owner}/${PR.repo}/pulls/${PR.number}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.github.diff',
        body: UNIFIED_DIFF,
      });
      return;
    }

    const contents = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(url.pathname);
    if (contents !== null) {
      const path = decodeURIComponent(contents[1] ?? '');
      const ref = url.searchParams.get('ref');
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: wholeFile(path, ref === BASE_SHA ? 'base' : 'head'),
      });
      return;
    }

    await route.abort('failed');
  });

  // github.com itself, for the content script. A minimal page carrying the
  // header anchor the injector looks for.
  await context.route('https://github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<!doctype html><html><head><title>acme/widgets</title></head>' +
        '<body><div class="gh-header-actions"></div></body></html>',
    }),
  );

  return log;
}

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  api: ApiLog;
}

export const test = base.extend<Fixtures>({
  context: async ({ playwright }, use) => {
    if (!existsSync(EXTENSION_PATH)) {
      throw new Error(
        `No build at ${EXTENSION_PATH}. Run "npx wxt build" before the e2e suite — ` +
          'these tests deliberately drive the production output.',
      );
    }

    const context = await playwright.chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // The worker may already have started; if not, wait for it.
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },

  api: async ({ context, extensionId }, use) => {
    const log = await routeGitHub(context);

    // The worker refuses every request without a token, and the review page
    // renders the setup state rather than a diff. Written through the worker
    // itself so it lands in the same `storage.local` the options page uses.
    const worker = context.serviceWorkers()[0];
    if (worker === undefined) throw new Error('the extension worker never started');
    // Typed through the global rather than through `@types/chrome`: this runs
    // inside the extension's own worker, where `chrome` exists, and the test
    // process has no reason to take a dependency on the whole API surface.
    await worker.evaluate(async () => {
      const api = (globalThis as unknown as {
        chrome: { storage: { local: { set(items: Record<string, string>): Promise<void> } } };
      }).chrome;
      await api.storage.local.set({ 'github-token': 'ghp_fixture_token' });
    });

    await use(log);
    void extensionId;
  },
});

export const reviewUrl = (extensionId: string): string =>
  `chrome-extension://${extensionId}/review.html#/pr/${PR.owner}/${PR.repo}/${PR.number}`;

export { expect } from '@playwright/test';
export { HEAD_SHA, BASE_SHA, PR };
