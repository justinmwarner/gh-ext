# Public Store Listing and Token Encryption — Design

**Date:** 2026-09-08
**Status:** Implemented, except the listing assets in §5 and the store
submission itself.

## Goal

Get the extension auto-updating for users who install it, without anyone having
to clone a repo and run a build. The chosen route is a **public** listing on the
Chrome Web Store. That decision drags in two others: the extension is renamed to
**A Better Reviewer**, and the GitHub token stops sitting on disk in plaintext.

## Why the Chrome Web Store

Auto-update was the whole point, so the options were judged on whether the
recipient has to do anything per machine.

| Route | Fee | Reaches | Per-machine setup |
|---|---|---|---|
| **Chrome Web Store** | $5 once | Chrome, Edge, Brave, Arc, Vivaldi | None |
| Edge Add-ons | $0 | Edge only | None |
| Firefox self-hosted XPI | $0 | Firefox only | None |
| Self-hosted CRX + policy | $0 | Chrome, if managed | Browser must be enrolled |
| Unpacked + self-reload loop | $0 | Anything | Node 22 and a scheduled task |

The Chrome Web Store wins because compatibility runs **one way**: Edge can
install from the Chrome Web Store, Chrome cannot install from Edge Add-ons, and
Chrome has blocked off-store installs on Windows and macOS since Chrome 33 and
44 respectively. One $5 submission therefore covers every Chromium browser, and
publishing separately to Edge Add-ons would be redundant.

Firefox remains a free follow-up via AMO's unlisted signing channel. It is out
of scope here and unverified — the only browser API this codebase calls directly
is `chrome.storage.local`, so it is plausible, not proven.

**Public, not unlisted.** Visibility is a per-item setting, not a pricing tier:
the same $5 covers up to 20 items at any visibility, review is identical either
way, and switching later costs a full review cycle. Public was chosen
deliberately, which is what forces the hardening below.

## Scope

### 1. Release plumbing

`package.json` carries `"version": "0.0.0"`, which WXT copies into the manifest.
Every auto-update mechanism on every platform compares version numbers, so
nothing updates until this is real. It becomes `1.0.0` and is bumped per
release.

The manifest also ships a `key` field, which pins the extension ID for unpacked
installs. The Chrome Web Store **rejects** `key` on a first upload, so the store
build must omit it while local unpacked builds keep it.

Consequence, accepted: the store assigns its own extension ID, `chrome.storage`
is keyed per ID, so everyone re-pastes their token once when migrating off the
unpacked install.

### 2. Drop the `tabs` permission

The only tabs call is `browser.tabs.update(tabId, { url })` in
`entrypoints/background.ts`, and nothing reads `url`, `title`, or `favIconUrl`
off a tab. Chrome requires the `tabs` permission solely for those sensitive
properties — navigation needs no permission. Removing it costs nothing and drops
an entry from the list a public listing must justify.

### 3. Rename to "A Better Reviewer"

Every user-facing occurrence of the former name, including the dated design
documents under `docs/superpowers/`. The injected button on GitHub PR pages
reads **"Start a Better Review"**.

### 4. Encrypt the token at rest

**The threat being addressed:** the token is currently written verbatim to
`chrome.storage.local`, which is unencrypted, so anything able to read the
browser profile directory can read a GitHub credential with write access to pull
requests.

**The threat explicitly not addressed:** anything running inside the extension.
An attacker with code execution in the extension can wait for the unlock and
read the plaintext. No design fixes this, and encrypting under a key that ships
inside the extension would be theatre.

Design:

- A passphrase derives a key via WebCrypto PBKDF2 (SHA-256), which encrypts the
  token with AES-GCM.
- `storage.local` holds only the ciphertext record: version, salt, IV,
  ciphertext, and KDF parameters. Never the token.
- `storage.session` holds the decrypted token for the browser session. It is
  memory-only and never written to disk.
- Locked is the normal resting state. `getToken()` returning null means locked,
  and the UI prompts to unlock rather than treating it as signed out.

The whole change sits behind `ChromeTokenProvider` in
`lib/github/token-provider.ts`, which is already the single choke point for
token reads and writes, so `GitHubClient` and everything under `lib/` are
untouched.

**Migration:** an existing plaintext `github-token` in `storage.local` is
detected on load, the user is asked to set a passphrase, and the plaintext key
is removed once the ciphertext is written.

**Care required, and how it turned out:** `isTokenChange()` decided whether to
sweep the cache by watching `TOKEN_KEY` in the `local` area. Moving the token
to `session`, where the cache also lives, was flagged as the one place this
change could cause a subtle bug rather than an obvious one.

It did, and the fix was a split rather than a revision. Two callers want
opposite answers about the same event — the first unlock of a browser session:

- The **review page** listens so it can leave the locked screen and load the
  pull request. It needs `true`.
- The **background worker** listens so it can sweep cached reads that no longer
  belong to whoever is signed in. It needs `false`: session storage holds the
  cache too, so if the token was absent the cache was empty, and sweeping there
  would be churn on an event that happens every time a browser opens.

So `isTokenChange` now means "the usable credential changed" and the worker
uses `invalidatesCachedReads`, which is the same thing minus that one case.
Locking is a sweep under both, or whole pull requests stay readable behind a
vault the reviewer just locked.

### 5. Listing assets

Privacy policy, permission justifications for `storage` and the two
`host_permissions`, screenshots, and description.

## Rejected alternative

**GitHub App + device flow**, which would have replaced the pasted PAT
altogether: fine-grained permissions, 8-hour user tokens, a rotating 6-month
refresh token, and no client secret needed. It was recommended and not chosen.

The gap it would have closed stays open: a public listing still asks strangers
to mint a long-lived, write-scoped credential by hand. The mitigation is the
options-page copy, which must state the trade-off plainly rather than bury it.
The device flow remains the obvious next step if the listing gains real users.

## Testing

`lib/` is pure and tested under Node; WebCrypto is available there, so the
encrypt/decrypt module is unit-testable with no browser. Round-trip, wrong
passphrase, tampered ciphertext, and migration from plaintext each need
coverage. The existing Playwright e2e run guards the `tabs` removal and the
rename.
