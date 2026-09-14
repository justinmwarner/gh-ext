# Privacy Policy — A Better Reviewer

**Last updated: 14 September 2026**
**Published by: PoodlePop LLC**

A Better Reviewer is a browser extension that shows a faster review interface
for GitHub pull requests. This policy describes exactly what it does with your
data.

## The short version

The extension has no server. Nothing you do in it is sent anywhere except to
GitHub, using a token you supply yourself. PoodlePop LLC cannot see your
repositories, your reviews, your token, or that you in particular installed it.
The one thing it does receive is a count: Google reports how many people
installed from the store listing, the way it does for every item in the store.
That is set out in full below.

## What is stored, and where

Everything is stored locally in your own browser. Nothing is synced to any
account and nothing leaves your machine except requests to GitHub.

| What | Where | Notes |
|---|---|---|
| Your GitHub personal access token | `chrome.storage.local` | Encrypted with a passphrase, if you chose one |
| The decrypted token, while unlocked | `chrome.storage.session` | Memory only; discarded when the browser closes |
| Cached pull request data | `chrome.storage.session` | Memory only; discarded when the browser closes, and cleared when you lock or sign out |
| Unsent comment drafts | `chrome.storage.local` | So a failed post does not lose what you typed |
| Per-file "viewed" state | `chrome.storage.local` | Your own reading progress |

`chrome.storage.sync` is deliberately never used. Using it would replicate your
credentials to every browser signed into your Google account.

### How the token is protected

**Encryption is optional.** By default the token is stored as it stands in
`chrome.storage.local`, which is what browser extensions normally do with a
credential. If you would rather it were encrypted, set a passphrase on the
Options page — you can do that when you first save the token or at any point
afterwards, and you can remove it again.

The rest of this section describes what happens when you have set one.

The passphrase you choose derives a key using PBKDF2-HMAC-SHA256 with 600,000
iterations. That key encrypts the token with AES-GCM. Only the ciphertext, a
random salt, and a random initialisation vector are written to disk. The
passphrase itself is never stored anywhere and never transmitted, which also
means it cannot be recovered — if you forget it, you delete the token and paste
a new one.

While the extension is unlocked, the decrypted token is held in session storage,
which is memory-only.

**What this protects against:** someone reading your browser profile off disk —
another program running under your user account, a backup, or a lost laptop.
Without a passphrase you do not have this protection, which is the trade
being offered rather than hidden.

**What this does not protect against:** code running inside the extension
itself. While unlocked, the token is in memory. This is true of every browser
extension that holds a credential, and no client-side design changes it.

## What is transmitted

Network requests are made to exactly two hosts, both of them GitHub:

- `https://api.github.com` — reading pull requests, diffs, comments and status
  checks, and posting the review actions you take
- `https://github.com` — fetching file contents and diffs that are not
  available through the API

These requests carry your GitHub token, because that is what authenticates them
to GitHub. They go to GitHub and nowhere else.

The extension contacts no other server. There is no analytics, no telemetry, no
crash reporting, no advertising, and no third-party service of any kind inside
the extension.

### Statistics about the store listing page

Separately from the extension, Google provides PoodlePop LLC with aggregate
statistics about the Chrome Web Store listing page: how many people viewed it,
roughly where in the world they were, where they arrived from, and how many went
on to install. This is Google measuring a page Google serves, and it happens
whether or not you ever install anything.

It is written down here because a policy that says "no analytics" without
mentioning it would be answering a narrower question than the one you asked.

It says nothing about you and nothing about your use of the extension, and it
cannot: the extension transmits no data, the listing page is not the extension,
and there is no identifier shared between the two. Nothing in the section above
changes once you have installed.

## What is not collected

PoodlePop LLC receives **no data whatsoever** from this extension.
Specifically, the extension does not collect, transmit, sell, or share:

- Personally identifiable information
- Health, financial, or payment information
- Authentication information (your token stays on your machine)
- Personal communications
- Location
- Web history or browsing activity
- User activity, clicks, or analytics of any kind
- Website content, beyond fetching from GitHub to display to you

Data is not sold to third parties, is not used or transferred for any purpose
unrelated to the extension's single feature, and is not used to determine
creditworthiness or for lending purposes.

## Permissions, and why each is needed

- **`storage`** — to save the token, encrypted if you set a passphrase, plus
  your comment drafts and which files you have marked as viewed. All of it
  local.
- **`https://github.com/*` and `https://api.github.com/*`** — to read pull
  requests and post the review actions you take. These are the only hosts the
  extension can reach.

The extension requests no other permissions and cannot see your browsing
history.

Its content script is registered for github.com as a whole rather than for pull
request URLs alone, because GitHub is a single-page app and a script matched to
pull request URLs is never injected when you reach a pull request by clicking a
link within the site. On any page that is not a pull request it reads the URL,
finds nothing to do, and adds nothing. It never reads the content of any page,
and it cannot reach any site other than github.com.

## Remote code

The extension executes no remote code. All logic ships inside the package and
is reviewable in the public source repository.

## Removing your data

Uninstalling the extension removes everything it stored. You can also delete
the token at any time from the extension's Options page, which erases the
encrypted token, the decrypted copy, and the cached pull request data.

Revoking the token itself is done at
<https://github.com/settings/tokens?type=beta>, which is the authoritative way
to end the extension's access to your GitHub account.

## Source code

The extension is open source. The claims above can be checked against the code
at <https://github.com/justinmwarner/gh-ext>.

## Who is responsible for this extension

A Better Reviewer is published by **PoodlePop LLC**, which is the data
controller for the purposes of the GDPR — although, as set out above, the
extension transmits no personal data to PoodlePop LLC at all.

Because PoodlePop LLC is a trader for the purposes of EU consumer protection
law, its legal name, registered address and contact telephone number are shown
publicly on the extension's Chrome Web Store listing.

## Contact

Questions about this policy, and anything else you would rather not put in
public: <reviewer@juwar.io>. This is the same address shown as the support
contact on the extension's Chrome Web Store listing.

Bugs and feature requests are better off in public, next to the code, where the
next person to hit the same thing can find it already answered:
<https://github.com/justinmwarner/gh-ext/issues>. Please do not put a token, a
passphrase or a private repository name in one.
