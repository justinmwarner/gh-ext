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
  COMMIT_NODES,
  COMPARE_DIFF,
  FIRST_COMMIT_DIFF,
  FIRST_SHA,
  RANGE_DIFF,
  HEAD_SHA,
  IMAGE_BYTES,
  IMAGE_FILE,
  MARKDOWN_FILE,
  MARKDOWN_TEXT,
  PRIOR_SHA,
  POSTED_THREAD,
  PR,
  PULL_REQUEST_NODE,
  TABLE_FILE,
  TABLE_TEXT,
  UNIFIED_DIFF,
  GITATTRIBUTES_TEXT,
  wholeFile,
} from './fixture';
import { GITATTRIBUTES } from '@/ui/useGitAttributes';

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
  /**
   * A permission the token is refused on the pull request query.
   *
   * The one shape of GitHub reply nothing else here produces: `data` and
   * `errors` together, with the refused subtree nulled out. It is not an
   * error the worker can retry or report — the pull request came back, and is
   * correct apart from the part that did not — so the page renders it and says
   * which part it cannot vouch for. Set it before opening the page.
   */
  deniedPath: (string | number)[] | null;
  /**
   * What GitHub says this account may do in the repository.
   *
   * `READ` is the state the page has to be legible in: everything that writes
   * is refused, and the reviewer meets that one control at a time unless the
   * page says so once. Set it before opening the page.
   */
  viewerPermission: string;
  /**
   * What `.gitattributes` says at the head commit, or null for a repository
   * that has none — which is most of them, and is a 404 rather than an error.
   */
  gitAttributes: string | null;
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

    case 'PullRequestReview': {
      const node = {
        ...PULL_REQUEST_NODE,
        repository: { viewerPermission: log.viewerPermission },
      };
      if (log.deniedPath === null) {
        return { data: { repository: { pullRequest: node } } };
      }
      // Both halves, the way GitHub sends them: the node with the refused
      // subtree nulled, and one error naming where it was refused. A fixture
      // that sent only the error would be testing a failure the worker treats
      // as a failed load, which is a different page entirely.
      return {
        data: {
          repository: {
            pullRequest: {
              ...node,
              commits: {
                nodes: [{ commit: { oid: HEAD_SHA, statusCheckRollup: null } }],
              },
            },
          },
        },
        errors: [
          {
            type: 'FORBIDDEN',
            message: 'Resource not accessible by personal access token',
            path: log.deniedPath,
          },
        ],
      };
    }

    case 'PullRequestCommits':
      // `totalCount` matches what is sent, so this fixture is not silently
      // exercising the "GitHub stopped at 250" notice on every test.
      return {
        data: {
          repository: {
            pullRequest: {
              commits: {
                totalCount: COMMIT_NODES.length,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: COMMIT_NODES,
              },
            },
          },
        },
      };

    case 'PullRequestCommitsPage':
      return {
        data: {
          repository: {
            pullRequest: {
              commits: {
                totalCount: COMMIT_NODES.length,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          },
        },
      };

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
              // Not resolvable, and that is the honest answer rather than a
              // hostile fixture. This mutation can only write into a PENDING
              // review, so at the instant it replies the thread is one nobody
              // else can see — and GitHub answers these against the thread as
              // it is, not as it is about to be.
              //
              // The page used to keep this answer after submitting the review,
              // which left a freshly posted comment with a Resolve button that
              // could not be pressed until a reload. A fixture that said `true`
              // here could not have caught it.
              viewerCanResolve: false,
              viewerCanUnresolve: false,
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

    // Asked once a review is submitted, for the threads that were on it. By
    // then they are ordinary threads on the pull request, so the flags the
    // `AddThread` reply gave are out of date and these are the current ones.
    case 'ThreadPermissions': {
      const ids = Array.isArray(variables['ids']) ? variables['ids'] : [];
      return {
        data: {
          nodes: ids.map((id) => ({
            __typename: 'PullRequestReviewThread',
            id,
            isResolved: false,
            viewerCanReply: true,
            viewerCanResolve: true,
            viewerCanUnresolve: false,
          })),
        },
      };
    }

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
  const log: ApiLog = {
    operations: [],
    variables: [],
    urls: [],
    pendingReviewId: null,
    deniedPath: null,
    viewerPermission: 'WRITE',
    gitAttributes: GITATTRIBUTES_TEXT,
  };

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

    // Every narrowing the page offers lands on this endpoint — a single
    // commit, a range, and "changes since my last review" alike — because all
    // three are the same request between two commits. Only three-dot is
    // routed, because only three-dot exists: `/compare/{a}..{b}` answers 404
    // on the real API.
    const compares: Record<string, string> = {
      [`${PRIOR_SHA}...${HEAD_SHA}`]: COMPARE_DIFF,
      [`${BASE_SHA}...${FIRST_SHA}`]: FIRST_COMMIT_DIFF,
      [`${BASE_SHA}...${PRIOR_SHA}`]: RANGE_DIFF,
    };
    const compare = /^\/repos\/[^/]+\/[^/]+\/compare\/(.+)$/.exec(url.pathname);
    if (compare !== null) {
      const body = compares[decodeURIComponent(compare[1] ?? '')];
      if (body === undefined) {
        // A range this fixture did not expect. Refused loudly rather than
        // answered emptily, which would read as "those commits changed
        // nothing" and pass a test that should fail.
        await route.fulfill({ status: 404, body: 'no such comparison' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.github.diff',
        body,
      });
      return;
    }

    const contents = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(url.pathname);
    if (contents !== null) {
      const path = decodeURIComponent(contents[1] ?? '');
      const side = url.searchParams.get('ref') === BASE_SHA ? 'base' : 'head';

      // The repository's own word on which of its files are generated, read
      // from the same endpoint as everything else here. A repository without
      // one is the ordinary case and answers 404, which is a real state rather
      // than a failure — `api.gitAttributes` set to null is how a test asks for
      // it.
      if (path === GITATTRIBUTES) {
        if (log.gitAttributes === null) {
          await route.fulfill({ status: 404, body: 'Not Found' });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: log.gitAttributes,
        });
        return;
      }

      // The two files the rich comparisons are for. Answered as real bytes and
      // real CSV rather than as the generic text every other path gets, because
      // what is being tested is that a PNG survives the worker, the base64
      // encoding, the message channel and the object URL intact.
      if (path === IMAGE_FILE) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(IMAGE_BYTES[side], 'base64'),
        });
        return;
      }
      if (path === TABLE_FILE) {
        await route.fulfill({ status: 200, contentType: 'text/csv', body: TABLE_TEXT[side] });
        return;
      }
      // Real Markdown, including the parts a pull request should not be able to
      // execute here. See `MARKDOWN_TEXT` for why this cannot be asked in jsdom.
      if (path === MARKDOWN_FILE) {
        await route.fulfill({
          status: 200,
          contentType: 'text/markdown',
          body: MARKDOWN_TEXT[side],
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: wholeFile(path, side),
      });
      return;
    }

    await route.abort('failed');
  });

  // github.com itself, for the content script.
  //
  // Deliberately bare. It used to carry a `.gh-header-actions` div because the
  // injector hunted for GitHub's header and wedged a button into it; the card
  // that replaced it owns a fixed corner and anchors to nothing, so a page with
  // no GitHub markup at all is now the honest fixture.
  //
  // Served for *every* github.com path, not only pull requests, because the
  // content script now loads on all of them — which is the fix for a script
  // that was never injected when a pull request was reached by soft navigation.
  await context.route('https://github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<!doctype html><html><head><title>acme/widgets</title></head>' +
        '<body><main id="page">acme/widgets</main></body></html>',
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
      // Off unless something asked for it. Recording every page of a
      // sixty-test run costs real time and writes a directory of `.webm` files
      // nobody looks at; the listing walkthrough in `tour.shot.ts` is the only
      // thing that wants one, and it sets this.
      ...(process.env.TOUR_VIDEO === undefined
        ? {}
        : {
            recordVideo: {
              dir: process.env.TOUR_VIDEO,
              size: { width: 1280, height: 800 },
            },
          }),
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
    // renders the setup state rather than a diff.
    //
    // Seeded into `storage.session`, which is where an *unlocked* vault keeps
    // the decrypted token. Going through the passphrase for every test would
    // buy nothing: what these tests exercise is the review UI, and the vault
    // itself is covered under `lib/`.
    const worker = context.serviceWorkers()[0];
    if (worker === undefined) throw new Error('the extension worker never started');
    // Typed through the global rather than through `@types/chrome`: this runs
    // inside the extension's own worker, where `chrome` exists, and the test
    // process has no reason to take a dependency on the whole API surface.
    await worker.evaluate(async () => {
      const api = (globalThis as unknown as {
        chrome: { storage: { session: { set(items: Record<string, string>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({ 'github-token-unlocked': 'ghp_fixture_token' });
    });

    await use(log);
    void extensionId;
  },
});

export const reviewUrl = (extensionId: string): string =>
  `chrome-extension://${extensionId}/review.html#/pr/${PR.owner}/${PR.repo}/${PR.number}`;

export { expect } from '@playwright/test';
export { HEAD_SHA, BASE_SHA, PRIOR_SHA, FIRST_SHA, PR, IMAGE_FILE, TABLE_FILE };
