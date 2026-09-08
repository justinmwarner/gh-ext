# Chrome Web Store listing copy

Everything the dashboard asks for, ready to paste. Field limits are noted where
the store enforces one.

---

## Item name

*(75 characters max)*

```
A Better Reviewer
```

## Summary / short description

*(132 characters max — this is the line shown in search results)*

```
A faster review interface for GitHub pull requests. Comments, replies, resolves, approvals, and full keyboard navigation.
```

## Category

**Developer Tools**

## Language

English (United Kingdom)

---

## Detailed description

```
A Better Reviewer puts a "Start a Better Review" button on GitHub pull request pages. Click it and the review opens in a purpose-built interface that covers the actions you perform constantly, and deliberately nothing else.

WHAT IT DOES

• Comments, with reply and resolve
• The full pending-review flow — queue comments, then submit them together
• Approve and request changes
• Status checks, including GitHub Actions runs and older commit statuses
• Keyboard navigation throughout
• Per-file viewed state, so you can track your way through a large diff
• Drafts that survive a failed post, so nothing you typed is lost
• Multi-line comments and suggestion authoring
• Noise filtering and diff search
• Expand unchanged context around a hunk
• Scope the diff to one commit, a range of commits, or "changes since my last review"
• Light and dark, following your system

Anything it does not do hands off to GitHub through an "Open in GitHub" button, so you are never stuck.

BRING YOUR OWN TOKEN

The extension has no server and no account. It talks to GitHub using a fine-grained personal access token that you create and control, scoped to only the repositories you choose. The Options page walks you through creating one with exactly the right permissions.

Your token is encrypted on your own machine with a passphrase you choose — PBKDF2 key derivation and AES-GCM, with only the ciphertext written to disk. The decrypted token is held in memory for the browser session and never written to a file. The passphrase is never stored and never transmitted.

To be plain about the limit of that: encryption protects the token against anything reading your browser profile off disk. It cannot protect against code running inside the extension itself while it is unlocked. That is true of every browser extension that holds a credential.

PRIVACY

No analytics. No telemetry. No third-party servers. The developer receives no data of any kind. The extension makes network requests to github.com and api.github.com and to nowhere else.

OPEN SOURCE

The full source is at https://github.com/justinmwarner/gh-ext — every claim above can be checked against it.

LIMITS WORTH KNOWING BEFORE YOU INSTALL

• github.com only. GitHub Enterprise is not supported.
• Applying a suggestion is not supported, because GitHub exposes no public endpoint for it. Authoring and rendering suggestions both work.
• The pull request description renders as plain text. The overview panel links to GitHub for the formatted version.
```

---

## Privacy practices tab

### Single purpose

*(The store requires one sentence describing a single narrow purpose.)*

```
A Better Reviewer provides an alternative interface for reviewing GitHub pull requests, replacing the review workflow on github.com pull request pages with a faster purpose-built one.
```

### Permission justifications

**`storage`**

```
Stores the user's GitHub personal access token, encrypted with a passphrase they choose, so they do not have to re-enter it. Also stores unsent comment drafts so a failed network request does not lose the user's typing, and which files the user has marked as viewed so they can track progress through a large diff. All of this is local to the user's browser; none of it is transmitted anywhere.
```

**Host permission — `https://api.github.com/*`**

```
This is GitHub's API, and it is the sole data source for the extension. It is used to read the pull request, its diff, its review threads and its status checks, and to post the review actions the user takes: comments, replies, thread resolutions, approvals and change requests. Requests are authenticated with the user's own personal access token.
```

**Host permission — `https://github.com/*`**

```
Two uses. First, a content script runs on github.com to add the card that opens the review interface. It is registered for the whole site rather than only /*/*/pull/* because GitHub is a single-page app: a script matched to pull request URLs alone is never injected when the user reaches a pull request by navigating within the site, so the card would be missing until they reloaded. The script reads only the page's URL, adds nothing on any page that is not a pull request, and never reads page content. Second, some file contents and diffs are fetched from github.com directly, because GitHub's API does not expose them in a usable form for large or binary files. Requests are authenticated with the user's own personal access token.
```

**Remote code**

```
No, I am not using remote code.
```

All executable code is contained in the uploaded package. The extension loads no
scripts from any remote source and uses no `eval`.

### Data usage declarations

Tick **nothing** in the data collection list, and certify all three statements.
Every one of these is accurate for this extension:

| Category | Collected? |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No — the token never leaves the user's machine except to GitHub |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

Certifications, all three of which apply:

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

### Privacy policy URL

`store/PRIVACY.md` must be published at a public URL before submitting. See the
submission guide in [SUBMITTING.md](SUBMITTING.md) for the two ways to do that.

---

## Screenshots

In `store/screenshots/`, all 1280×800, regenerated with `npm run screenshots`:

| File | Shows |
|---|---|
| `01-review.png` | The review page: file tree, diff, an open comment thread |
| `02-review-dark.png` | The same in dark mode |
| `03-options.png` | The Options page and its token walkthrough |
| `04-conversations.png` | The Conversations view, including outdated and file-level threads |

Upload at least one; the store allows up to five. `01` should be first, since it
is the one shown largest.

**Note:** these are captured against the test harness, so the diff content is
fixture data rather than a real repository. The interface is exactly what ships.
