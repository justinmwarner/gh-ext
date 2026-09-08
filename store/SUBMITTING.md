# Submitting to the Chrome Web Store

Start to finish, for a first publication. Copy for every field is in
[LISTING.md](LISTING.md); the policy to publish is [PRIVACY.md](PRIVACY.md).

Budget: about 30 minutes of work, then days to weeks of waiting for review.

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

This produces `.output/a-better-reviewer-<version>-chrome-store.zip` (~2.3 MB).

**Use `zip:store`, not `zip`.** The store build omits the manifest `key` field,
which the store rejects on a first upload. `npm run zip` keeps the key for
local unpacked installs.

**Check the manifest matches what the listing claims**, because the permission
justifications describe it:

```bash
node -e "const m=require('./.output/chrome-mv3-store/manifest.json');console.log(JSON.stringify({v:m.version,perms:m.permissions,host:m.host_permissions,cs:m.content_scripts.map(c=>c.matches)},null,1))"
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
