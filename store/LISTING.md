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
Reviewing a pull request on GitHub means a lot of scrolling, a lot of clicking, and a lot of waiting. A Better Reviewer replaces that with an interface built for the handful of things you actually do over and over — and deliberately nothing else.

Open a pull request and a small card appears with "Start a Better Review". Click it and the whole review opens in a fast, purpose-built page. Don't want the card? Collapse it to a pill and it stays out of your way.

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

YOUR CHOICE OF WHERE IT OPENS

Reviews open in a new tab by default, leaving the pull request where it was. You can switch that to a new window — useful on a second monitor — or to the current tab. There is also an option to open the review automatically whenever you land on a pull request, so the card becomes one less click.

Anything it does not do hands off to GitHub through an "Open in GitHub" button, so you are never stuck.

BRING YOUR OWN TOKEN

The extension has no server and no account. It talks to GitHub using a fine-grained personal access token that you create and control, scoped to only the repositories you choose. The Options page walks you through creating one with exactly the right permissions.

If you want it, the token can be encrypted on your own machine with a passphrase you choose — PBKDF2 key derivation and AES-GCM, with only the ciphertext written to disk, and the decrypted token held in memory for the browser session. This is optional and off by default; you can turn it on when you save the token or long afterwards, and turn it off again. The passphrase is never stored and never transmitted, so it also cannot be recovered.

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
Stores the user's GitHub personal access token so they do not have to re-enter it. The user may optionally protect it with a passphrase, in which case only the encrypted form is stored. Also stores unsent comment drafts so a failed network request does not lose the user's typing, and which files the user has marked as viewed so they can track progress through a large diff. All of this is local to the user's browser; none of it is transmitted anywhere.
```

**Host permission — `https://api.github.com/*`**

```
This is GitHub's API, and it is the sole data source for the extension. It is used to read the pull request, its diff, its review threads and its status checks, and to post the review actions the user takes: comments, replies, thread resolutions, approvals and change requests. Requests are authenticated with the user's own personal access token.
```

**Host permission — `https://github.com/*`**

> ⚠️ **This justification describes a content script matched to the whole of
> github.com.** It is only truthful for a build whose manifest says
> `"matches": ["https://github.com/*"]`. A build that still matches
> `https://github.com/*/*/pull/*` needs the narrower wording instead — say the
> script runs on pull request pages and drop the single-page-app paragraph.
>
> Check before pasting, using the manifest command in step 3 of
> [SUBMITTING.md](SUBMITTING.md). A justification broader than the manifest
> invites questions that are not there to answer; one narrower than the
> manifest is a misrepresentation, and that is the kind of mismatch items get
> rejected for.

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
