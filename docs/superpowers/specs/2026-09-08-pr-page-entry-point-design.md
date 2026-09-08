# The Pull Request Page Entry Point — Design

**Date:** 2026-09-08
**Status:** Approved, not yet implemented

## Goal

Make starting a review the obvious thing to do on a GitHub pull request page,
and make the entry point appear every time rather than most of the time.

Two complaints, one of them a bug:

1. The button is often absent until the page is reloaded.
2. When it is there it sits in the header, quiet and easy to miss, which is the
   wrong treatment for what should be the default action.

Plus a request: a setting that opens the review automatically, somewhere that
leaves the GitHub page still usable.

## The bug

`entrypoints/content.ts` declares `matches: ['https://github.com/*/*/pull/*']`.
Chrome decides whether to inject a content script from the URL **the document
was loaded at**. GitHub is a single-page app, so arriving at a pull request from
the pull request list, the repository home, a notification or a search result is
a `pushState` navigation — the document was loaded at a non-matching URL and the
script is never injected at all.

The `wxt:locationchange` handler cannot save this. It is not running, because
nothing loaded it. Reloading loads the document at a matching URL, the script
injects, and the button appears. That is the reported symptom exactly.

This is not a timing problem, and no amount of grace period or mutation
observation addresses it.

## Scope

### 1. A floating card, not a header button

The entry point becomes a card pinned to the bottom-right corner of the page,
above everything, rendered into a shadow root via WXT's `createShadowRootUi`
(`cssInjectionMode: 'ui'`). GitHub's stylesheet cannot reach into it and its
styles cannot leak out.

Two states:

- **Expanded** — the extension name, one large primary button reading **"Start
  a Better Review"**, and a `×`.
- **Collapsed** — a small pill. Clicking it expands the card again.

The card is deliberately plain. It carries no pull request summary: everything
it could show is already on the page behind it, and a count that disagrees with
GitHub's own is worse than no count.

Collapse state is stored in `storage.local` under its own key, **not** inside
the settings object. The content script writes it on every toggle while the
options page writes settings, and separate keys mean neither read-modify-write
can clobber the other.

Theme follows the OS through `color-scheme: light dark` and `light-dark()`, as
the options page already does, and additionally mirrors `<html
data-color-mode>` when GitHub sets it. A missing attribute falls back to the OS,
so that one coupling to GitHub markup cannot break anything.

The card renders on every pull request page whether or not auto-open is on.
Without it, closing the review tab would leave no way back.

### 2. Injection that survives soft navigation

`matches` becomes `['https://github.com/*']`. `sync()` already no-ops when
`parsePrUrl` returns null, so the script is present on the document *before* the
soft navigation happens, and `wxt:locationchange` fires as intended.

No new permission. `host_permissions` already carries `https://github.com/*`, so
the install prompt is unchanged — which matters, because a public store listing
is imminent.

A card that owns its own corner needs no anchor, so the following all go:

- `ANCHOR_SELECTORS`, `findAnchor`, `mountFallback`
- `ANCHOR_GRACE_MS`, `anchorMissLogged`, `anchorWarningTimer`
- `RESYNC_DEBOUNCE_MS` and the body-wide `MutationObserver`

Every one of them exists to find and hold a place in GitHub's header. Deleting
them removes the entire "GitHub renamed a class" failure mode along with the
cost of observing mutations on a busy page. This change is a net deletion.

### 3. Where the review opens

`open-review` gains `reason: 'click' | 'auto'`. `OpenReviewAck` gains
`reused: boolean` alongside its existing `tabId`.

The worker resolves a destination through a new pure module,
`lib/review/openTarget.ts`. Given the settings, the reason, the registry of
review tabs already open and the sending tab, it returns one of:

```ts
| { kind: 'focus'; tabId: number }
| { kind: 'create-tab'; url: string; active: boolean; openerTabId: number; index: number }
| { kind: 'create-window'; url: string; focused: boolean }
| { kind: 'update-tab'; tabId: number; url: string }
```

`entrypoints/background.ts` executes the action and holds no policy of its own,
matching how `lib/github/assembly.ts` already relates to the worker. `focus`
carries only a tab id because the window it lives in is not knowable when the
decision is made; the worker reads `windowId` off the `tabs.get` it already
performs to confirm the tab exists. `Tab.windowId` is populated without the
`tabs` permission.

Focus follows the reason: `active`/`focused` is true for `'click'` and false for
`'auto'`. Clicking is a deliberate act, so it goes there; auto-open prepares the
tab without yanking you out of whatever you were typing on GitHub.

A new tab is created with `openerTabId: sender.tab.id` and `index:
sender.tab.index + 1`, so it lands immediately beside the pull request it came
from. `sender.tab` is populated without the `tabs` permission.

### 4. Dedupe without the `tabs` permission

`docs/superpowers/specs/2026-09-08-store-listing-and-token-encryption-design.md`
drops the `tabs` permission, on the grounds that navigation needs no permission
and nothing reads `url`, `title` or `favIconUrl` off a tab. Finding an existing
review tab by URL would need `tabs.query({ url })`, which is exactly the call
that requires it. So the lookup does not use URLs.

Instead the worker keeps its own registry: `Map<prKey, tabId>` for review tabs
it opened, persisted in `storage.session` so it survives the worker being killed
and restarted. Entries are pruned on `tabs.onRemoved` and existence is confirmed
with `tabs.get`. Focus is `tabs.update(tabId, { active: true })` followed by
`windows.update(windowId, { focused: true })`.

`tabs.create`, `tabs.update`, `tabs.get`, `tabs.onRemoved`, `windows.create` and
`windows.update` all work unpermissioned. **No manifest permission change.**

`storage.session` rather than `local` on purpose: a tab id is meaningless across
a browser restart, and the cache already lives there for the same reason.

**Accepted limitation.** The registry records what a tab was *opened* as. Editing
the hash by hand inside a review tab desyncs it, and the worker may then focus a
tab showing a different pull request. The review page could register its current
pull request to correct this, but it offers no navigation from one pull request
to another, so the desync has no route into normal use. Revisit if that changes.

### 5. Auto-open

Off by default. A window or tab that appears unasked on someone's first pull
request reads as a malfunction, so this is opt-in.

When on, the content script sends `open-review` with `reason: 'auto'` once it has
a pull request ref, subject to three guards:

1. **Once per pull request per tab.** Tracked the way `prefetchedKey` already is,
   so moving between the Conversation and Files tabs of the same pull request
   does not re-fire.
2. **Only when the pull request tab is visible.** If `document.visibilityState`
   is `'hidden'`, wait for `visibilitychange`. Without this, middle-clicking
   eight pull requests out of the list spawns eight review tabs nobody asked
   for.
3. **Never duplicates.** The worker's registry covers a review tab that is
   already open.

### 6. Settings and the options page

A new pure module, `lib/settings.ts`:

```ts
export type OpenIn = 'new-tab' | 'new-window' | 'same-tab';

export interface Settings {
  openIn: OpenIn;
  autoOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = { openIn: 'new-tab', autoOpen: false };
```

Stored as one JSON value under `settings` in `storage.local`. `parseSettings`
merges over the defaults and discards unrecognized values, so a corrupt blob, or
one written by a later version, degrades to defaults instead of throwing inside
the worker.

`new-tab` is the default rather than today's `same-tab`: the GitHub page stays
interactive, which is the whole point of the request. `same-tab` remains
available for anyone who treats the review as a replacement for the pull request
page.

The options page gains a **Reviewing** section above the token section:

- "Open reviews in" — a radio group: New tab (default) / New window / Same tab.
- "Open automatically when I land on a pull request" — a checkbox, default off,
  with a hint that the auto-opened tab opens in the background.

`isTokenChange` already keys on `TOKEN_KEY` **and** the storage area, so a
settings write cannot be misread as the reviewer signing out and flush a warm
cache. That is currently true by accident of the key check; a test pins it.

## Module layout

```
entrypoints/content/index.ts    entry: URL watching, messaging, auto-open guards
entrypoints/content/card.ts     the card: shadow-root DOM, collapse state, styles
lib/settings.ts                 pure: defaults, parse, validate
lib/review/openTarget.ts        pure: settings + reason + registry + sender -> action
entrypoints/background.ts       executes the action, owns the tab registry
entrypoints/options/main.tsx    the Reviewing section
```

`entrypoints/content.ts` becomes a directory so the card's DOM does not share a
file with the navigation and messaging logic. The card builder stays out of
`lib/`, which is pure by rule — no DOM, no `browser.*` — and out of `ui/`, which
is React. It is plain DOM: a title, a button and a pill do not justify pulling
React into a content script that runs on every GitHub page.

The two new `lib/` modules exist so the decisions worth getting right — what the
settings mean, and where a review opens — test in Node with no browser, which is
how `lib/` is already used here.

## Error handling

Unchanged in kind. The content script's existing `guard` and `send` log through
`[a-better-reviewer]` and stop. Two additions:

- A failed `tabs.create` or `windows.create` returns through the existing `Err`
  channel, and the card shows a brief inline failure rather than appearing to do
  nothing.
- Auto-open failures go to the console only. An action the reviewer did not
  request must not put an error banner on github.com.

## Testing

- `lib/settings.test.ts` — defaults, a partial object, a corrupt value, an
  unrecognized `openIn`.
- `lib/review/openTarget.test.ts` — the four actions across both reasons and all
  three destinations, plus a registry hit and a registry miss.
- `entrypoints/content/card.test.ts`, under the existing jsdom project — mount,
  collapse, expand, restore from stored state, and teardown when the tab leaves
  a pull request.
- `entrypoints/background.ts` registry — pruning on `tabs.onRemoved`, and a
  `tabs.get` rejection for a tab that is gone.

End to end, against the production build as the suite already insists:

- The stub page at `e2e/extension.ts:326` currently serves nothing but a
  `.gh-header-actions` div. It is replaced by a page that can `history.pushState`
  between a non-pull-request URL and a pull request URL, so a test can prove the
  card appears on a soft navigation. **This is the regression test for the actual
  bug** and the suite has no equivalent today.
- The two tests targeting `#a-better-reviewer-open-button`
  (`e2e/review.spec.ts:110` and `:1274`) move to the card.
- Clicking opens a second tab with the GitHub tab still alive and still on the
  pull request.
- Clicking again focuses the first review tab instead of opening a third.
- Collapse survives a reload.

## Rejected alternatives

**Keep the narrow match and inject from the worker.**
`webNavigation.onHistoryStateUpdated` plus `scripting.executeScript` would run
the script only on pull request pages. It costs the `scripting` and
`webNavigation` permissions, both of which read as broad on an install prompt
and both of which would have to be justified in a store listing that is actively
being trimmed. It also needs double-injection guards and a worker that may be
asleep when the navigation fires. Broadening the match costs nothing and adds no
permission, and the script does nothing on a page whose URL does not parse.

**Add the entry point to GitHub's pull request tab bar.** Semantically the best
fit — it is another way to view the pull request — but it reintroduces exactly
the anchor-selector fragility this design removes.

**Show a pull request summary on the card.** The worker is already prefetching
the data, so it would be nearly free. Cut anyway: it duplicates what the page
behind it says, and a stale count is worse than no count.

**Reuse one review tab across every pull request.** Keeps the tab strip tidy at
the cost of losing the review you were in the middle of. One tab per pull
request, deduped.

## Not doing

A toolbar icon. A keyboard shortcut. Per-pull-request dismissal of the card.
Keeping the header button alongside the card. Registering the review page's
current pull request with the worker.
