# Submitting to the extension stores

Start to finish, for a first publication. Copy for every field is in
[LISTING.md](LISTING.md); the policy to publish is [PRIVACY.md](PRIVACY.md).

Budget: about 30 minutes of work, then days to weeks of waiting for review.

## Which stores, and which package

| Store | Package | Fee | Reaches |
|---|---|---|---|
| **Chrome Web Store** | `…-chrome.zip` | $5 once | Chrome, Edge, Brave, Arc, Vivaldi |
| Firefox Add-ons (AMO) | `…-firefox.zip` + `…-sources.zip` | free | Firefox |
| Edge Add-ons | `…-chrome.zip` | free | Edge only |

Build all of them with:

```bash
npm run zip:store      # Chrome and Edge — MV3, no manifest key
npm run zip:firefox    # Firefox — MV2, gecko id, plus a sources zip for review
```

**Edge is optional and mostly redundant.** Edge can install from the Chrome Web
Store, and Chrome cannot install from Edge Add-ons — the compatibility runs one
way. Publishing to Edge only avoids the user having to flip Edge's "Allow
extensions from other stores" toggle. It is a second listing to keep in sync
for that one benefit.

The rest of this document is the Chrome walkthrough. Firefox and Edge are at
the bottom.

---

## 1. Publish the privacy policy (do this first)

The dashboard will not let you submit without a **publicly reachable URL** for a
privacy policy. Pick one of these.

**Option A — GitHub Pages.** Settings → Pages → deploy from `master`, then the
policy is at
`https://justinmwarner.github.io/gh-ext/store/PRIVACY.html`. Needs the Markdown
rendered, so this only works if Pages is set up with a theme or the file is
converted to HTML.

**Option B — the rendered file on github.com (simplest).** GitHub renders
Markdown at a stable public URL with no setup at all:

```
https://github.com/justinmwarner/gh-ext/blob/master/store/PRIVACY.md
```

This is a real, public, permanent URL and is accepted. Use it unless you want
Pages for other reasons.

> The repository must be **public** for either to work. If it is currently
> private, make it public before submitting — the listing also claims the source
> is open, and a reviewer may check.

## 2. Register the developer account and pay the $5

1. Go to <https://chrome.google.com/webstore/devconsole>
2. Sign in with the Google account that should **own** the listing. Choose
   deliberately — transferring an item between accounts later is awkward, and
   this account will hold the item permanently.
3. You will be prompted to accept the developer agreement and pay the
   **one-time US$5 registration fee**. Pay by card; there is no PayPal option.
4. The fee is once per account, for the lifetime of the account, and covers up
   to 20 published items. There is no renewal and no per-item charge.

If the card is declined, the usual cause is a mismatch between the card's
billing country and the Google Payments profile country. Fix it in
<https://payments.google.com>.

## 2b. Account settings: trader status and publisher name

### Trader / non-trader

**Declare: trader.**

The item is published under **PoodlePop LLC**. The test the EEA rules apply is
whether the publisher acts "for purposes relating to its trade, business, craft
or profession" — a company publishing software does, and the fact that the
extension is free does not change it. Non-trader is for individuals publishing
outside any business capacity, which is not the case once an LLC is the
publisher.

**What declaring trader publishes.** The EU Digital Services Act requires the
marketplace to show trader contact details to consumers, so Google publishes
the following at the **bottom of the public listing**:

- the legal entity name
- a physical address
- a contact telephone number

Use PoodlePop LLC's registered business address and a business phone number.
If the LLC is registered at a home address, set up a registered-agent or
virtual business address before declaring, because this cannot be kept private
afterwards. Google may also ask for documentation to verify the entity.

Declaring non-trader avoids publishing those details but would be an inaccurate
declaration here, and it tells EEA users that consumer protection rights do not
apply to their contract with the publisher.

### Publisher display name

Set it to the name that should appear as "Offered by" on the listing. Keeping
it consistent with the legal entity — **PoodlePop LLC** — avoids a mismatch
between the "Offered by" line and the trader details published directly beneath
it, which reads as a red flag to both reviewers and users.

Change it under **Account** → **Account settings** → *Publisher display name*.
It can be edited later, but every change to a published listing goes back
through review.

## 3. Build the package

> **Build from a clean tree.** `wxt build` packages whatever is on disk, not
> whatever is committed. A dirty working tree — a half-finished feature, a
> debugging edit — ships to the store and cannot be unshipped without another
> review cycle. Check `git status` first, and if it is not clean, build from a
> throwaway worktree at the commit you actually mean to release:
>
> ```bash
> git worktree add ../abr-release <commit-or-tag>
> cd ../abr-release
> npm ci && npm test && npm run zip:store
> ```
>
> This leaves the main checkout untouched, which matters if someone else is
> working in it.

From a clean tree:

```bash
npm ci
npm test && npm run test:e2e     # don't ship a red build
npm run zip:store
```

This produces `.output/store/a-better-reviewer-<version>-chrome.zip` (~2.3 MB).
The store build has its own output directory so it can never be mistaken for
the unpacked build that `test:e2e` loads.

**Use `zip:store`, not `zip`.** The store build omits the manifest `key` field,
which the store rejects on a first upload. `npm run zip` keeps the key for
local unpacked installs.

**Check the manifest matches what the listing claims**, because the permission
justifications describe it:

```bash
node -e "const m=require('./.output/store/chrome-mv3/manifest.json');console.log(JSON.stringify({v:m.version,perms:m.permissions,host:m.host_permissions,cs:m.content_scripts.map(c=>c.matches)},null,1))"
```

In particular, the content script's `matches` decides which of the two
`https://github.com/*` justifications in [LISTING.md](LISTING.md) is the
truthful one. Sending the wrong one is the kind of mismatch that gets an item
rejected.

## 4. Create the item

1. Dashboard → **Items** → **Add new item**
2. Upload the zip. If it complains about the `key` field, you uploaded the
   wrong artifact — see step 3.
3. Google assigns the extension its permanent ID here. It will **not** be
   `kpjeagilmchpoganlnllmhloplapcnoj`; that id belongs to source builds only.

## 5. Fill in the listing

From [LISTING.md](LISTING.md):

- **Store listing** tab — item name, summary, detailed description, category
  (Developer Tools), language
- **Screenshots** — upload from `store/screenshots/`, `01-review.png` first
- **Privacy** tab — single purpose, a justification per permission, the privacy
  policy URL from step 1, and the data-usage declarations

For data usage: tick **nothing** in the collection list and certify all three
statements. That is accurate here — the extension has no server and transmits
nothing to anyone but GitHub.

An icon is already in the package (`public/icon/`), so there is nothing to
upload for it.

## 6. Choose visibility and submit

- **Visibility: Public** — listed and searchable.
- Distribution: all regions unless you have a reason otherwise.
- Click **Submit for review**.

Visibility does not change the review: public, unlisted and private all go
through the same process and the same queue. It only changes who can find the
listing afterwards.

## 7. Wait

Review usually takes a few days, occasionally weeks. Extensions requesting
broad host permissions get more scrutiny — this one asks for two specific
GitHub hosts and a single `storage` permission, which is about as easy a case
as a real extension presents.

You will be emailed the outcome. If it is rejected, the email names the policy
at issue; fix it, bump the version, and resubmit through the same item.

---

## Publishing an update later

```bash
npm version patch        # manifest version is derived from package.json
npm run zip:store
```

Upload to the **same item** → Submit for review. The version must be higher
than the published one. Existing users update automatically within a few hours
of approval.

## Known consequences of going to the store

- **The extension ID changes.** Extension storage is keyed per ID, so anyone
  moving from a source install to the store install re-enters their token once.
  There is no way around this; the store issues its own ID.
- **Every update is reviewed.** A fix is not live the moment you push it.
- **The listing is public.** The name uses "GitHub" descriptively rather than as
  a claim of affiliation; if the store or GitHub objects, the fallback is to
  rename the listing and describe the integration in the summary instead.

---

# Firefox Add-ons (AMO)

Free, no registration fee. Mozilla signs the package; you choose whether they
also host it.

## Before anything else: Firefox is unverified

The package builds and passes Mozilla's linter with **zero errors**. Nobody has
run it in Firefox. There is no Firefox e2e suite — `npm run test:e2e` drives
Chromium only — so "it builds" is the whole of the evidence.

Load `.output/firefox-mv2` via `about:debugging` → **This Firefox** → **Load
Temporary Add-on** and actually use it before submitting. The things most
likely to break are the MV2 background page (Chrome gets an MV3 service worker,
Firefox does not) and `storage.session`, which the vault depends on and which
only exists from Firefox 115.

## Listed or self-hosted

- **Listed** — Mozilla hosts it on addons.mozilla.org, public and searchable.
  Least work, and updates are automatic.
- **Unlisted / self-distributed** — Mozilla only signs it; you host the `.xpi`
  and a JSON update manifest yourself, and Firefox auto-updates from your
  `update_url`. No public listing.

Both give real auto-updates. Listed is simpler; pick it unless you specifically
want the add-on unlisted.

## Submitting

1. <https://addons.mozilla.org/developers/> → **Submit a New Add-on**
2. Choose listed or unlisted
3. Upload `.output/a-better-reviewer-1.0.0-firefox.zip`
4. When asked for source code, upload `.output/a-better-reviewer-1.0.0-sources.zip`

Step 4 is **required**, not optional: the submission is bundled and minified, so
a reviewer cannot read it. WXT generates the sources zip during `zip:firefox`
for exactly this reason. Skipping it gets the review rejected.

Reuse the same listing copy and privacy policy from [LISTING.md](LISTING.md).

## Expected lint warnings

`npx web-ext lint --source-dir .output/firefox-mv2` reports 0 errors and ~25
warnings. All of them are expected:

- **23 × `UNSAFE_VAR_ASSIGNMENT`** — `innerHTML` and `insertAdjacentHTML` inside
  the bundled `@pierre/diffs` viewer. Vendor code, which is what the sources zip
  lets a reviewer confirm. The extension's own Markdown path sanitises through
  DOMPurify.
- **2 × `KEY_FIREFOX_*_UNSUPPORTED_BY_MIN_VERSION`** — `data_collection_permissions`
  needs Firefox 140 and the manifest declares a floor of 115. Deliberate; see
  the comment in `wxt.config.ts`.

## The add-on id is permanent

`browser_specific_settings.gecko.id` is `a-better-reviewer@justinmwarner.github.io`.
That string is the add-on's identity forever. Changing it after publishing makes
every existing install a different add-on that stops receiving updates. If it
should live under a PoodlePop domain instead, change it **before** the first
signing, not after.

---

# Edge Add-ons

Free. Uses the same Chromium package as Chrome.

1. <https://partner.microsoft.com/dashboard/microsoftedge/> — register with a
   Microsoft or GitHub account, no fee
2. **Create new extension** → upload `…-chrome.zip`
3. Reuse the listing copy, screenshots and privacy policy from
   [LISTING.md](LISTING.md)

Edge asks for the same permission justifications Chrome does, so the same text
applies. Review is usually faster than Chrome's.

Worth repeating: this listing only reaches people who would not simply install
the Chrome Web Store version in Edge. Publish it if you want Edge users to find
the extension by searching Edge Add-ons; skip it otherwise.

---

# Automating releases

`.github/workflows/release.yml` builds, verifies and submits to every store
whose credentials are configured. Push a version tag and it does the rest.

```bash
npm version patch      # bumps package.json and creates the tag
git push --follow-tags
```

The workflow typechecks, runs the unit suite, runs the e2e suite against a real
Chromium, builds both packages, and submits. It refuses to release if the tag
does not match `package.json` — a mismatch would ship a package whose manifest
disagrees with the release it came from.

## A store is opted in by its secrets

`scripts/submit.mjs` decides which stores are in play by looking at which
secrets are set. Adding a store to your releases means adding its secrets and
nothing else; there is no workflow to edit and no flag to remember.

This is deliberate for Firefox in particular. Nothing has run this extension in
Firefox yet, so releases should not start submitting there until somebody has
decided it is ready.

Repository → Settings → Secrets and variables → Actions.

### Chrome Web Store

| Secret | Where it comes from |
|---|---|
| `CHROME_EXTENSION_ID` | The item's ID, from the developer dashboard URL |
| `CHROME_PUBLISHER_ID` | Account → publisher ID on the dashboard |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | A Google Cloud service account |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | That service account's JSON key, `private_key` field |

Create a Google Cloud project, enable the **Chrome Web Store API**, create a
service account, and download its JSON key. Then invite the service account's
email address as a user on the Chrome Web Store publisher account — the API
call is made *as* that account, so without the invitation it authenticates
fine and then cannot see your item.

Paste the private key including the `-----BEGIN PRIVATE KEY-----` lines and the
newlines. GitHub secrets handle multi-line values; this is why it is passed
through the environment rather than as a command-line flag.

The workflow pins `CHROME_API_VERSION: v2`. The older v1.1 credentials
(`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`) still work
but Google has deprecated them.

### Firefox Add-ons

| Secret | Where it comes from |
|---|---|
| `FIREFOX_EXTENSION_ID` | `a-better-reviewer@justinmwarner.github.io` |
| `FIREFOX_JWT_ISSUER` | AMO → Developer Hub → Manage API Keys |
| `FIREFOX_JWT_SECRET` | Same page |

The sources zip is attached automatically. It is required, not optional — the
submission is minified and AMO cannot review it otherwise.

### Edge Add-ons

| Secret | Where it comes from |
|---|---|
| `EDGE_PRODUCT_ID` | Partner Center, the extension's product ID |
| `EDGE_CLIENT_ID` | Partner Center → Publish API |
| `EDGE_API_KEY` | Same page |

Edge is submitted the Chrome package unchanged.

## Check the credentials without uploading

Actions → Release → **Run workflow**, leaving *dry run* ticked. It authenticates
against every configured store and uploads nothing. Do this once after adding
secrets — a credential problem discovered during a real release leaves you
guessing whether the upload half-happened.

Locally:

```bash
npm run submit:dry
```

## What it does not do

- **It does not create the listing.** The first submission of a new item is
  manual: the description, screenshots, privacy policy and permission
  justifications all have to exist before the API will accept an upload. This
  automates updates, not the initial publication.
- **It does not edit listing copy.** Changing the description or screenshots
  stays a dashboard job.
- **It does not bypass review.** Every submitted update is queued like any
  other.
