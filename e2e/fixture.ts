/**
 * One pull request, invented, and every GitHub response that describes it.
 *
 * Nothing here talks to github.com. The extension's background worker is the
 * only thing in the extension that fetches, and every request it makes is
 * intercepted and answered from this file — so the browser test exercises the
 * real worker, the real message channel and the real review page against a
 * pull request whose exact shape is known.
 *
 * The shape is chosen to reach the interesting paths: fourteen files so the
 * column has to scroll and the tree has directories, two hunks per file so a
 * comment can sit in collapsed context, and five threads covering anchored,
 * out-of-hunk, outdated, file-level and resolved.
 */

export const PR = { owner: 'acme', repo: 'widgets', number: 42 } as const;
export const HEAD_SHA = 'f'.repeat(40);
export const BASE_SHA = 'a'.repeat(40);
/**
 * The commit the viewer's own last review was left on.
 *
 * Distinct from both of the above: "changes since my last review" compares
 * two commits that are each somewhere in the middle of the pull request.
 */
export const PRIOR_SHA = 'b'.repeat(40);

/** In column order: this is the order the diff sends them, which the UI keeps. */
export const FILES = [
  'src/app.ts',
  'src/beta.ts',
  'src/gamma.ts',
  'src/delta.ts',
  'src/epsilon.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/components/Modal.tsx',
  'lib/parse.ts',
  'lib/format.ts',
  'lib/util/clamp.ts',
  'lib/util/debounce.ts',
  'docs/readme.md',
  'docs/changelog.md',
] as const;

/**
 * Two hunks with a sixteen-line gap between them.
 *
 * The gap is the point: lines 4-19 exist in the file and are not drawn, so a
 * comment on one of them is a comment the renderer would silently discard.
 */
const patchFor = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,3 @@',
    ' first line',
    `-old ${path}`,
    `+new ${path}`,
    ' third line',
    '@@ -20,3 +20,3 @@',
    ' line twenty',
    `-old tail of ${path}`,
    `+new tail of ${path}`,
    ' line twentytwo',
  ].join('\n');

/**
 * The two files that exist to be compared as something other than text.
 *
 * Kept out of `FILES` because everything that reads that list — the tree
 * assertions, the hunk counts, the thread anchors — is counting text files
 * with two hunks each, and none of that is true of these.
 */
export const IMAGE_FILE = 'assets/logo.png';
export const TABLE_FILE = 'data/rows.csv';

/**
 * Two eight-by-eight PNGs, generated rather than borrowed.
 *
 * Both are solid red; the head one has a blue square in its top-left quarter.
 * That is enough for the difference blend to have something to show and for
 * the swipe to have somewhere for the seam to matter, and small enough that
 * the whole fixture stays readable.
 */
export const IMAGE_BYTES: Record<'base' | 'head', string> = {
  base:
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO4o6GBFTEMLQkA' +
    'e3tLAYZNzu4AAAAASUVORK5CYII=',
  head:
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAGklEQVR42mPQCLgDR3c0NOCI' +
    'gYoSyBwaSQAA6wpNgeu19H0AAAAASUVORK5CYII=',
};

/** One cell edited, so exactly one cell of the grid should light up. */
export const TABLE_TEXT: Record<'base' | 'head', string> = {
  base: 'part,qty,price\nbolt,4,1.20\nnut,9,0.30\n',
  head: 'part,qty,price\nbolt,5,1.20\nnut,9,0.30\n',
};

/**
 * A binary patch, as git writes one: a header, no hunks, and a line saying the
 * two blobs differ. Which is the whole of what a text diff has to say about a
 * PNG, and the reason the image modes exist.
 */
const IMAGE_PATCH = [
  `diff --git a/${IMAGE_FILE} b/${IMAGE_FILE}`,
  'index 1111111..2222222 100644',
  `Binary files a/${IMAGE_FILE} and b/${IMAGE_FILE} differ`,
].join('\n');

const TABLE_PATCH = [
  `diff --git a/${TABLE_FILE} b/${TABLE_FILE}`,
  'index 1111111..2222222 100644',
  `--- a/${TABLE_FILE}`,
  `+++ b/${TABLE_FILE}`,
  '@@ -1,3 +1,3 @@',
  ' part,qty,price',
  '-bolt,4,1.20',
  '+bolt,5,1.20',
  ' nut,9,0.30',
].join('\n');

export const UNIFIED_DIFF = [
  ...FILES.map(patchFor),
  IMAGE_PATCH,
  TABLE_PATCH,
].join('\n');

/** The whole file, consistent with the patch above, for expanding context. */
export const wholeFile = (path: string, side: 'base' | 'head'): string =>
  [
    'first line',
    side === 'base' ? `old ${path}` : `new ${path}`,
    'third line',
    ...Array.from({ length: 16 }, (_, index) => `context line ${index + 4}`),
    'line twenty',
    side === 'base' ? `old tail of ${path}` : `new tail of ${path}`,
    'line twentytwo',
  ].join('\n');

const comment = (id: string, body: string) => ({
  id,
  author: { login: 'dana', avatarUrl: 'https://avatars.example/dana' },
  body,
  createdAt: '2026-08-30T09:15:00Z',
  url: `https://github.com/acme/widgets/pull/42#discussion_${id}`,
});

const thread = (over: Record<string, unknown>) => ({
  id: 'PRRT_0',
  isResolved: false,
  isOutdated: false,
  isCollapsed: false,
  path: 'src/app.ts',
  line: 2,
  startLine: 2,
  originalLine: 2,
  originalStartLine: null,
  diffSide: 'RIGHT',
  startDiffSide: null,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: true,
  viewerCanUnresolve: true,
  resolvedBy: null,
  comments: { totalCount: 1, nodes: [comment('c0', 'A comment.')] },
  ...over,
});

export const THREADS = [
  thread({
    id: 'PRRT_anchored',
    path: 'src/app.ts',
    line: 2,
    startLine: 2,
    originalLine: 2,
    comments: {
      totalCount: 1,
      nodes: [comment('c1', 'This allocates on every call.')],
    },
  }),
  thread({
    // In the 4-19 gap. Pierre draws no row for it, so the column has to list it.
    id: 'PRRT_outofhunk',
    path: 'src/beta.ts',
    line: 10,
    startLine: 10,
    originalLine: 10,
    comments: { totalCount: 1, nodes: [comment('c2', 'Out of hunk comment.')] },
  }),
  thread({
    // Force-pushed away from under. GitHub nulls `line` and keeps `originalLine`.
    id: 'PRRT_outdated',
    path: 'src/gamma.ts',
    line: null,
    startLine: null,
    originalLine: 5,
    originalStartLine: null,
    isOutdated: true,
    comments: { totalCount: 1, nodes: [comment('c3', 'Outdated comment.')] },
  }),
  thread({
    id: 'PRRT_filelevel',
    path: 'src/delta.ts',
    line: null,
    startLine: null,
    originalLine: null,
    subjectType: 'FILE',
    comments: { totalCount: 1, nodes: [comment('c4', 'File level comment.')] },
  }),
  thread({
    id: 'PRRT_resolved',
    path: 'src/app.ts',
    line: 3,
    startLine: 3,
    originalLine: 3,
    isResolved: true,
    resolvedBy: { login: 'kim' },
    comments: { totalCount: 1, nodes: [comment('c5', 'Already resolved.')] },
  }),
];

export const PULL_REQUEST_NODE = {
  id: 'PR_kwDOABCD',
  number: PR.number,
  title: 'Cache the diff on head SHA',
  bodyHTML: '<p>Caches the diff on <code>headRefOid</code>.</p>',
  state: 'OPEN',
  isDraft: false,
  merged: false,
  baseRefName: 'main',
  headRefName: 'cache-the-diff',
  baseRefOid: BASE_SHA,
  headRefOid: HEAD_SHA,
  permalink: 'https://github.com/acme/widgets/pull/42',
  author: { login: 'rowan', avatarUrl: 'https://avatars.example/rowan' },
  viewerDidAuthor: false,
  reviewDecision: 'REVIEW_REQUIRED',
  viewerLatestReview: { commit: { oid: PRIOR_SHA } },
  latestReviews: {
    nodes: [
      {
        author: { login: 'dana', avatarUrl: 'https://avatars.example/dana' },
        state: 'APPROVED',
        commit: { oid: HEAD_SHA },
      },
    ],
  },
  reviewRequests: {
    nodes: [
      {
        requestedReviewer: {
          __typename: 'Team',
          name: 'Platform Infra',
          slug: 'platform-infra',
        },
      },
    ],
  },
  commits: {
    nodes: [
      {
        commit: {
          oid: HEAD_SHA,
          statusCheckRollup: {
            state: 'SUCCESS',
            contexts: {
              totalCount: 1,
              nodes: [
                {
                  __typename: 'CheckRun',
                  name: 'build',
                  conclusion: 'SUCCESS',
                  status: 'COMPLETED',
                  detailsUrl: 'https://github.com/acme/widgets/actions/runs/1',
                  checkSuite: { app: { name: 'GitHub Actions' } },
                },
              ],
            },
          },
        },
      },
    ],
  },
  files: {
    totalCount: FILES.length,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: FILES.map((path) => ({
      path,
      additions: 1,
      deletions: 1,
      changeType: 'MODIFIED',
      viewerViewedState: 'UNVIEWED',
    })),
  },
  reviewThreads: {
    totalCount: THREADS.length,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: THREADS,
  },
};

/** The thread `AddThread` invents, so a posted comment appears on the page. */
export const POSTED_THREAD = thread({
  id: 'PRRT_posted',
  path: 'src/app.ts',
  line: 2,
  startLine: 2,
  originalLine: 2,
  comments: {
    totalCount: 1,
    nodes: [comment('c-posted', 'Posted from the browser test.')],
  },
});


/**
 * What landed since that review: one file, and only its first hunk.
 *
 * Narrower than `UNIFIED_DIFF` on purpose. `src/beta.ts` line 10 is outside
 * every hunk here just as it is in the full diff, so a thread anchored there
 * has to be *listed* rather than drawn — which is exactly the verdict that
 * goes stale when the reviewer expanded context before toggling.
 */
export const COMPARE_DIFF = [
  'diff --git a/src/beta.ts b/src/beta.ts',
  'index 2222222..3333333 100644',
  '--- a/src/beta.ts',
  '+++ b/src/beta.ts',
  '@@ -1,3 +1,3 @@',
  ' first line',
  '-old src/beta.ts',
  '+new src/beta.ts',
  ' third line',
].join('\n');
