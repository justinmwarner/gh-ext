# Fast GitHub Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension that injects a "Fast review" button on GitHub PR pages and opens a standalone, fast review SPA supporting comments/reply/resolve, the pending-review flow, status checks, and approve/request-changes.

**Architecture:** Three MV3 contexts — a thin content script that injects the button, a background service worker that owns *all* network traffic plus the cache and prefetch, and a full-page React SPA at `review.html`. Domain logic lives in `lib/`, which never touches the DOM or `chrome.*` and is tested without a browser.

**Tech Stack:** WXT 0.21.4, React 19, TypeScript, `@pierre/diffs` 1.3.6, `@pierre/trees` 1.0.0-beta.6, Vitest, Playwright.

---

## Required reading before any task

These four documents were produced by reading real source, published tarballs, and the live GitHub schema. **They supersede your recollection of these APIs.** Read the relevant one before touching a task that uses it.

| Document | Covers |
|---|---|
| `docs/reference/github-review-api.md` | Verified GraphQL query, all enums, every mutation input shape, four behaviours that break naive code |
| `docs/reference/pierre-diffs-api.md` | Annotation framework, line selection, virtualization, `loadDiffFiles` |
| `docs/reference/pierre-trees-api.md` | `FileTree` model, selection events, row decoration ceiling |
| `docs/reference/wxt-setup.md` | Entrypoint conventions, manifest generation, CSP, worker constraints |
| `docs/superpowers/specs/2026-09-01-github-fast-review-extension-design.md` §16 | Amendments that invalidate parts of §1-15 |

**Five facts that will cost you hours if you forget them:**

1. A review thread's `line` is `null` whenever `isOutdated` is true. Type it `number | null`.
2. `startLine` **equals** `line` on single-line threads — it is not null. Detect multi-line with `startLine !== line`.
3. Pierre annotations anchor to exactly one line. Ranges are not representable.
4. An annotation on a line outside a rendered hunk is dropped **silently**.
5. Never set `preferredHighlighter: 'shiki-wasm'` — it works in dev and dies in production.
6. `.wxt/tsconfig.json` enables **`noUncheckedIndexedAccess`**, and it typechecks test files too. `const [first] = arr` is `T | undefined`, so property access on it is a compile error. Assert with `expect(arr[0]).toMatchObject({...})` rather than scattering `!` assertions.

**Known parser limitations** (found during Task 5, deliberately not fixed):
`core.quotepath` octal-escaped paths such as `"a/na\303\257ve.ts"` are not decoded, so a non-ASCII path will not join against the GraphQL `PullRequestFile` list. Combined merge diffs (`diff --cc`) are unrecognized. Neither is reachable through GitHub's PR diff endpoint today.

---

## File structure

```
wxt.config.ts               # manifest, permissions, React module
entrypoints/
  background.ts             # message router, cache, prefetch, tab opening
  content.ts                # button injection + prefetch ping
  review/index.html         # unlisted page -> review.html
  review/main.tsx
  options/index.html
  options/main.tsx
lib/
  github/
    types.ts                # types mirroring the verified schema
    diff.ts                 # unified diff -> per-file patches
    queries.ts              # GraphQL documents
    mutations.ts
    client.ts               # transport, token, rate limits
  review/
    threads.ts              # thread -> annotation anchoring
    selection.ts            # Pierre range -> GitHub payload
    pending-review.ts       # Browse/Pending state machine
    drafts.ts
    filters.ts
    viewed.ts
  keymap.ts
  messages.ts               # typed background <-> page protocol
ui/
  Shell.tsx  Header.tsx  Sidebar.tsx  Overview.tsx
  FileTree.tsx  DiffFile.tsx  Thread.tsx  Composer.tsx  SubmitReview.tsx
```

Everything under `lib/` is pure: no DOM, no `chrome.*`, no network. That is what makes Phase 1 testable in isolation and is the single most important boundary in this plan.

---

# Phase 0 — Foundation

### Task 1: Scaffold the WXT project

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `entrypoints/background.ts`

- [ ] **Step 1: Scaffold**

Run in `E:\source\gh-ext`. The directory already contains `docs/` and `.git`, so scaffold into a temp dir and move the files in:

```bash
npx wxt@0.21.4 init .wxt-scaffold -t react --pm npm
cp -r .wxt-scaffold/{package.json,tsconfig.json,wxt.config.ts,entrypoints,public} . 2>/dev/null || true
rm -rf .wxt-scaffold
```

- [ ] **Step 2: Pin dependencies exactly**

Both Pierre packages are pinned with no range. `@pierre/trees` is a beta, and the tree re-render mechanism is inferred from source rather than documented.

```bash
npm pkg set dependencies.react="^19.2.0"
npm pkg set dependencies.react-dom="^19.2.0"
npm pkg set dependencies["@pierre/diffs"]="1.3.6"
npm pkg set dependencies["@pierre/trees"]="1.0.0-beta.6"
npm pkg set devDependencies.wxt="0.21.4"
npm pkg set devDependencies["@wxt-dev/module-react"]="1.2.2"
npm pkg set devDependencies.vite="^8.0.0"
npm pkg set devDependencies.vitest="^3.0.0"
npm pkg set devDependencies.typescript="^5.7.0"
npm install
```

`vite` is a required peer dependency in WXT 0.21 — it is not installed for you.

- [ ] **Step 3: Verify the toolchain**

```bash
node -v          # must be >= 22
npx wxt --help   # NOT `wxt dev` — that parses as a root dir named ./dev and fails
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Scaffold WXT + React extension project"
```

---

### Task 2: Configure the manifest

**Files:**
- Modify: `wxt.config.ts`

- [ ] **Step 1: Write the config**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Fast GitHub Review',
    description: 'A fast review UI for GitHub pull requests.',
    permissions: ['storage', 'tabs'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  },
});
```

Deliberately absent: `web_accessible_resources`. The content script never navigates to `review.html` itself — it messages the background worker, which calls `chrome.tabs.update`. Listing the page would let github.com fingerprint the extension.

Also deliberately absent: `content_security_policy`. We never load WebAssembly, because the default Shiki engine is the JavaScript regex engine. If a future change needs WASM, the key must be added by hand — production builds emit no CSP key at all, so WASM would work in dev and fail silently in prod.

- [ ] **Step 2: Verify the generated manifest**

```bash
npx wxt build
cat .output/chrome-mv3/manifest.json
```

Expected: `manifest_version: 3`, the two host permissions, and **no** `web_accessible_resources` key.

- [ ] **Step 3: Commit**

```bash
git add wxt.config.ts && git commit -m "Configure MV3 manifest"
```

---

### Task 3: Wire Vitest

**Files:**
- Create: `vitest.config.ts`, `lib/keymap.ts`, `lib/keymap.test.ts`

- [ ] **Step 1: Write the config**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
});
```

`lib/` is pure, so the default `node` environment is correct and fast. UI tests, when added later, get their own config with a DOM environment.

- [ ] **Step 2: Write the failing test**

`lib/keymap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveMod } from './keymap';

describe('resolveMod', () => {
  it('uses Ctrl off macOS', () => {
    expect(resolveMod('Win32')).toBe('Ctrl');
    expect(resolveMod('Linux x86_64')).toBe('Ctrl');
  });

  it('uses Meta on macOS', () => {
    expect(resolveMod('MacIntel')).toBe('Meta');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run lib/keymap.test.ts
```

Expected: FAIL — `resolveMod` is not exported.

- [ ] **Step 4: Implement**

`lib/keymap.ts`:

```ts
export type ModKey = 'Ctrl' | 'Meta';

/** Platform string is injected rather than read from navigator so this stays pure. */
export function resolveMod(platform: string): ModKey {
  return /^Mac/i.test(platform) ? 'Meta' : 'Ctrl';
}
```

- [ ] **Step 5: Run it and confirm it passes**

```bash
npx vitest run lib/keymap.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts lib/keymap.ts lib/keymap.test.ts
git commit -m "Wire Vitest and add platform-aware modifier resolution"
```

---

# Phase 1 — Pure domain logic

No DOM, no `chrome.*`, no network. Strict TDD: the test comes first and must be seen to fail.

### Task 4: GitHub domain types

**Files:**
- Create: `lib/github/types.ts`

- [ ] **Step 1: Write the types**

Every enum below is copied from `docs/reference/github-review-api.md` §2, which was introspected from the live schema. Do not add or remove members.

```ts
export type DiffSide = 'LEFT' | 'RIGHT';
export type ThreadSubjectType = 'LINE' | 'FILE';
export type FileViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';
export type PatchStatus =
  | 'ADDED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'MODIFIED' | 'CHANGED';
export type ReviewState =
  | 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' | 'DISMISS';

export interface ReviewComment {
  id: string;
  author: { login: string; avatarUrl: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  /** null whenever isOutdated is true. Never assume a number. */
  line: number | null;
  /** Equals `line` for single-line threads — it is NOT null. */
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: DiffSide;
  /** null for single-line threads. */
  startDiffSide: DiffSide | null;
  subjectType: ThreadSubjectType;
  viewerCanReply: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: ReviewComment[];
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewerViewedState: FileViewedState;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/github/types.ts && git commit -m "Add GitHub domain types from verified schema"
```

---

### Task 5: Unified diff parser

Splits the single unified diff returned by the REST diff endpoint into per-file patches. Pierre consumes patch text directly, so we keep the raw text per file rather than parsing hunks into a structure.

**Files:**
- Create: `lib/github/diff.ts`, `lib/github/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
diff --git a/logo.png b/logo.png
index 3333333..4444444 100644
Binary files a/logo.png and b/logo.png differ
`;

describe('parseUnifiedDiff', () => {
  it('splits into one entry per file', () => {
    expect(parseUnifiedDiff(SAMPLE)).toHaveLength(3);
  });

  it('captures the path and patch text of a modified file', () => {
    const [first] = parseUnifiedDiff(SAMPLE);
    expect(first.path).toBe('src/a.ts');
    expect(first.oldPath).toBe('src/a.ts');
    expect(first.isBinary).toBe(false);
    expect(first.patch).toContain('@@ -1,3 +1,3 @@');
    expect(first.patch).toContain('+const y = 3;');
  });

  it('detects renames and reports both paths', () => {
    const renamed = parseUnifiedDiff(SAMPLE)[1];
    expect(renamed.oldPath).toBe('old.ts');
    expect(renamed.path).toBe('new.ts');
    expect(renamed.isRename).toBe(true);
  });

  it('flags binary files, which have no usable patch', () => {
    const binary = parseUnifiedDiff(SAMPLE)[2];
    expect(binary.path).toBe('logo.png');
    expect(binary.isBinary).toBe(true);
  });

  it('returns an empty array for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/github/diff.test.ts
```

Expected: FAIL — `parseUnifiedDiff` is not exported.

- [ ] **Step 3: Implement**

```ts
export interface ParsedDiffFile {
  /** Path in the head commit. For a delete, the path that was removed. */
  path: string;
  /** Path in the base commit. Differs from `path` only for renames and copies. */
  oldPath: string;
  isBinary: boolean;
  isRename: boolean;
  /** Raw unified-diff text for this file, header included. */
  patch: string;
}

const FILE_HEADER = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/;

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  if (diff.trim() === '') return [];

  const lines = diff.split('\n');
  const files: ParsedDiffFile[] = [];
  let current: string[] | null = null;

  const flush = () => {
    if (current) files.push(toFile(current));
    current = null;
  };

  for (const line of lines) {
    if (FILE_HEADER.test(line)) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  flush();

  return files;
}

function toFile(block: string[]): ParsedDiffFile {
  const patch = block.join('\n');
  const header = block[0].match(FILE_HEADER);

  let oldPath = header?.[1] ?? '';
  let path = header?.[2] ?? '';
  let isRename = false;

  for (const line of block) {
    if (line.startsWith('rename from ')) {
      oldPath = line.slice('rename from '.length);
      isRename = true;
    } else if (line.startsWith('rename to ')) {
      path = line.slice('rename to '.length);
      isRename = true;
    }
  }

  return {
    path,
    oldPath,
    isRename,
    isBinary: block.some((l) => l.startsWith('Binary files ')),
    patch,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run lib/github/diff.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/github/diff.ts lib/github/diff.test.ts
git commit -m "Add unified diff parser"
```

---

### Task 6: Thread anchoring

The most defect-prone module in the project. It converts a GitHub review thread into either a Pierre annotation anchor or an explicit "cannot be anchored" result. **Every unanchorable thread must still be rendered somewhere**, because Pierre drops out-of-range annotations silently — a lost anchor means a lost comment.

**Files:**
- Create: `lib/review/threads.ts`, `lib/review/threads.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { ReviewThread } from '../github/types';
import { anchorThread, isMultiLine } from './threads';

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 't1', isResolved: false, isOutdated: false,
    path: 'src/a.ts', line: 10, startLine: 10,
    originalLine: 10, originalStartLine: null,
    diffSide: 'RIGHT', startDiffSide: null, subjectType: 'LINE',
    viewerCanReply: true, viewerCanResolve: true, viewerCanUnresolve: true,
    comments: [], ...over,
  };
}

describe('anchorThread', () => {
  it('anchors a RIGHT-side thread to the additions side', () => {
    expect(anchorThread(thread())).toEqual({
      kind: 'anchored', side: 'additions', lineNumber: 10,
    });
  });

  it('anchors a LEFT-side thread to the deletions side', () => {
    expect(anchorThread(thread({ diffSide: 'LEFT' }))).toEqual({
      kind: 'anchored', side: 'deletions', lineNumber: 10,
    });
  });

  it('anchors a multi-line thread to its END line', () => {
    // Pierre cannot express ranges, so the end line is the anchor.
    const t = thread({ startLine: 5, line: 9, startDiffSide: 'RIGHT' });
    expect(anchorThread(t)).toEqual({
      kind: 'anchored', side: 'additions', lineNumber: 9,
    });
  });

  it('refuses to anchor an outdated thread, whose line is null', () => {
    const t = thread({ isOutdated: true, line: null, startLine: null, originalLine: 194 });
    expect(anchorThread(t)).toEqual({ kind: 'unanchorable', reason: 'outdated' });
  });

  it('refuses to anchor a file-level thread', () => {
    expect(anchorThread(thread({ subjectType: 'FILE' }))).toEqual({
      kind: 'unanchorable', reason: 'file-level',
    });
  });

  it('refuses to anchor a null line even when not flagged outdated', () => {
    expect(anchorThread(thread({ line: null }))).toEqual({
      kind: 'unanchorable', reason: 'no-line',
    });
  });
});

describe('isMultiLine', () => {
  it('is false when startLine equals line', () => {
    // The trap: startLine is NOT null for single-line threads.
    expect(isMultiLine(thread({ startLine: 10, line: 10 }))).toBe(false);
  });

  it('is true when startLine differs from line', () => {
    expect(isMultiLine(thread({ startLine: 5, line: 9 }))).toBe(true);
  });

  it('is false when either endpoint is null', () => {
    expect(isMultiLine(thread({ startLine: null, line: null }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/review/threads.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { ReviewThread } from '../github/types';

export type AnnotationSide = 'deletions' | 'additions';

export type ThreadAnchor =
  | { kind: 'anchored'; side: AnnotationSide; lineNumber: number }
  | { kind: 'unanchorable'; reason: 'outdated' | 'file-level' | 'no-line' };

/**
 * A thread is multi-line only when its endpoints differ. GitHub sets
 * `startLine === line` for single-line threads rather than leaving it null,
 * so a null check here would classify every thread as multi-line.
 */
export function isMultiLine(t: ReviewThread): boolean {
  return t.startLine != null && t.line != null && t.startLine !== t.line;
}

/**
 * Pierre annotations carry exactly one line number, so a multi-line thread
 * anchors to its end line and the range travels in annotation metadata.
 *
 * Callers MUST render `unanchorable` threads in a per-file section. Pierre
 * discards annotations outside rendered hunks without warning, so a thread that
 * is neither anchored nor listed is simply invisible.
 */
export function anchorThread(t: ReviewThread): ThreadAnchor {
  if (t.subjectType === 'FILE') {
    return { kind: 'unanchorable', reason: 'file-level' };
  }
  if (t.line == null) {
    return { kind: 'unanchorable', reason: t.isOutdated ? 'outdated' : 'no-line' };
  }
  return {
    kind: 'anchored',
    side: t.diffSide === 'LEFT' ? 'deletions' : 'additions',
    lineNumber: t.line,
  };
}

/** Splits threads for one file into those Pierre can render inline and those it cannot. */
export function partitionThreads(threads: ReviewThread[]): {
  anchored: Array<{ thread: ReviewThread; anchor: Extract<ThreadAnchor, { kind: 'anchored' }> }>;
  unanchorable: ReviewThread[];
} {
  // Explicit types: an empty literal would infer as never[] and fail to compile.
  const anchored: Array<{
    thread: ReviewThread;
    anchor: Extract<ThreadAnchor, { kind: 'anchored' }>;
  }> = [];
  const unanchorable: ReviewThread[] = [];
  for (const thread of threads) {
    const anchor = anchorThread(thread);
    if (anchor.kind === 'anchored') anchored.push({ thread, anchor });
    else unanchorable.push(thread);
  }
  return { anchored, unanchorable };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run lib/review/threads.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/review/threads.ts lib/review/threads.test.ts
git commit -m "Add thread anchoring with explicit unanchorable handling"
```

---

### Task 7: Selection normalization

Converts Pierre's `SelectedLineRange` into a GitHub comment payload. Pierre preserves drag direction and can express cross-side ranges that GitHub cannot represent, so this is a narrowing conversion that must be able to fail.

**Files:**
- Create: `lib/review/selection.ts`, `lib/review/selection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeSelection } from './selection';

describe('normalizeSelection', () => {
  it('converts a single-line selection, omitting the start fields', () => {
    expect(normalizeSelection({ start: 12, end: 12, side: 'additions' })).toEqual({
      ok: true, value: { line: 12, side: 'RIGHT' },
    });
  });

  it('converts a multi-line selection', () => {
    expect(normalizeSelection({ start: 5, end: 9, side: 'additions' })).toEqual({
      ok: true, value: { line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });
  });

  it('swaps endpoints when the user dragged upward', () => {
    // Pierre preserves drag direction, so start can exceed end.
    expect(normalizeSelection({ start: 9, end: 5, side: 'additions' })).toEqual({
      ok: true, value: { line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });
  });

  it('maps the deletions side to LEFT', () => {
    expect(normalizeSelection({ start: 3, end: 3, side: 'deletions' })).toEqual({
      ok: true, value: { line: 3, side: 'LEFT' },
    });
  });

  it('treats an omitted endSide as equal to side', () => {
    const r = normalizeSelection({ start: 1, end: 4, side: 'additions', endSide: undefined });
    expect(r.ok).toBe(true);
  });

  it('rejects a cross-side range, which GitHub cannot represent', () => {
    const r = normalizeSelection({
      start: 1, end: 4, side: 'deletions', endSide: 'additions',
    });
    expect(r).toEqual({ ok: false, reason: 'cross-side' });
  });

  it('defaults a missing side to additions', () => {
    expect(normalizeSelection({ start: 2, end: 2 })).toEqual({
      ok: true, value: { line: 2, side: 'RIGHT' },
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/review/selection.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { DiffSide } from '../github/types';
import type { AnnotationSide } from './threads';

/** Mirrors Pierre's SelectedLineRange. See docs/reference/pierre-diffs-api.md section C. */
export interface SelectedLineRange {
  start: number;
  end: number;
  side?: AnnotationSide;
  endSide?: AnnotationSide;
}

export interface CommentAnchor {
  line: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
}

export type NormalizeResult =
  | { ok: true; value: CommentAnchor }
  | { ok: false; reason: 'cross-side' };

const toDiffSide = (s: AnnotationSide): DiffSide =>
  s === 'deletions' ? 'LEFT' : 'RIGHT';

export function normalizeSelection(range: SelectedLineRange): NormalizeResult {
  const side = range.side ?? 'additions';
  const endSide = range.endSide ?? side;

  // GitHub has no representation for a range spanning both diff sides.
  if (side !== endSide) return { ok: false, reason: 'cross-side' };

  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const ghSide = toDiffSide(side);

  if (lo === hi) return { ok: true, value: { line: hi, side: ghSide } };

  return {
    ok: true,
    value: { line: hi, side: ghSide, startLine: lo, startSide: ghSide },
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run lib/review/selection.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/review/selection.ts lib/review/selection.test.ts
git commit -m "Add selection normalization with cross-side rejection"
```

---

### Task 8: Pending review state machine

**Files:**
- Create: `lib/review/pending-review.ts`, `lib/review/pending-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { commentTarget, initialState, reduce } from './pending-review';

describe('pending review state machine', () => {
  it('starts in browse', () => {
    expect(initialState()).toEqual({ kind: 'browse' });
  });

  it('targets the pull request when browsing', () => {
    expect(commentTarget({ kind: 'browse' }, 'PR_1')).toEqual({ pullRequestId: 'PR_1' });
  });

  it('targets the review once one is pending', () => {
    const s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    expect(commentTarget(s, 'PR_1')).toEqual({ pullRequestReviewId: 'R_1' });
  });

  it('counts comments added to a pending review', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    s = reduce(s, { type: 'comment-added' });
    expect(s).toEqual({ kind: 'pending', reviewId: 'R_1', commentCount: 2 });
  });

  it('ignores comment-added while browsing', () => {
    expect(reduce({ kind: 'browse' }, { type: 'comment-added' })).toEqual({ kind: 'browse' });
  });

  it('returns to browse after submitting', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    expect(reduce(s, { type: 'submitted' })).toEqual({ kind: 'browse' });
  });

  it('returns to browse after discarding', () => {
    const s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    expect(reduce(s, { type: 'discarded' })).toEqual({ kind: 'browse' });
  });

  it('ignores a second review-started', () => {
    let s = reduce(initialState(), { type: 'review-started', reviewId: 'R_1' });
    s = reduce(s, { type: 'comment-added' });
    expect(reduce(s, { type: 'review-started', reviewId: 'R_2' })).toEqual(s);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/review/pending-review.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type PendingReviewState =
  | { kind: 'browse' }
  | { kind: 'pending'; reviewId: string; commentCount: number };

export type PendingReviewAction =
  | { type: 'review-started'; reviewId: string }
  | { type: 'comment-added' }
  | { type: 'submitted' }
  | { type: 'discarded' };

export const initialState = (): PendingReviewState => ({ kind: 'browse' });

export function reduce(
  state: PendingReviewState,
  action: PendingReviewAction
): PendingReviewState {
  switch (action.type) {
    case 'review-started':
      // A pending review already exists; starting another would orphan it.
      return state.kind === 'pending'
        ? state
        : { kind: 'pending', reviewId: action.reviewId, commentCount: 0 };
    case 'comment-added':
      return state.kind === 'pending'
        ? { ...state, commentCount: state.commentCount + 1 }
        : state;
    case 'submitted':
    case 'discarded':
      return { kind: 'browse' };
  }
}

/**
 * addPullRequestReviewThread takes either a pullRequestId (standalone comment)
 * or a pullRequestReviewId (attached to a pending review), never both.
 */
export function commentTarget(
  state: PendingReviewState,
  pullRequestId: string
): { pullRequestId: string } | { pullRequestReviewId: string } {
  return state.kind === 'pending'
    ? { pullRequestReviewId: state.reviewId }
    : { pullRequestId };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run lib/review/pending-review.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/review/pending-review.ts lib/review/pending-review.test.ts
git commit -m "Add pending review state machine"
```

---

### Task 9: Noise filters

**Files:**
- Create: `lib/review/filters.ts`, `lib/review/filters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_NOISE_PATTERNS, isNoise } from './filters';

describe('isNoise', () => {
  const noisy = [
    'package-lock.json', 'pnpm-lock.yaml', 'go.sum', 'yarn.lock',
    'Cargo.lock', 'vendor/foo/bar.go', 'dist/bundle.js',
    'node_modules/x/index.js', 'src/generated/api.ts',
  ];
  const signal = ['src/app.ts', 'README.md', 'lib/lockfile-utils.ts', 'src/distance.ts'];

  it.each(noisy)('treats %s as noise', (p) => {
    expect(isNoise(p, DEFAULT_NOISE_PATTERNS)).toBe(true);
  });

  it.each(signal)('treats %s as signal', (p) => {
    expect(isNoise(p, DEFAULT_NOISE_PATTERNS)).toBe(false);
  });

  it('supports a caller-supplied pattern', () => {
    expect(isNoise('snapshots/a.snap', ['**/*.snap'])).toBe(true);
  });

  it('treats an empty pattern list as matching nothing', () => {
    expect(isNoise('package-lock.json', [])).toBe(false);
  });
});
```

Note `lib/lockfile-utils.ts` and `src/distance.ts` — these guard against a `dist` or `lock` substring match, which is the obvious wrong implementation.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/review/filters.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export const DEFAULT_NOISE_PATTERNS = [
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/go.sum',
  'vendor/**',
  '**/vendor/**',
  'dist/**',
  '**/dist/**',
  'node_modules/**',
  '**/node_modules/**',
  '**/generated/**',
];

/** Translates a glob into a RegExp. Supports `**`, `*`, and `?` only. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more leading segments.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
        else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const cache = new Map<string, RegExp>();
const compile = (glob: string): RegExp => {
  let re = cache.get(glob);
  if (!re) { re = globToRegExp(glob); cache.set(glob, re); }
  return re;
};

export function isNoise(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => compile(p).test(path));
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run lib/review/filters.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/review/filters.ts lib/review/filters.test.ts
git commit -m "Add noise filtering with glob matching"
```

---

### Task 10: Draft store

Pure logic over an injected key-value store, so it tests without `chrome.storage`.

**Files:**
- Create: `lib/review/drafts.ts`, `lib/review/drafts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DraftStore, type KeyValueStore, draftKey } from './drafts';

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => { map.set(k, v); },
    remove: async (k) => { map.delete(k); },
    keys: async () => [...map.keys()],
  };
}

const loc = { prId: 'PR_1', path: 'src/a.ts', line: 10, side: 'RIGHT' as const };

describe('draftKey', () => {
  it('is stable and includes every locating field', () => {
    expect(draftKey(loc)).toBe('draft:PR_1:src/a.ts:10:RIGHT');
  });

  it('distinguishes sides on the same line', () => {
    expect(draftKey(loc)).not.toBe(draftKey({ ...loc, side: 'LEFT' }));
  });
});

describe('DraftStore', () => {
  it('round-trips a draft', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'work in progress');
    expect(await s.load(loc)).toBe('work in progress');
  });

  it('returns null for an absent draft', async () => {
    expect(await new DraftStore(memoryStore()).load(loc)).toBeNull();
  });

  it('clears a draft', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'text');
    await s.clear(loc);
    expect(await s.load(loc)).toBeNull();
  });

  it('treats an empty body as a clear, so blank drafts do not accumulate', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'text');
    await s.save(loc, '   ');
    expect(await s.load(loc)).toBeNull();
  });

  it('lists only drafts for the requested pull request', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'a');
    await s.save({ ...loc, prId: 'PR_2' }, 'b');
    expect(await s.listFor('PR_1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/review/drafts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { DiffSide } from '../github/types';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface DraftLocation {
  prId: string;
  path: string;
  line: number;
  side: DiffSide;
}

export const draftKey = (l: DraftLocation): string =>
  `draft:${l.prId}:${l.path}:${l.line}:${l.side}`;

export class DraftStore {
  constructor(private readonly store: KeyValueStore) {}

  /** Saving whitespace clears instead, so abandoned composers leave nothing behind. */
  async save(location: DraftLocation, body: string): Promise<void> {
    if (body.trim() === '') return this.clear(location);
    await this.store.set(draftKey(location), body);
  }

  load(location: DraftLocation): Promise<string | null> {
    return this.store.get(draftKey(location));
  }

  clear(location: DraftLocation): Promise<void> {
    return this.store.remove(draftKey(location));
  }

  async listFor(prId: string): Promise<string[]> {
    const prefix = `draft:${prId}:`;
    return (await this.store.keys()).filter((k) => k.startsWith(prefix));
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run lib/review/drafts.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/review/drafts.ts lib/review/drafts.test.ts
git commit -m "Add draft store over an injected key-value backend"
```

---

### Task 11: Phase 1 checkpoint

- [ ] **Step 1: Run the whole suite**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all tests pass, no type errors.

- [ ] **Step 2: Commit**

```bash
git commit --allow-empty -m "Checkpoint: pure domain logic complete and tested"
```

---

# Phase 2 — GitHub client

### Task 12: GraphQL documents

**Files:**
- Create: `lib/github/queries.ts`, `lib/github/mutations.ts`

- [ ] **Step 1: Copy the verified query**

`lib/github/queries.ts` exports `PULL_REQUEST_QUERY` as a template string. **Copy it verbatim from `docs/reference/github-review-api.md` §3.** That query was executed successfully against two real PRs; do not retype it from memory or "improve" it.

- [ ] **Step 2: Write the mutations**

`lib/github/mutations.ts` exports one document per mutation. Input field names come from `docs/reference/github-review-api.md` §4, which was introspected from the live schema:

- `ADD_THREAD` — `addPullRequestReviewThread`, variables `path`, `body`, `line`, `side`, `startLine`, `startSide`, and exactly one of `pullRequestId` / `pullRequestReviewId`
- `ADD_REPLY` — `addPullRequestReviewThreadReply`, variables `pullRequestReviewThreadId`, `body`
- `RESOLVE_THREAD` / `UNRESOLVE_THREAD` — variable `threadId`
- `START_REVIEW` — `addPullRequestReview` with `pullRequestId` and **no `event`**, which is what creates a PENDING review
- `SUBMIT_REVIEW` — `submitPullRequestReview`, variables `pullRequestReviewId`, `event`, `body`
- `MARK_VIEWED` / `UNMARK_VIEWED` — variables `pullRequestId`, `path`

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/github/queries.ts lib/github/mutations.ts
git commit -m "Add GraphQL documents from verified schema"
```

---

### Task 13: GitHub client

**Files:**
- Create: `lib/github/client.ts`, `lib/github/client.test.ts`

Transport only — no caching, no business logic. Takes an injected `fetch` and a `TokenProvider` so it tests without network or `chrome.*`.

- [ ] **Step 1: Write the failing test**

Cover, with an injected fake `fetch`:
- `graphql()` sends `Authorization: Bearer <token>` and POSTs `{query, variables}`
- a GraphQL response containing an `errors` array rejects, even with HTTP 200 — this is the single most common GraphQL client bug
- `fetchDiff()` sends `Accept: application/vnd.github.diff` and returns raw text
- a 401 rejects with a distinguishable `AuthError` so the UI can show the setup state
- a 403 carrying `x-ratelimit-remaining: 0` rejects with a `RateLimitError` exposing the reset timestamp
- rate-limit headers are recorded on every successful response

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/github/client.test.ts
```

- [ ] **Step 3: Implement**

```ts
export interface TokenProvider { getToken(): Promise<string | null>; }

export class AuthError extends Error {}
export class RateLimitError extends Error {
  constructor(message: string, readonly resetAt: Date) { super(message); }
}

export interface RateLimitStatus { remaining: number; limit: number; resetAt: Date; }

export class GitHubClient {
  private lastRateLimit: RateLimitStatus | null = null;

  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  getRateLimit(): RateLimitStatus | null { return this.lastRateLimit; }

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
      { headers: { accept: 'application/vnd.github.diff' } }
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
      throw new RateLimitError('GitHub rate limit exceeded', this.lastRateLimit!.resetAt);
    }
    if (!res.ok) throw new Error(`GitHub request failed: ${res.status}`);
    return res;
  }

  private recordRateLimit(res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const limit = res.headers.get('x-ratelimit-limit');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining && limit && reset) {
      this.lastRateLimit = {
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: new Date(Number(reset) * 1000),
      };
    }
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

- [ ] **Step 5: Commit**

```bash
git add lib/github/client.ts lib/github/client.test.ts
git commit -m "Add GitHub client with auth and rate limit handling"
```

---

### Task 13b: Oversized-diff fallback

Spec §11 requires that a diff GitHub refuses to generate degrades gracefully rather than failing the page.

**Files:**
- Modify: `lib/github/client.ts`
- Create: `lib/github/files-fallback.ts` + test

- [ ] **Step 1: Write the failing test**

With an injected fake `fetch`, assert that:
- when `fetchDiff` succeeds, the fallback is never called
- when `fetchDiff` fails, `fetchFilesFallback` paginates `/pulls/{n}/files?per_page=100` until `hasNextPage` is exhausted
- files whose `patch` is absent (GitHub omits it for very large files) are returned flagged `patchOmitted: true` rather than dropped
- the result reports `truncated: true` when GitHub's 3000-file cap is hit, so the UI can show the banner and escape hatch

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement** `fetchFilesFallback`, returning `{ files: ParsedDiffFile[]; truncated: boolean }` so it is shape-compatible with `parseUnifiedDiff` output plus a truncation flag.

- [ ] **Step 4: Run it and confirm it passes**

- [ ] **Step 5: Commit**

```bash
git add lib/github/files-fallback.ts lib/github/files-fallback.test.ts lib/github/client.ts
git commit -m "Add oversized-diff fallback to the files endpoint"
```

---

# Phase 3 — Extension plumbing

> **Tasks 14 onward are specified by constraint rather than by full code.** Phases 0-2 are code-complete because they are pure, testable, and carry the defect-prone logic. The UI tasks depend on API details that live in the three reference documents, which are more accurate than anything restated here would be. Each task below must be expanded into concrete steps — with real code — at dispatch time, by reading the referenced document first. Do not begin one of these tasks without reading its reference.

### Task 14: Message protocol

**Files:**
- Create: `lib/messages.ts`

Typed discriminated unions for every background/page exchange: `prefetch-pr`, `open-review`, `get-pr`, `mutate`. Both sides import these types; neither hand-rolls a string. WXT ships no messaging helper, so this is raw `browser.runtime` with our own types on top.

- [ ] Commit: `git commit -m "Add typed background message protocol"`

---

### Task 15: Background service worker

**Files:**
- Create: `entrypoints/background.ts`, `lib/cache.ts`

Owns the client, the cache, prefetch, and tab opening.

- Cache keyed on `${owner}/${repo}/${number}@${headSha}`. The diff is immutable per head SHA and goes to `chrome.storage.local`; threads and checks get a short TTL.
- `open-review` calls `chrome.tabs.update(tabId, { url: browser.runtime.getURL('/review.html#/...') })`. **The content script must never navigate itself** — that would require `web_accessible_resources` and expose the extension to github.com.

- [ ] Commit: `git commit -m "Add background worker with cache, prefetch, and tab routing"`

---

### Task 16: Content script

**Files:**
- Create: `entrypoints/content.ts`

Matches `https://github.com/*/*/pull/*`. Parses owner/repo/number from the URL, sends `prefetch-pr` on load, injects the button, and sends `open-review` on click.

The button must mount defensively — GitHub's markup changes without notice. Locate the insertion point, and if it is absent, log once and do nothing rather than throwing. The keyboard shortcut and direct URL remain as fallbacks.

Content scripts get no HMR and are absent from the dev manifest entirely, so **verify this task against `npx wxt build` output loaded unpacked**, not against `npx wxt`.

- [ ] Commit: `git commit -m "Add content script with defensive button injection"`

---

### Task 17: Options page and token storage

**Files:**
- Create: `entrypoints/options/index.html`, `entrypoints/options/main.tsx`, `lib/github/token-provider.ts`

`ChromeTokenProvider` implements `TokenProvider` over `chrome.storage.local`. The options UI takes a fine-grained PAT, validates it with a cheap `viewer { login }` query, and shows the result plus current rate-limit status.

State plainly in the UI that the token is stored unencrypted and readable by anything running in the extension.

- [ ] Commit: `git commit -m "Add options page and token provider"`

---

# Phase 4 — Review UI

### Task 18: Shell and routing

`review.html` mounts a React app with hash routing on `#/{owner}/{repo}/{number}`. Renders the top bar, left rail, and main column from §5 of the spec. Handles the four full-page states: no token, loading, error, loaded.

- [ ] Commit: `git commit -m "Add review app shell and routing"`

---

### Task 19: File tree

Wraps `@pierre/trees`. Non-obvious constraints, all verified — see `docs/reference/pierre-trees-api.md`:

- Construct with **`search: false`**. The built-in search seeds on any unmodified letter or digit and calls `stopPropagation()`, which would swallow every single-letter shortcut in the keymap.
- `onSelectionChange` is constructor-only and includes directories with a trailing `/` — filter with `!p.endsWith('/')`.
- Arrow keys move focus without changing selection. To follow keyboard navigation, subscribe and read `getFocusedPath()`.
- There is no "select only this path"; `select()` is additive. Deselect the previous paths first.
- `scrollToPath` silently no-ops when the row is not visible. Expand ancestors first.
- **Never call `cleanUp()` in React** — `useFileTree` already does.
- Row decoration is one element per row: the git lane carries `changeType`, and the decoration cell carries `+12 −3` via `parts` for colour.

- [ ] Commit: `git commit -m "Add file tree with GitHub-style status decoration"`

---

### Task 20: Diff rendering

Wraps `@pierre/diffs`. See `docs/reference/pierre-diffs-api.md`:

- Use `VirtualizedFileDiff` for performance. **Do not** use the worker export — see spec §16.4.
- Never set `disableLineNumbers`; line selection is only reachable through the gutter.
- Never set `preferredHighlighter: 'shiki-wasm'`.
- Memoize annotation `metadata` — it is compared by reference, so a fresh object every render churns annotation DOM.

- [ ] **Add a guard test** asserting the built output contains no `shiki-wasm` and no `.wasm` reference. A comment will not survive a well-meaning performance change; a failing test will.

- [ ] Commit: `git commit -m "Add virtualized diff rendering"`

---

### Task 21: Threads and annotations

Renders each anchored thread as a Pierre annotation via `partitionThreads` from Task 6, and **every unanchorable thread in a collapsed per-file section**. That section is load-bearing: Pierre drops out-of-range annotations silently, so a thread that is neither anchored nor listed is invisible to the reviewer.

Outdated threads display "was on line N" from `originalLine`.

Two obligations this task inherits, both raised during Task 6 and deliberately left to the call site:

- **Cross-check every anchor against the rendered hunk ranges.** `partitionThreads` has no hunk information, so it reports a thread anchored to line 10 as `anchored` even when line 10 sits in collapsed context and Pierre will silently drop it. Only this task knows the real hunk ranges. Any anchor that falls outside them must be demoted into the per-file section, or the comment vanishes — the exact failure `partitionThreads` exists to prevent, one layer up.
- **Render the line range on multi-line threads.** `anchorThread` collapses a multi-line thread to its end line because Pierre cannot express ranges. Call `isMultiLine(thread)` and read `startLine` to show "lines 5-9" in the thread header, otherwise a range comment is indistinguishable from a single-line one.

- [ ] Commit: `git commit -m "Render review threads as annotations with unanchorable fallback"`

---

### Task 22: Composer

Line selection through `enableGutterUtility` + `onGutterUtilityClick`, which gives GitHub's familiar "+" affordance. Ranges pass through `normalizeSelection` from Task 7; a cross-side range shows an explanatory message rather than a failed request.

Drafts save on a debounce and are cleared only after a successful post. Includes the suggestion-block button.

- [ ] Commit: `git commit -m "Add comment composer with draft persistence"`

---

### Task 23: Review submission

The footer bar showing pending comment count, and the submit control offering Comment / Approve / Request changes with an optional summary. Drives the Task 8 state machine.

- [ ] Commit: `git commit -m "Add review submission flow"`

---

### Task 24: Overview panel, checks, and viewed state

The collapsible Overview: description, per-check statuses rendered from both `CheckRun` and `StatusContext` union members, reviewer states, and an unresolved-thread jump list.

Viewed state uses `markFileAsViewed`. Render all three values — `DISMISSED` means the file changed after you viewed it and must be visually distinct from `UNVIEWED`.

- [ ] Commit: `git commit -m "Add overview panel, checks, and viewed state"`

---

### Task 24b: Changes since my last review

Spec §9's incremental review feature. Reads `commit.oid` from `viewerLatestReview` in the batched query, then re-renders the diff as `thatSha...headSha` by fetching
`GET /repos/{owner}/{repo}/compare/{base}...{head}` with `Accept: application/vnd.github.diff`, which returns the same unified-diff format `parseUnifiedDiff` already handles.

Exposed as a top-bar toggle, **disabled when `viewerLatestReview` is null** — a first-time reviewer has no prior commit to compare against.

Threads must be re-anchored against the narrowed diff, and any thread whose line falls outside it goes to the per-file unanchorable section from Task 21 rather than disappearing.

- [ ] Commit: `git commit -m "Add changes-since-last-review toggle"`

---

### Task 25: Keyboard navigation and diff search

Binds the §9 keymap. Since the tree is built with `search: false`, single-letter keys reach the document handler. Includes `Mod+K` file jump, `/` diff search with a results jump-list, and the `?` help overlay.

- [ ] Commit: `git commit -m "Add keyboard navigation and diff search"`

---

### Task 26: Expand unchanged context

Supplies the `loadDiffFiles` callback. A diff parsed from a GitHub patch is `isPartial: true`, and Pierre shows **no expand affordance at all** until this loader is provided; `revealLine()` returns `false` until then. The loader fetches full blob contents for **both** sides of the file.

This is the largest hidden dependency in the project and is deliberately sequenced last, since everything else works without it.

- [ ] Commit: `git commit -m "Add expand-unchanged-context via blob loader"`

---

# Phase 5 — Integration

### Task 27: Playwright smoke test

Drives a production build loaded unpacked: open a PR page, click the injected button, confirm the diff renders, leave a comment, submit the review. Runs against a fixture, not real GitHub.

- [ ] Commit: `git commit -m "Add end-to-end smoke test"`

---

## Verification checklist

Before calling the project complete, confirm each by running it:

- [ ] `npx vitest run` — all green
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx wxt build` — succeeds, and `.output/chrome-mv3/manifest.json` has no `web_accessible_resources`
- [ ] Built output contains no `.wasm` reference
- [ ] Extension loads unpacked, button appears on a real PR, review UI opens
- [ ] A force-pushed PR with outdated threads renders those threads in the collapsed section rather than dropping them
- [ ] A PR with a multi-line comment thread renders it anchored to its end line
