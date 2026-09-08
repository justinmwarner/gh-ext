# A Better Reviewer

A Chrome extension that puts a **Start a Better Review** card in the corner of
every GitHub pull request page. Pressing it opens a standalone review UI built on
[Pierre](https://pierre.computer)'s diff and file-tree components, covering the
review actions you perform constantly and deliberately nothing else.

The review opens in a new tab by default, so the pull request stays where it
was. Options has the other two destinations — a new window, or this tab — and a
switch to open the review automatically on landing on a pull request.

Comments with reply and resolve. The pending-review flow. Status checks.
Approve and request changes. Plus keyboard navigation, viewed state, drafts that
survive a failed post, multi-line comments, suggestion authoring, noise
filtering, diff search, expand-unchanged-context, and scoping the diff to one
commit, a range of commits, or "changes since my last review".

Anything it does not do hands off to GitHub through an **Open in GitHub**
escape hatch.

---

## Install

### From the Chrome Web Store

<!-- Replace with the listing URL once the item is published. -->
_Pending first publication — see [store/SUBMITTING.md](store/SUBMITTING.md)._

Works in Chrome, Edge, Brave, Arc and Vivaldi: Edge and the other Chromium
browsers can install from the Chrome Web Store, so one listing covers all of
them. Updates arrive on their own.

### From source

For development, or to run a build the store has not seen yet. Needs **Node 22
or newer**.

```bash
git clone https://github.com/justinmwarner/gh-ext.git gh-ext
cd gh-ext
npm ci
npx wxt build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `gh-ext/.output/chrome-mv3`

A source build pins the extension id to `kpjeagilmchpoganlnllmhloplapcnoj`, so
it is the same on every machine. A store install gets its own id from Google
instead, which is why the two cannot see each other's saved token — extension
storage is keyed per id. Moving from one to the other means entering the token
once more.

### Give it a token

Open the extension's **Options** page, paste a
[fine-grained personal access token](https://github.com/settings/tokens?type=beta),
and choose a passphrase to encrypt it with.

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
into your Google account. Set a token once per machine.

#### How the token is stored

The passphrase derives a key with PBKDF2-HMAC-SHA256 (600,000 iterations), and
that key encrypts the token with AES-GCM. Only the ciphertext, salt and IV go
to `chrome.storage.local`. The decrypted token lives in `chrome.storage.session`
for the browser session, which is memory-only and never written to disk.

So the vault is locked whenever the browser has just started, and the review
page asks for the passphrase in place rather than sending you to the options
page. Locking also sweeps the cached pull request, because that cache is
readable without the token.

**The passphrase is never stored and never leaves the machine, so it cannot be
recovered.** If you forget it, delete the token and paste a new one.

What this protects: the token on disk, against another program running as you,
a backup, or someone holding the laptop.

What it does not protect: the extension itself. While unlocked the token is in
memory and any code running inside the extension can read it. That is true of
every browser extension holding a credential and no client-side design changes
it — so still scope the token to the repositories you review, give it the
shortest expiry you can live with, and revoke it if you suspect the machine is
compromised. **The token can write to your pull requests.**

An install from before the vault keeps working until you open the Options page,
which offers to encrypt the existing token. The plaintext copy is deleted the
moment the encrypted one is written.

### Updating

A store install updates itself. Chrome checks every few hours and there is
nothing to do.

A source install does not — Chrome never auto-updates an unpacked extension:

```bash
git pull && npm ci && npx wxt build
```

Then hit the reload icon on the extension card in `chrome://extensions`.

### Publishing a new version

```bash
npm version patch      # or minor / major — the manifest version comes from here
npm run zip:store      # → .output/a-better-reviewer-<version>-chrome-store.zip
```

Upload that zip to the [developer dashboard](https://chrome.google.com/webstore/devconsole).
Every update goes through review. The version must increase or the store
rejects it, which is what `npm version` is for. Full walkthrough in
[store/SUBMITTING.md](store/SUBMITTING.md).

---

## Development

```bash
npm run dev        # bare `wxt` — NOT `wxt dev`, which parses as a root dir
npm test           # vitest: lib (node) + ui and content (jsdom)
npm run typecheck
npm run test:e2e   # builds, then Playwright against the production build
```

Content scripts get no HMR and are absent from the dev manifest entirely — WXT
registers them at runtime. **Verify anything touching the injected card
against `npx wxt build` output**, not against the dev server.

### Layout

```
entrypoints/     content script, background worker, review page, options page
lib/             pure domain logic — no DOM, no chrome.*, no network
                 (two adapters excepted: token-provider.ts, settings-store.ts)
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
