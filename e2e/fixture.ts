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
 *
 * Five more files sit outside that list, each because it is the one thing the
 * fourteen cannot be: an image, a table, an added file, a deleted one, and one
 * whose two hunks do not balance. Nineteen in all, and the counts in the tree
 * and the bar are sums over every one of them.
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

/**
 * In column order: this is the order the diff sends them, which the UI keeps.
 *
 * Every entry has to be a file that opens on the *text* diff, for the same
 * reason `IMAGE_FILE` and `TABLE_FILE` are kept out of this list below: what
 * reads it is counting text files with two hunks each. The two documents under
 * `docs/readme.md` is deliberately one of them, and is the only entry that does
 * not: it opens on the rendered Markdown diff, which makes it a rich card in
 * the middle of the column. That used to cost the cards below it their scroll
 * range — see `lib/review/columnTail.ts` — and it is here now precisely so that
 * a regression in the tail is caught by the browser suite rather than by a
 * reviewer who cannot reach the last file.
 */
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
 * The three files that are not a line-for-line edit.
 *
 * Every entry in `FILES` swaps exactly one line for one line, twice — which
 * made the whole fixture a pull request in which nothing is ever only added and
 * nothing is ever only removed. Four things went untested by that: the tree's
 * `A` and `D` markers, a hunk with no counterpart on the other side, the line
 * numbering when the two sides stop agreeing, and a file that has no base or no
 * head to read at all.
 *
 * Kept out of `FILES` for the same reason the image and the table are: what
 * reads that list is counting text files with two symmetric hunks each, and
 * none of these is one.
 */
export const ADDED_FILE = 'lib/cache.ts';
export const DELETED_FILE = 'lib/memo.ts';
/** Modified, but unevenly: the first hunk only removes, the second only adds. */
export const UNEVEN_FILE = 'lib/trim.ts';

/**
 * One line reindented, one line genuinely changed, in the same run.
 *
 * The case the whitespace rewrite exists for, and until this the fixture had
 * none: every other file here swaps a line for a different line, which is
 * exactly what the rewrite is supposed to leave alone. Without a file it can
 * shorten, "ignore whitespace" could be turned on in a browser and nothing
 * observable would happen.
 *
 * Both kinds of change in one hunk on purpose. It keeps a diff on screen after
 * the rewrite — so the card says what it hid rather than that the whole file
 * was whitespace — and it is the shape that catches a rewrite pairing the
 * wrong two lines, since only one of the two pairs may be merged.
 */
export const REINDENTED_FILE = 'lib/indent.ts';

/**
 * A file nobody wrote, and the one the repository insists is worth reading.
 *
 * Two of them, because folding generated files has two halves and only one is
 * interesting to get right. Any pattern list catches a lockfile; what a
 * reviewer notices is a repository that declared `-linguist-generated` on one
 * of its own and was overruled anyway.
 *
 * `.js` rather than `.json`, in both cases: a `.json` file opens on the
 * structural comparison rather than on a text diff, and the rule under test is
 * about the text diff.
 */
export const GENERATED_FILE = 'dist/bundle.js';
export const EXEMPTED_FILE = 'dist/hand-written.js';

/**
 * The repository's own word on the two above.
 *
 * Served at the head commit from the same contents endpoint the diff expander
 * reads, which is the whole of how this reaches the page — GitHub answers the
 * generated question nowhere else. See `lib/review/generated.ts`.
 */
export const GITATTRIBUTES_TEXT = [
  '# What this repository considers generated.',
  '* text=auto',
  'dist/** linguist-generated',
  `${EXEMPTED_FILE} -linguist-generated`,
  '',
].join('\n');

/** The one file served as real Markdown, so the rendered diff has prose to mark. */
export const MARKDOWN_FILE = 'docs/readme.md';

/**
 * Markdown with something hostile in it, on both sides.
 *
 * A `.md` file in a pull request is written by whoever opened it, and this
 * origin holds a GitHub token. jsdom cannot answer whether the sanitiser holds:
 * it loads no images, so `onerror` never fires, and it runs no script assigned
 * through `innerHTML` — so the obvious assertion passes there whether or not
 * anything is sanitising. A real browser will do both, which is the only place
 * the question can actually be asked.
 */
export const MARKDOWN_TEXT: Record<'base' | 'head', string> = {
  base: [
    '# Review notes',
    '',
    'The parser handles **plain** input.',
    '',
    '<img src=\"x\" onerror=\"globalThis.__pwned = true\">',
    '<script>globalThis.__pwned = true</script>',
    '',
    '[a link](javascript:globalThis.__pwned=true)',
    '',
  ].join('\n'),
  head: [
    '# Review notes',
    '',
    'The parser handles **structured** input.',
    '',
    '<img src=\"x\" onerror=\"globalThis.__pwned = true\">',
    '<script>globalThis.__pwned = true</script>',
    '',
    '[a link](javascript:globalThis.__pwned=true)',
    '',
  ].join('\n'),
};

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

/**
 * A file that did not exist before, as git writes one: no base blob, and
 * `/dev/null` where the old path goes.
 */
const ADDED_PATCH = [
  `diff --git a/${ADDED_FILE} b/${ADDED_FILE}`,
  'new file mode 100644',
  'index 0000000..4444444',
  '--- /dev/null',
  `+++ b/${ADDED_FILE}`,
  '@@ -0,0 +1,4 @@',
  '+const entries = new Map();',
  '+',
  '+export const remember = (key, value) => entries.set(key, value);',
  '+export const recall = (key) => entries.get(key);',
].join('\n');

/** And its opposite: every line removed, and no head blob to read. */
const DELETED_PATCH = [
  `diff --git a/${DELETED_FILE} b/${DELETED_FILE}`,
  'deleted file mode 100644',
  'index 5555555..0000000',
  `--- a/${DELETED_FILE}`,
  '+++ /dev/null',
  '@@ -1,3 +0,0 @@',
  '-const memo = new Map();',
  '-',
  '-export default memo;',
].join('\n');

/**
 * Modified, but not line for line.
 *
 * The first hunk only removes and the second only adds, which is the case every
 * other file in this fixture is missing. From the first hunk onwards the two
 * sides stop agreeing about line numbers — every head line is three below its
 * base counterpart until the second hunk gives two of them back — and
 * everything downstream of that, the gutter, a comment's anchor, the expander's
 * arithmetic, has to be right about it.
 */
const UNEVEN_PATCH = [
  `diff --git a/${UNEVEN_FILE} b/${UNEVEN_FILE}`,
  'index 6666666..7777777 100644',
  `--- a/${UNEVEN_FILE}`,
  `+++ b/${UNEVEN_FILE}`,
  '@@ -1,5 +1,2 @@',
  ' first line',
  `-old alpha of ${UNEVEN_FILE}`,
  `-old beta of ${UNEVEN_FILE}`,
  `-old gamma of ${UNEVEN_FILE}`,
  ' third line',
  '@@ -20,2 +17,4 @@',
  ' line twenty',
  `+new delta of ${UNEVEN_FILE}`,
  `+new epsilon of ${UNEVEN_FILE}`,
  ' line twentyone',
].join('\n');

const REINDENTED_PATCH = [
  `diff --git a/${REINDENTED_FILE} b/${REINDENTED_FILE}`,
  'index 8888888..9999999 100644',
  `--- a/${REINDENTED_FILE}`,
  `+++ b/${REINDENTED_FILE}`,
  '@@ -1,4 +1,4 @@',
  ' first line',
  '-  spaced line',
  `-old body of ${REINDENTED_FILE}`,
  '+    spaced line',
  `+new body of ${REINDENTED_FILE}`,
  ' last line',
].join('\n');

export const UNIFIED_DIFF = [
  ...FILES.map(patchFor),
  patchFor(GENERATED_FILE),
  patchFor(EXEMPTED_FILE),
  // Among the ordinary text files rather than after the odd ones. What follows
  // the two rich cards is what `the last card can still be read` measures its
  // scroll against, and a file appended there moves the ground under it.
  REINDENTED_PATCH,
  IMAGE_PATCH,
  TABLE_PATCH,
  ADDED_PATCH,
  DELETED_PATCH,
  UNEVEN_PATCH,
].join('\n');

/** The unmodified middle of the uneven file, shared by both of its sides. */
const UNEVEN_MIDDLE = Array.from({ length: 14 }, (_, i) => `context line ${i + 6}`);

/**
 * The whole file, consistent with the patch above, for expanding context.
 *
 * The four odd files answer for themselves, because the generic shape below
 * is a 22-line file that differs on two lines — which is true of everything in
 * `FILES` and of none of them. An expander handed the generic text for a file
 * whose two sides are different lengths would splice in lines that are not in
 * it, under hunk headers that still line up: the one failure here that shows no
 * symptom at all.
 *
 * A file that does not exist on one side has no lines on that side, which is
 * what the empty string says.
 */
export const wholeFile = (path: string, side: 'base' | 'head'): string => {
  if (path === ADDED_FILE) {
    return side === 'base'
      ? ''
      : [
          'const entries = new Map();',
          '',
          'export const remember = (key, value) => entries.set(key, value);',
          'export const recall = (key) => entries.get(key);',
        ].join('\n');
  }

  if (path === DELETED_FILE) {
    return side === 'head'
      ? ''
      : ['const memo = new Map();', '', 'export default memo;'].join('\n');
  }

  if (path === REINDENTED_FILE) {
    // Four lines on both sides: the reindent keeps its line, and the changed
    // line replaces its own.
    return [
      'first line',
      side === 'base' ? '  spaced line' : '    spaced line',
      side === 'base' ? `old body of ${path}` : `new body of ${path}`,
      'last line',
    ].join('\n');
  }

  if (path === UNEVEN_FILE) {
    return side === 'base'
      ? [
          'first line',
          `old alpha of ${path}`,
          `old beta of ${path}`,
          `old gamma of ${path}`,
          'third line',
          ...UNEVEN_MIDDLE,
          'line twenty',
          'line twentyone',
          'line twentytwo',
        ].join('\n')
      : [
          'first line',
          'third line',
          ...UNEVEN_MIDDLE,
          'line twenty',
          `new delta of ${path}`,
          `new epsilon of ${path}`,
          'line twentyone',
          'line twentytwo',
        ].join('\n');
  }

  return [
    'first line',
    side === 'base' ? `old ${path}` : `new ${path}`,
    'third line',
    ...Array.from({ length: 16 }, (_, index) => `context line ${index + 4}`),
    'line twenty',
    side === 'base' ? `old tail of ${path}` : `new tail of ${path}`,
    'line twentytwo',
  ].join('\n');
};

const comment = (id: string, body: string) => ({
  id,
  author: { login: 'dana', avatarUrl: 'https://avatars.example/dana' },
  body,
  createdAt: '2026-08-30T09:15:00Z',
  url: `https://github.com/acme/widgets/pull/42#discussion_${id}`,
  // The gate for the Edit and Delete affordances. Left out, the fake GitHub
  // would serve comments the page correctly refuses to offer them on, and the
  // browser would never see the controls at all.
  viewerCanUpdate: true,
  viewerCanDelete: true,
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

/**
 * The GraphQL rows for the three files that are not a one-for-one edit.
 *
 * Counted rather than assumed: these are the numbers the tree draws beside the
 * path and the ones the bar above the column sums, and a fixture that put
 * `+1 −1` on a deleted file would make the page look right while saying
 * something that cannot be true.
 *
 * The image and the table are deliberately still absent from this connection.
 * They are the case where GraphQL listed fewer files than the diff carries, and
 * the page has to fall back to counting the patch itself.
 */
const UNEVEN_ROWS = [
  {
    path: ADDED_FILE,
    additions: 4,
    deletions: 0,
    changeType: 'ADDED',
    viewerViewedState: 'UNVIEWED',
  },
  {
    path: DELETED_FILE,
    additions: 0,
    deletions: 3,
    changeType: 'DELETED',
    viewerViewedState: 'UNVIEWED',
  },
  {
    path: UNEVEN_FILE,
    additions: 2,
    deletions: 3,
    changeType: 'MODIFIED',
    viewerViewedState: 'UNVIEWED',
  },
  {
    path: REINDENTED_FILE,
    additions: 2,
    deletions: 2,
    changeType: 'MODIFIED',
    viewerViewedState: 'UNVIEWED',
  },
  // The generic two-hunk shape, so these two differ from `FILES` in one thing
  // only: what the repository says about them.
  {
    path: GENERATED_FILE,
    additions: 2,
    deletions: 2,
    changeType: 'MODIFIED',
    viewerViewedState: 'UNVIEWED',
  },
  {
    path: EXEMPTED_FILE,
    additions: 2,
    deletions: 2,
    changeType: 'MODIFIED',
    viewerViewedState: 'UNVIEWED',
  },
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
  // A branch in the repository being reviewed, by someone else, seen by an
  // account that may write there. Every test that needs one of the awkward
  // shapes overrides the field that makes it awkward.
  isCrossRepository: false,
  headRepository: { nameWithOwner: 'acme/widgets' },
  repository: { viewerPermission: 'WRITE' },
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
    totalCount: FILES.length + UNEVEN_ROWS.length,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      ...FILES.map((path) => ({
        path,
        additions: 1,
        deletions: 1,
        changeType: 'MODIFIED',
        viewerViewedState: 'UNVIEWED',
      })),
      ...UNEVEN_ROWS,
    ],
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
