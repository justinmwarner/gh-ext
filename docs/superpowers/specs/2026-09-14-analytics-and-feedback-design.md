# Measurement and feedback, for a product that collects nothing

**Date:** 2026-09-14
**Status:** Approved, being implemented.

## 0. What prompted this, and what turned out to be true

The question was whether more metrics, tracking or logging could be added now
that "Google Analytics is enabled on the extension".

It is not enabled on the extension. It cannot be: the built package was scanned
on 2026-09-14 and contains no Google reference of any kind. The single grep hit
in `.output/chrome-mv3/` was the string `gtags` inside the generated icon table
— GNU GLOBAL's tag file getting a file-type icon, not Google Tag. The manifest
still declares `host_permissions` of `https://github.com/*` and
`https://api.github.com/*` and nothing else, so a beacon would have nowhere to
go even if one existed.

What was actually enabled is the **Additional metrics / Google Analytics 4**
checkbox in the Chrome Web Store developer dashboard. That is Google's own
server-side integration: Google already measures the store listing page,
because it is Google's page, and the checkbox pipes that measurement into a GA4
property the item's developers can read. No tag is injected, nothing is added
to `window`, and probing the extension at runtime will correctly find nothing.

Three consequences, and they set the whole shape of this document:

1. **No disclosure changes are forced.** The extension still transmits nothing
   to its developer. `PRODUCT.md`, `store/PRIVACY.md` and the Firefox
   `data_collection_permissions: { required: ['none'] }` in `wxt.config.ts` all
   remain true exactly as written.
2. **The measurement ceiling is the listing, not the product.** The property
   can show views, traffic sources, geography and the install funnel. It cannot
   show activation or retention, and it cannot show that anybody has ever
   reviewed a pull request.
3. **Going past that ceiling means in-package telemetry**, which was considered
   and declined. `PRODUCT.md` sells collecting nothing as a feature rather than
   offering it as a default, and a promise that is a differentiator is not one
   to spend on a funnel chart.

So the work below does not add measurement to the product. It does the three
things still available to a product that measures nothing: attribute the
traffic it already has, disclose honestly what it now receives, and make the
one remaining qualitative channel — what people tell you — actually work.

## 1. Rejected, and why, so the decisions are on the record

**In-package analytics of any kind.** Per the above.

**`chrome.runtime.setUninstallURL()`.** The real temptation, and worth naming
because it will be suggested again. The Chrome Web Store already reports how
many people uninstalled; it never reports why, and this is the only hook that
could. It is declined on two grounds. It seizes a browser tab at the moment
somebody has decided to be rid of the extension, which is precisely what
`PRODUCT.md`'s *Quiet* personality forbids — "never asks for attention it has
not earned". And it does transmit the fact of an uninstall to a server, which
makes "sends nothing to its developer" false in a way that is hard to explain
away in a policy that currently gets to be absolute.

**Usage counters shown in the product.** `PRODUCT.md`'s anti-references rule out
metric tiles by name. A reviewer does not want a dashboard about their reviewing.

## 2. Attribution — the part that makes the GA4 property worth reading

Without campaign parameters, GA4 files every arrival at the listing under
direct or referral and the property answers almost nothing. Every link to the
listing that lives in this repository therefore carries UTM parameters, so the
README, the policy and the store listing can be told apart:

```
?utm_source=github&utm_medium=readme
?utm_source=github&utm_medium=privacy-policy
```

This repository can only reach its own links. The dashboard fields, the GitHub
repository's homepage field and anything posted elsewhere are outside it, and
are listed in §7 as work for a human.

## 3. Honesty about the property itself

The extension collects nothing; the developer nevertheless now receives
aggregate statistics about the listing page. Those two facts are compatible,
and `store/PRIVACY.md` says one of them and not yet the other.

A single sentence is added stating that Google provides aggregate statistics
about the Chrome Web Store listing page, and that this is Google measuring its
own page rather than the extension measuring the reader. The existing
paragraph — "There is no analytics, no telemetry, no crash reporting" — stays,
because it is a claim about the extension and is still true; it is made
explicit that it is a claim about the extension.

This costs a line. For a product whose pitch is zero collection, an undisclosed
analytics property discovered later would cost considerably more, and the fact
that it is listing-only is a much better sentence to write before somebody asks
than after.

## 4. Feedback routing

Two channels, each for what it is good at.

**Bugs and feature requests go to GitHub issues** at `justinmwarner/gh-ext`.
The repository is already public and already named in the privacy policy as the
place the extension's claims can be checked, so it costs no new infrastructure
and it puts reports where the code is. There are no issue templates today —
`.github/` holds only `workflows/` — so two forms are added, plus a `config.yml`
pointing anything that is not a bug at the contact address.

**`reviewer@juwar.io` is the contact of record**, not the bug queue. It fills
the `TODO` in `store/PRIVACY.md`, where the policy currently promises a contact
address and then does not give one, and it becomes the Chrome Web Store
listing's support email so the two agree.

Both routes are named in the README and in the store listing body, so they are
findable before install rather than only after.

In the product itself the two links go in the **Diagnostics** section of the
options page, which already exists. They are plain text links. Nothing is added
to the review page: that is where the work happens, and `PRODUCT.md`'s *Quiet*
rule and its "no badges, no tours" anti-reference both apply.

## 5. Local diagnostics — the part that makes an issue worth receiving

With usage invisible, reports are the only qualitative signal, and their
quality is the bottleneck. A report saying "it doesn't work" cannot be acted
on. So the product helps the reviewer write a good one, without sending
anything.

### 5.1 A retained warning buffer in `lib/log.ts`, and a message to read it

Today `logWarn` discards everything unless `debugLogging` is on, across 21
production call sites. That is right for the console and wrong for a bug
report: by the time somebody decides to report a problem, the warning that
explains it has already been thrown away, and the instruction in the existing
hint — turn logging on, reproduce, turn it back off — asks them to reproduce a
thing that may not reproduce.

A bounded ring buffer of the last 50 entries retains them in memory regardless
of the setting. Console output stays gated exactly as it is now, so the file's
existing argument survives intact: the console still belongs to whoever opened
it. What changes is retention, not output.

It stays in `lib/`, which keeps it pure and testable under Node. Memory only —
nothing is written to storage, so nothing outlives the session or reaches disk.

Each entry is capped at 500 characters. No call site today comes near it — they
all pass a sentence and an `Error` — but an unbounded retained buffer is an
allocation waiting for somebody to log a payload, and the text ends up in a
document somebody pastes in public. Only retention is truncated; the console
still gets the arguments whole, because it was asked for and it is local.

**Module state is per context, and that changes the design.** The options page
has its own copy of `lib/log.ts` and can only see what it logged itself, while
the warnings a bug report is usually about are the worker's — it makes every
GitHub request. So a `get-warnings` kind is added to the protocol and the report
asks the worker for its buffer across the boundary.

The two are then printed under separate headings rather than concatenated.
There is no clock shared between the contexts, so a merged list would be
claiming an order it does not have, and which side of the boundary a warning
came from is itself worth knowing.

### 5.2 A diagnostics report, assembled in `lib/diagnostics.ts`

A new pure module assembles a short Markdown block from values it is handed:

- extension version, browser and version, platform
- whether a token is stored, whether it is encrypted, and whether it is
  currently unlocked — **never the token**
- the settings that affect rendering, which is what a "the diff looks wrong"
  report needs
- the retained warnings

Taking its inputs as arguments rather than reading `chrome.*` is what keeps it
in `lib/`; the options page is the adapter that gathers them.

### 5.3 Shown before it is copied, and scrubbed

Warnings carry repository names, pull request titles and file paths. A person
pasting this into a public issue is publishing it, so the report is rendered in
a readonly textarea and the reviewer reads what they are about to hand over
before they hand it over. Token-shaped strings — `ghp_`, `github_pat_`, and
the `Bearer` form — are redacted defensively, because the cost of being wrong
once about whether a credential can reach a log is a leaked credential in a
public issue.

### 5.4 Not prefilled into the issue URL

GitHub accepts `issues/new?body=`, and putting the report there would be one
click fewer. It is not done: browsers and GitHub both cap URL length, and the
failure mode is silent truncation — a report that looks complete and has had
its ending removed. The template fields are prefilled; the report goes on the
clipboard and the reviewer pastes it into the body, where they can see all of
it.

### 5.5 Which install this is, on the page and in the report

Added after the first build was tested, because testing it produced the exact
failure it prevents: the changes were loaded, the extension was reloaded, and
nothing appeared to have changed.

The cause is that the store's copy and a locally loaded one are separate
installs with separate ids, running side by side, and both say version 1.0.3.
A version number alone cannot tell them apart, so reloading one and reading the
other looks identical to a build that did not take.

So the options page shows `Version <version> · <runtime.id>` under its title,
and the report carries the id as well. The id is the discriminating fact; the
version is what a reviewer is actually asked for. The bug report form asks for
the version in its own field on top of the report, so that a version can be
searched across issues without opening each one.

## 6. What is being changed

| File | Change |
| --- | --- |
| `store/PRIVACY.md` | Contact address; listing-analytics disclosure; updated date |
| `store/LISTING.md` | Support section; support email field |
| `README.md` | Support section; UTM on the store link |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | New |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | New |
| `.github/ISSUE_TEMPLATE/config.yml` | New — points non-bugs at the address |
| `lib/log.ts` | Ring buffer; per-entry cap; `recentWarnings()`; `clearWarnings()` |
| `lib/log.test.ts` | Retention under both settings; bound; cap; isolation |
| `lib/messages.ts` | A `get-warnings` kind, so the page can read the worker's buffer |
| `entrypoints/background.ts` | Answers it |
| `lib/diagnostics.ts` | New — assembles and scrubs the report |
| `lib/diagnostics.test.ts` | New — redaction, shape, empty cases |
| `entrypoints/options/main.tsx` | Two links, a diagnostics control, the build line |
| `entrypoints/options/style.css` | `.build`, and the title's margin moved onto it |
| `e2e/dashboard.spec.ts` | One locator narrowed — see below |

The e2e change is not incidental. `getByText('Private')` matches a
case-insensitive *substring* across the whole page, so the options page's copy
of the private-pill test broke the moment the Diagnostics hint said "a private
repository". It now locates `.repos-tag`, which is rendered for private
repositories and nothing else. The dashboard's copy of the same test is left
alone: that page carries none of this prose, and narrowing a test that is not
failing is churn.

## 7. Work this repository cannot do

- Set the Chrome Web Store listing's support email to `reviewer@juwar.io`, so
  it matches the policy.
- Set the GitHub repository's homepage field to the UTM-tagged listing URL.
- Confirm the GA4 property is receiving data. It should, since Google populates
  it, but it can take a day to appear.
- Decide whether the Firefox add-on is listed on AMO. If it is, AMO's own
  statistics dashboard is a second free measurement surface, entirely separate
  from the Chrome one, and nothing here touches it.
- Capture GitHub's repository traffic periodically if the trend matters:
  Insights → Traffic is a rolling 14-day window and expires.

## 8. The number worth watching

Not anything in GA4. The Chrome Web Store developer dashboard reports weekly
users alongside total installs, and that ratio is the only retention signal
available to a product that measures nothing. The listing property measures
people who have not installed yet; this measures whether the ones who did kept
it.
