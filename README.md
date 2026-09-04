# Fast GitHub Review

A Chrome extension that puts a **Fast review** button on GitHub pull request
pages. Clicking it opens a standalone review UI built on
[Pierre](https://pierre.computer)'s diff and file-tree components, covering the
review actions you perform constantly and deliberately nothing else.

Comments with reply and resolve. The pending-review flow. Status checks.
Approve and request changes. Plus keyboard navigation, viewed state, drafts that
survive a failed post, multi-line comments, suggestion authoring, noise
filtering, diff search, expand-unchanged-context, and scoping the diff to one
commit, a range of commits, or "changes since my last review".

Anything it does not do hands off to GitHub through an **Open in GitHub**
escape hatch.

---

## Install on a machine

Needs **Node 22 or newer**. Chrome or any Chromium browser.

```bash
git clone <this repo> gh-ext
cd gh-ext
npm ci
npx wxt build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `gh-ext/.output/chrome-mv3`

The extension id is pinned to `kpjeagilmchpoganlnllmhloplapcnoj`, so it is the
same on every machine.

### Give it a token

Open the extension's **Options** page and paste a
[fine-grained personal access token](https://github.com/settings/tokens?type=beta).

Required permissions:

| Permission | Access | Why |
|---|---|---|
| Pull requests | Read and write | The review itself: threads, replies, resolves, approvals |
| Contents | Read | The diff, and whole files when you expand context |
| Checks | Read | GitHub Actions runs (`CheckRun`) |
| Commit statuses | Read | The older-style commit statuses (`StatusContext`) |
| Metadata | Read | Required by GitHub whenever any other permission is set |

`statusCheckRollup.contexts` is a union of both check types, so **Checks** and
**Commit statuses** are separate grants and a token needs both to show a
complete list. Missing either one is not fatal — GitHub refuses those nodes
individually and the review page renders with a banner saying the checks are
hidden — but the checks will be incomplete or absent until it is granted.

**The token is stored per machine and is not synced.** That is deliberate —
`chrome.storage.sync` would replicate a credential across every browser signed
into your Google account. Paste a token once per machine.

Note that `chrome.storage.local` is not encrypted, and anything running inside
the extension can read it. Acceptable for a personal tool loaded unpacked;
reconsider before sharing this with anyone else.

### Updating

```bash
git pull && npm ci && npx wxt build
```

Then hit the reload icon on the extension card in `chrome://extensions`. Chrome
does not auto-update unpacked extensions — that is the cost of not going through
the Web Store.

---

## Development

```bash
npm run dev        # bare `wxt` — NOT `wxt dev`, which parses as a root dir
npm test           # vitest: lib (node) + ui (jsdom)
npm run typecheck
npm run test:e2e   # builds, then Playwright against the production build
```

Content scripts get no HMR and are absent from the dev manifest entirely — WXT
registers them at runtime. **Verify anything touching the injected button
against `npx wxt build` output**, not against the dev server.

### Layout

```
entrypoints/     content script, background worker, review page, options page
lib/             pure domain logic — no DOM, no chrome.*, no network
ui/              React components
e2e/             Playwright, against the production build
docs/reference/  verified API notes; read these before changing API code
```

`lib/` being pure is the most important boundary here: it is why most of the
logic tests in milliseconds under Node with no browser.

### Before changing API code

`docs/reference/` was written by reading real source, published tarballs, and
the live GitHub schema — not from recall, and it says so where something is
inferred rather than verified. It records several behaviours that break the
obvious implementation, among them:

- a review thread's `line` is `null` whenever it is outdated
- `startLine` **equals** `line` on single-line threads rather than being null
- Pierre drops an annotation outside a rendered hunk **silently**, so a comment
  that is neither anchored nor listed is invisible
- `CodeView` does not redraw an item whose `fileDiff` changed
- Pierre hydrates `FileDiffMetadata` **in place**, so object identity never
  changes when a partial diff becomes whole

If you change a GraphQL document, re-execute it against the live schema and
update the reference. Section 7 of `docs/reference/github-review-api.md` shows
how to validate a mutation without performing one.

---

## Known limits

- The pull request description renders as plain text; formatting is lost. The
  overview panel links to GitHub for the formatted version. This is the cost of
  taking neither a Markdown renderer nor a sanitizer as a dependency.
- Applying a suggestion is not supported — GitHub exposes no public endpoint for
  it. Authoring and rendering suggestions are.
- Discarding a pending review is wired but hidden behind `SHOW_DISCARD` in
  `ui/ReviewFooter.tsx`. It is the only destructive action available and would
  delete queued comments that exist nowhere else.
- Expanding unchanged context reads blobs at `baseRefOid` rather than the merge
  base, so if the base branch has moved the expanded context can come from a
  slightly different revision than the patch.
- The bundle carries an unreachable Shiki WebAssembly chunk. It is dead weight
  in the output, not on the main thread — the default highlighter is the
  JavaScript regex engine and nothing selects the WASM path.
- The shortcut help overlay has no Escape binding.
- github.com only. GitHub Enterprise is a base-URL abstraction away.
