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
/**
 * The pull request's first commit.
 *
 * Its parent is the pull request's own base, so scoping to it is the case
 * where the deletions side lines up and the additions side does not — which is
 * the pair every thread on screen is then judged against.
 */
export const FIRST_SHA = 'c'.repeat(40);

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

export const UNIFIED_DIFF = FILES.map(patchFor).join('\n');

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

/**
 * The pull request's history, oldest first, as `PullRequestCommits` returns it.
 *
 * Three commits so a range is a real range and a middle one exists to pick.
 * Each carries its own parent, because that is what makes "just this commit"
 * expressible: the only diff endpoint available compares two commits.
 */
export const COMMITS = [
  { oid: FIRST_SHA, parent: BASE_SHA, headline: 'Add the parser' },
  { oid: PRIOR_SHA, parent: FIRST_SHA, headline: 'Handle renames' },
  { oid: HEAD_SHA, parent: PRIOR_SHA, headline: 'Cache the diff on head SHA' },
] as const;

export const COMMIT_NODES = COMMITS.map((commit) => ({
  commit: {
    oid: commit.oid,
    abbreviatedOid: commit.oid.slice(0, 7),
    messageHeadline: commit.headline,
    committedDate: '2026-08-30T09:15:00Z',
    author: { name: 'Rowan', user: { login: 'rowan' } },
    parents: { nodes: [{ oid: commit.parent }] },
  },
}));

/**
 * What the first commit alone changed: one file, one hunk.
 *
 * Deliberately `src/app.ts`, which carries the anchored thread. On this diff
 * the additions side is numbered against the file as it stood at that commit,
 * not at the head, so line 2 is not the line that thread was written on — and
 * the page has to list the comment rather than draw it there.
 */
export const FIRST_COMMIT_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' first line',
  '-old src/app.ts',
  '+new src/app.ts',
  ' third line',
].join('\n');

/**
 * What the first two commits changed together.
 *
 * Two files, so a range is distinguishable on screen from the single commit
 * above it rather than only in the URL. The base is the *parent* of the first
 * selection, which here is the pull request's own base — which is why the two
 * assertions about which side lines up differ between this and the diff above.
 */
export const RANGE_DIFF = [
  FIRST_COMMIT_DIFF,
  'diff --git a/src/beta.ts b/src/beta.ts',
  'index 1111111..2222222 100644',
  '--- a/src/beta.ts',
  '+++ b/src/beta.ts',
  '@@ -1,3 +1,3 @@',
  ' first line',
  '-old src/beta.ts',
  '+new src/beta.ts',
  ' third line',
].join('\n');

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
