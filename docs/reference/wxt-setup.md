# WXT + React 19 + TypeScript — MV3 Setup Reference

**Verified against WXT `0.21.4`** (latest stable on npm at time of writing)
**Date:** 2026-09-01
**Verification method:** Every claim below marked "verified" was checked by actually scaffolding
`wxt@0.21.4` with the `react` template into a scratch directory, adding the exact entrypoint shape
this project needs (PR content script + background SW + `review.html` + options page), then running
`wxt build`, `wxt` (dev), `wxt prepare`, `tsc --noEmit`, and `vitest run`, and reading the generated
`manifest.json` / `.wxt/` output and the emitted bundle chunks.

Anything I could not confirm from a primary source or a real build is explicitly marked
**UNVERIFIED**.

## Sources actually read

- npm registry, via `npm view`: `wxt`, `@wxt-dev/module-react`, `react`, `react-dom`,
  `@types/react`, `@types/react-dom`, `typescript`, `vite`, `vitest`, `web-ext`,
  `@playwright/test`, `shiki`, `@shikijs/engine-javascript`, `@shikijs/engine-oniguruma`,
  `@webext-core/messaging`, `react-router`.
- `wxt-dev/wxt` repo @ `main` (via `gh api`):
  - `docs/guide/installation.md`
  - `docs/guide/essentials/entrypoints.md`
  - `docs/guide/essentials/project-structure.md`
  - `docs/guide/essentials/content-scripts.md`
  - `docs/guide/essentials/messaging.md`
  - `docs/guide/essentials/storage.md`
  - `docs/guide/essentials/frontend-frameworks.md`
  - `docs/guide/essentials/extension-apis.md`
  - `docs/guide/essentials/es-modules.md`
  - `docs/guide/essentials/unit-testing.md`
  - `docs/guide/essentials/e2e-testing.md`
  - `docs/guide/essentials/config/{manifest,typescript,vite,browser-startup,auto-imports}.md`
  - `docs/guide/resources/{upgrading,compare}.md`
  - `templates/react/{package.json,tsconfig.json,wxt.config.ts}`
  - `packages/wxt/src/core/utils/manifest.ts` (CSP + dev-mode manifest generation — source of truth)
  - `packages/wxt/src/core/builders/vite/plugins/defineImportMeta.ts`
  - `packages/wxt/CHANGELOG.md`
- `wxt-dev/wxt` issues: [#2599](https://github.com/wxt-dev/wxt/issues/2599) (open),
  [#2032](https://github.com/wxt-dev/wxt/issues/2032) (open),
  [#942](https://github.com/wxt-dev/wxt/issues/942) (open),
  [#1424](https://github.com/wxt-dev/wxt/issues/1424) (closed),
  [#357](https://github.com/wxt-dev/wxt/issues/357) (open).
- `wxt-dev/examples` repo @ `main`: `web-worker-setup/`, `playwright-e2e-testing/`,
  `basic-messaging/`, `background-message-forwarder/`, `content-script-session-storage/`.
- Chrome docs (via search): [Web Accessible Resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources).
- Locally installed `node_modules`: `wxt/package.json` exports map, `wxt/dist/browser.d.mts`,
  `@wxt-dev/module-react/dist/index.{mjs,d.mts}`, generated `.wxt/tsconfig.json`,
  `.wxt/types/paths.d.ts`, `.wxt/types/imports-module.d.ts`.

---

## 1. Current versions

**Latest stable `wxt`: `0.21.4`.** (`npm dist-tags`: `latest = 0.21.4`, `next = 0.20.0-beta2` —
the `next` tag is stale, ignore it.)

**React integration: `@wxt-dev/module-react@1.2.2`.** Its declared peers are
`wxt >= 0.19.16` and `vite ^5.4.19 || ^6.3.4 || ^7.0.0 || ^8.0.0-0`; it depends on
`@vitejs/plugin-react ^4.4.1 || ^5.0.0 || ^6.0.0`.

**React 19 is supported.** Verified two ways: (a) the official `templates/react/package.json` in the
WXT repo pins `react`/`react-dom` at `^19.2.4` and `@types/react` at `^19.2.14`; (b) I built and
type-checked a React 19.2.8 project against `@wxt-dev/module-react@1.2.2` successfully.

### `wxt@0.21` runtime requirements (from the official upgrade guide, verified)

| Tool       | Requirement                          |
| ---------- | ------------------------------------ |
| Node.js    | `>=22` (engines field)               |
| Vite       | `^6.3.4 \|\| ^7.0.0 \|\| ^8.0.0-0`   |
| TypeScript | `>=5.4`                              |
| web-ext    | `>=9.2.0` (optional)                 |

**Important 0.21 change:** `vite`, `web-ext`, and `typescript` are now **peer dependencies**, not
bundled dependencies. `vite` is a **required** peer. The official React template does *not* list
`vite` in `devDependencies` (npm 7+ auto-installs peers, which is why the template still works —
I confirmed `vite@8.2.2` was auto-hoisted to `node_modules/vite`). **Add `vite` explicitly** so
pnpm/yarn and lockfile reproducibility behave. `web-ext` must be installed for `wxt` (dev) to open a
browser automatically; without it that feature silently disables.

### `package.json` dependency block

```json
{
  "name": "gh-ext",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-router": "^8.3.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.5",
    "@wxt-dev/module-react": "^1.2.2",
    "happy-dom": "^20.12.0",
    "typescript": "^5.9.3",
    "vite": "^8.2.2",
    "vitest": "^4.1.11",
    "web-ext": "^10.6.0",
    "wxt": "^0.21.4"
  }
}
```

Notes on the pins:

- `react-router@8.3.1` is latest and declares peers `react >= 19.2.7`, `react-dom >= 19.2.7` — so
  React 19.2.8 satisfies it. Use the `react-router` package (v7+ merged `react-router-dom` in;
  `react-router-dom` is stuck at `7.18.3`). `createHashRouter` lives in `react-router`.
- `typescript` latest on npm is **`7.0.2`**, which nominally satisfies WXT's `>=5.4` peer range.
  **I did not test TS 7 against WXT.** The official template pins `^5.9.3`, and that is what I
  verified `tsc --noEmit` with. Recommend `^5.9.3`; treat TS 7 as **UNVERIFIED**.
- If you add Shiki: `shiki@^4.4.3` — see §7 for the engine choice, which is load-bearing.

---

## 2. Init command

Verified interactively and non-interactively.

```sh
# Interactive (prompts for directory, template, package manager)
npx wxt@latest init

# Non-interactive — this is the exact command I ran and confirmed works
npx wxt@0.21.4 init gh-ext -t react --pm npm
cd gh-ext
npm install     # runs `wxt prepare` via postinstall
```

`wxt init --help` (verified output) exposes exactly two meaningful flags:

```
Usage:
  $ wxt init [directory]

Options:
  -t, --template <template>  template to use
  --pm <packageManager>      which package manager to use
```

**Template to choose: `react`.** Available templates in the repo are `vanilla`, `vue`, `react`,
`svelte`, `solid`. **All WXT templates are TypeScript by default** — there is no separate
"react-ts" template. The `react` template ships `tsconfig.json`, `.ts`/`.tsx` entrypoints, and
`"compile": "tsc --noEmit"`.

> **Gotcha (verified the hard way): the dev command is `wxt`, not `wxt dev`.**
> The CLI signature is `wxt [root]`, so `npx wxt dev` is parsed as "run the dev server with root
> directory `./dev`" and fails with `No entrypoints found in .../dev/entrypoints`. The template's
> `package.json` correctly maps `"dev": "wxt"`.

---

## 3. Directory layout

WXT discovers entrypoints purely by **filename convention** inside `entrypoints/`. Entrypoints must
be **zero or one level deep** — a file `entrypoints/{name}.{ext}` or a directory
`entrypoints/{name}/index.{ext}`. Deeper nesting is not scanned.

Conventions for the four pieces this project needs (all verified against a real build):

| Piece | Recognized filename(s) | Output |
| --- | --- | --- |
| **Content script** with a match pattern | `entrypoints/{name}.content.ts` **or** `entrypoints/{name}.content/index.ts` (also plain `content.ts` / `content/index.ts`) | `content-scripts/{name}.js` |
| **Background service worker** | `entrypoints/background.ts` **or** `entrypoints/background/index.ts` | `background.js` |
| **Named non-popup HTML page** (`review.html`) | `entrypoints/review.html` **or** `entrypoints/review/index.html` | `review.html` at the output root |
| **Options page** | `entrypoints/options.html` **or** `entrypoints/options/index.html` | `options.html` + `options_ui` in the manifest |

### How you get `review.html` (the key answer)

`review.html` is an **"unlisted page"** in WXT's terminology — an HTML entrypoint whose filename is
not one of WXT's reserved names (`popup`, `options`, `background`, `newtab`, `history`,
`bookmarks`, `devtools`, `sandbox`, `sidepanel`). You do **not** register it anywhere. Just create
`entrypoints/review/index.html` and WXT emits `.output/chrome-mv3/review.html`, reachable at
`chrome-extension://{id}/review.html`. It is deliberately absent from `manifest.json` — that is
correct and expected for a page you navigate to yourself.

Because you want a React SPA with sibling files (`main.tsx`, `App.tsx`, `routes/`), use the
**directory form** (`entrypoints/review/index.html`), not the single-file form.

> **Do NOT** put `review.tsx` or `review.css` directly in `entrypoints/` next to `review.html`.
> WXT would treat each as its own entrypoint and try to build it (`review.tsx` would become an
> "unlisted script"). Always use a directory. This is called out as a `:::danger` block in the
> official entrypoints doc.

### Real directory tree

```
gh-ext/
├─ .output/                       # build artifacts (gitignored)
│  ├─ chrome-mv3/                 # `wxt build`  -> load this for prod/e2e
│  └─ chrome-mv3-dev/             # `wxt` (dev)  -> load this while developing
├─ .wxt/                          # generated types + tsconfig (gitignored)
│  ├─ tsconfig.json
│  ├─ wxt.d.ts
│  └─ types/
│     ├─ globals.d.ts
│     ├─ imports.d.ts
│     ├─ imports-module.d.ts
│     └─ paths.d.ts               # <- generates the type-safe getURL() overloads
├─ assets/                        # processed by Vite (CSS, images imported from code)
├─ components/                    # auto-imported
├─ hooks/                         # auto-imported (React/Solid convention dir)
├─ utils/                         # auto-imported — put storage items, api client, msg types here
│  ├─ storage.ts
│  ├─ messages.ts
│  └─ __tests__/
├─ public/                        # copied verbatim; icons discovered here
│  └─ icon/
│     ├─ 16.png  32.png  48.png  96.png  128.png
├─ entrypoints/
│  ├─ background.ts                       -> background.js  (MV3 service_worker)
│  ├─ github-pr.content/                  -> content-scripts/github-pr.js
│  │  ├─ index.ts                         #  matches https://github.com/*/*/pull/*
│  │  └─ style.css
│  ├─ review/                             -> review.html   (NOT in manifest — unlisted page)
│  │  ├─ index.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  ├─ router.tsx
│  │  └─ routes/
│  └─ options/                            -> options.html  (manifest.options_ui)
│     ├─ index.html
│     └─ main.tsx
├─ e2e/                           # Playwright
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ playwright.config.ts
├─ web-ext.config.ts              # gitignored by the template
└─ wxt.config.ts
```

Icon discovery is automatic from `public/`: `icon/{size}.png`, `icon-{size}.png`,
`icon-{size}x{size}.png`, `icon@{size}w.png` etc. all match. Verified — my build produced a correct
`icons` map with zero config.

### Entrypoint file contents

`entrypoints/background.ts`:

```ts
export default defineBackground({
  type: 'module', // MV3 only; emits "type": "module" and enables code-splitting
  main() {
    // ALL runtime code must live inside main() — see the caveat below.
  },
});
```

`entrypoints/github-pr.content/index.ts`:

```ts
export default defineContentScript({
  matches: ['https://github.com/*/*/pull/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui', // only if you use createShadowRootUi
  main(ctx) {
    // ...
  },
});
```

`entrypoints/review/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PR Review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

> `type="module"` on the `<script>` tag is **required** — Vite only bundles HTML page scripts as ESM.

`entrypoints/options/index.html` — same shape, plus HTML `<meta>` tags become manifest options:

```html
<head>
  <title>GH Ext Options</title>
  <meta name="manifest.open_in_tab" content="true" />
</head>
```

Verified: that meta tag produced `"options_ui": { "open_in_tab": true, "page": "options.html" }`.

> **Critical WXT constraint (from the official docs, and it will bite you):** WXT imports every
> JS/TS entrypoint file into **Node.js** during the build to read its options. `browser.*` is
> polyfilled there with `@webext-core/fake-browser`, and most APIs throw `not implemented`.
> Never put runtime code at module top level in `background.ts`, `*.content.ts`, or unlisted
> scripts — it must be inside `main()`. HTML entrypoints are exempt (they are not imported into
> Node).

---

## 4. `wxt.config.ts`

### How WXT generates the manifest

There is **no `manifest.json` in your source tree.** WXT composes it at build time from four
inputs (per `docs/guide/essentials/config/manifest.md`, confirmed against
`packages/wxt/src/core/utils/manifest.ts`):

1. `manifest` in `wxt.config.ts` — hand-written, verbatim passthrough.
2. Per-entrypoint options — `defineContentScript({ matches })`, `defineBackground({ type })`, and
   `<meta name="manifest.*">` tags in HTML entrypoints.
3. WXT modules (e.g. `@wxt-dev/module-react`, `@wxt-dev/auto-icons`).
4. `hooks` (`build:manifestGenerated`, etc.).

**Derived automatically (do not hand-write):**

| Manifest key | Derived from |
| --- | --- |
| `manifest_version` | `--mv3`/`--mv2` flag; **defaults to MV3 for Chrome**. Do not set it manually — it is not a `manifest` config key. |
| `name` | `manifest.name`, else `package.json#name` |
| `version` / `version_name` | `package.json#version` (cleaned / verbatim) |
| `icons` | filename scan of `public/` |
| `background.service_worker` + `background.type` | presence of `background.ts` + `defineBackground({ type })` |
| `content_scripts[]` | `defineContentScript` options (**production builds only** — see §8) |
| `options_ui.page` | presence of `entrypoints/options/` |
| `action` / `default_popup` | presence of `entrypoints/popup/` (we have none, so no `action` key) |
| `web_accessible_resources` for content-script CSS | `cssInjectionMode: 'ui'` |
| `permissions: ["tabs","scripting"]`, `host_permissions: ["http://localhost/*"]`, dev CSP, `commands.wxt:reload-extension` | dev mode only |

**Hand-written (must be in `manifest`):** `permissions`, `host_permissions`,
`content_security_policy`, `web_accessible_resources`, `description`, `default_locale`,
`browser_specific_settings`.

### Complete config for this project

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: 'GitHub PR Review',
    description: 'Richer pull request review UI for github.com',

    // chrome.storage.local + chrome.storage.session both come from this one permission.
    permissions: ['storage'],

    host_permissions: [
      'https://github.com/*',      // content script + page fetches
      'https://api.github.com/*',  // REST + GraphQL, called from the background SW
    ],

    // MUST be set explicitly if you need WASM. WXT only writes a CSP during `wxt dev`;
    // production builds emit NO content_security_policy key at all unless you provide one.
    // See §7 — omit this line ONLY if nothing in the extension pages instantiates WebAssembly.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },

    // ONLY needed if the content script itself navigates the tab to review.html
    // (window.open / location.href / <a href>). Not needed if the background opens
    // the tab via chrome.tabs.create — see §5.
    web_accessible_resources: [
      {
        matches: ['https://github.com/*'],
        resources: ['review.html'],
      },
    ],
  },

  // Optional: pass options through to @vitejs/plugin-react
  // react: { vite: { /* @vitejs/plugin-react options */ } },
});
```

**Verified production output** of exactly that config (`.output/chrome-mv3/manifest.json`):

```json
{
  "manifest_version": 3,
  "name": "GitHub PR Review",
  "description": "Richer pull request review UI for github.com",
  "version": "0.0.0",
  "icons": { "16": "icon/16.png", "32": "icon/32.png", "48": "icon/48.png", "96": "icon/96.png", "128": "icon/128.png" },
  "permissions": ["storage"],
  "host_permissions": ["https://github.com/*", "https://api.github.com/*"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "web_accessible_resources": [
    { "matches": ["https://github.com/*"], "resources": ["review.html"] }
  ],
  "background": { "type": "module", "service_worker": "background.js" },
  "options_ui": { "open_in_tab": true, "page": "options.html" },
  "content_scripts": [
    {
      "matches": ["https://github.com/*/*/pull/*"],
      "run_at": "document_idle",
      "js": ["content-scripts/github-pr.js"]
    }
  ]
}
```

Notes:

- `web_accessible_resources` **must** be written in MV3 object form (`{ matches, resources }`).
  WXT throws a build error on bare-string MV2 form and downconverts to MV2 for you if you ever
  target Firefox MV2.
- `manifest_version: 3` is **not** something you put in the `manifest` object. It comes from the
  build target. Chrome defaults to MV3.
- Listing `review.html` in `web_accessible_resources` makes your extension **fingerprintable** by
  github.com (it can probe `chrome-extension://{id}/review.html`). Chrome's `use_dynamic_url: true`
  mitigates that but randomizes the URL per session, which breaks a stable link. Prefer the
  background-opens-the-tab approach in §5 and drop the WAR entry entirely.

Optional `web-ext.config.ts` (gitignored by the template) to keep a persistent dev profile on
Windows:

```ts
import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  // On Windows the profile path must be absolute
  chromiumProfile: resolve('.wxt/chrome-data'),
  keepProfileChanges: true,
  // disabled: true,  // don't auto-launch a browser at all
});
```

---

## 5. Getting the extension page URL

There is **no bespoke WXT helper** for building extension URLs. You use the standard
`browser.runtime.getURL(...)` — but WXT makes it **type-safe**, which is a genuine win here.

`wxt prepare` generates `.wxt/types/paths.d.ts`, which for my test project contained (verbatim):

```ts
declare module "wxt/browser" {
  export type PublicPath =
    | ""
    | "/"
    | "/background.js"
    | "/content-scripts/github-pr.js"
    | "/icon/128.png"
    /* ...icons... */
    | "/options.html"
    | "/review.html"
    | "/wxt.svg"
  type HtmlPublicPath = Extract<PublicPath, `${string}.html`>
  export interface WxtRuntime {
    getURL(path: PublicPath): string;
    getURL(path: `${HtmlPublicPath}${string}`): string;
  }
}
```

Two consequences:

1. `browser.runtime.getURL('/review.html')` is **compile-time checked** against real build outputs.
   Typo the filename and `tsc --noEmit` fails.
2. The second overload, `` `${HtmlPublicPath}${string}` ``, means **hash-routed URLs type-check**:
   `browser.runtime.getURL('/review.html#/pr/owner/repo/123')` is valid. This is exactly the shape
   this project needs.

The leading `/` is required by the type.

### Recommended: content script asks the background to open the tab

This avoids `web_accessible_resources` entirely and works regardless of Chrome's web-origin
navigation rules.

```ts
// utils/messages.ts
export type OpenReview = {
  type: 'openReview';
  owner: string;
  repo: string;
  number: number;
};
```

```ts
// entrypoints/github-pr.content/index.ts
export default defineContentScript({
  matches: ['https://github.com/*/*/pull/*'],
  main(ctx) {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return;
    const [, owner, repo, num] = m;

    const btn = document.createElement('button');
    btn.textContent = 'Open review';
    btn.addEventListener('click', () => {
      void browser.runtime.sendMessage({
        type: 'openReview',
        owner,
        repo,
        number: Number(num),
      });
    });
    // ...anchor btn into the PR header (see §6 for createShadowRootUi)
  },
});
```

```ts
// entrypoints/background.ts
export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'openReview') {
        const url = browser.runtime.getURL(
          `/review.html#/pr/${msg.owner}/${msg.repo}/${msg.number}`,
        );
        void browser.tabs.create({ url });
      }
    });
  },
});
```

### Alternative: content script navigates directly

```ts
window.open(browser.runtime.getURL('/review.html#/pr/owner/repo/123'), '_blank');
```

This **requires** the `web_accessible_resources` entry in §4. Per Chrome's docs, a navigation from a
web origin to an extension resource is blocked unless the resource is web-accessible. Same applies
to setting `location.href` or injecting an `<a href="chrome-extension://...">`.

### Hash routing on the review page

```tsx
// entrypoints/review/router.tsx
import { createHashRouter } from 'react-router';

export const router = createHashRouter([
  { path: '/', element: <Home /> },
  { path: '/pr/:owner/:repo/:number', element: <PrReview /> },
]);
```

Hash mode is mandatory: extension HTML files are static at a fixed path
(`chrome-extension://{id}/review.html`), so path-based routing has nothing to rewrite. WXT's
frontend-frameworks doc calls this out explicitly and links `createHashRouter`.

---

## 6. Messaging

**WXT ships no messaging helper.** This is stated twice in primary sources: the messaging guide
("WXT recommends installing an NPM package that wraps around the vanilla APIs") and the framework
comparison table, which lists **Messaging: ❌** for WXT with the footnote *"There is no built-in
wrapper around this API. However, you can still access the standard APIs via `chrome`/`browser`
globals or use any 3rd party NPM package."* There is a long-running design discussion at
[wxt-dev/wxt#643](https://github.com/wxt-dev/wxt/issues/643) but nothing shipped.

What WXT *does* give you:

- A unified, auto-imported `browser` global (`wxt/browser`) that works across Chromium/Firefox and
  always exposes the promise-style API.
- Types via `import { type Browser } from 'wxt/browser'` — e.g. `Browser.runtime.Port`,
  `Browser.runtime.MessageSender`.

So: **use raw `chrome.runtime` / `browser.runtime` APIs**, optionally behind your own thin typed
router, or adopt one of the libraries WXT's docs name (`@webext-core/messaging@4.0.0`,
`@webext-core/proxy-service@3.0.2`, `webext-bridge@6.0.1`, `trpc-chrome`, `Comctx`).

For a project with exactly one background router serving two callers, a ~40-line hand-rolled typed
router is usually the right call. Suggested shape:

```ts
// utils/messages.ts
export type Request =
  | { type: 'openReview'; owner: string; repo: string; number: number }
  | { type: 'getPr'; owner: string; repo: string; number: number }
  | { type: 'getToken' };

export type Response =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export function send<R = Response>(req: Request): Promise<R> {
  return browser.runtime.sendMessage(req) as Promise<R>;
}
```

### One-shot request/response (content script AND extension page → background)

Identical from both callers — `browser.runtime.sendMessage` reaches the background from any
extension context and from content scripts.

```ts
// entrypoints/background.ts
export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      handle(message, sender).then(
        (data) => sendResponse({ ok: true, data }),
        (err) => sendResponse({ ok: false, error: String(err) }),
      );
      return true; // <- keep the channel open for the async sendResponse
    });
  },
});
```

The `return true` is mandatory for async responses and is used in WXT's own `basic-messaging`
example. `sender.tab` is populated for content-script senders and `undefined` for extension pages —
that is how the router tells the two callers apart.

### Long-lived ports

WXT has **no opinion and no wrapper** for `chrome.runtime.connect`. Use it raw. From WXT's
`basic-messaging` example (verbatim):

```ts
// background
import { Browser } from 'wxt/browser';

let ports: Browser.runtime.Port[] = [];
browser.runtime.onConnect.addListener((port) => {
  ports.push(port);
  port.onMessage.addListener((msg) => { /* ... */ });
  port.onDisconnect.addListener(() => {
    ports.splice(ports.indexOf(port), 1);
  });
});
```

```ts
// review page or content script
const port = browser.runtime.connect({ name: 'review' });
port.onMessage.addListener((message) => { /* streaming updates */ });
port.postMessage({ type: 'subscribe', pr: 123 });
```

**MV3 service-worker caveat (not WXT-specific):** the SW is killed after ~30s idle. An open port
resets that timer, but Chrome force-disconnects ports after 5 minutes. Any long-lived port needs
reconnect-on-disconnect logic on the page side, and the background must keep all durable state in
`chrome.storage`, never in module-scope variables.

### Background → content script

```ts
await browser.tabs.sendMessage(tabId, message);
```

(See WXT's `background-message-forwarder` example, which also demonstrates WXT's auto-imported
`MatchPattern` helper from `wxt/utils/match-patterns` for filtering tabs.)

### Storage (`chrome.storage.local` / `.session`)

WXT ships a real wrapper here (unlike messaging): `wxt/utils/storage`, auto-imported as `storage`.
Keys **must** be area-prefixed with `local:`, `session:`, `sync:`, or `managed:`.

```ts
// utils/storage.ts
export const tokenItem = storage.defineItem<string | null>('local:githubToken', {
  fallback: null,
});

export const prCache = storage.defineItem<Record<string, CachedPr>>('session:prCache', {
  fallback: {},
});
```

Requires `permissions: ['storage']` (already in §4). Verified working in unit tests for both
`local:` and `session:`.

> **`chrome.storage.session` gotcha:** by default the session area is only readable from *trusted*
> (extension) contexts — a content script cannot see it. If the content script needs it, call this
> in the background (taken from WXT's `content-script-session-storage` example):
>
> ```ts
> // @ts-expect-error: setAccessLevel not in the type defs
> void browser.storage.session.setAccessLevel?.({
>   accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
> });
> ```
>
> For this project the background owns the cache, so you probably don't need it.

### Injecting the button into the PR page

WXT provides three content-script UI helpers (auto-imported): `createIntegratedUi`,
`createShadowRootUi`, `createIframeUi`. For a button injected into GitHub's PR header,
`createIntegratedUi` (inherits page CSS, so it can look native) or `createShadowRootUi` (style
isolation; requires `cssInjectionMode: 'ui'` and importing your CSS at the top of the entrypoint)
are the right choices. Note from WXT's own comparison table: **neither supports HMR** — only
`createIframeUi` does, because an iframe just hosts a normal HTML page. See §8.

```tsx
// entrypoints/github-pr.content/index.tsx
import ReactDOM from 'react-dom/client';
import './style.css';
import { InjectedButton } from './InjectedButton';

export default defineContentScript({
  matches: ['https://github.com/*/*/pull/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'gh-ext-button',
      position: 'inline',
      anchor: '.gh-header-actions',
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<InjectedButton />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();
  },
});
```

`ctx` (a `ContentScriptContext`) also gives you `ctx.addEventListener`, `ctx.setTimeout`,
`ctx.setInterval`, `ctx.isValid` — all of which auto-abort when the extension is reloaded, which
prevents the classic `Extension context invalidated` errors during development.

---

## 7. Web Workers under MV3 — **read this before designing the highlighter**

Short answer: **yes in a production build, but it is broken in `wxt dev`, and Shiki almost
certainly does not need a worker at all.**

### 7a. Does `new Worker(new URL('./worker.js', import.meta.url))` work on an extension page?

**Production build: YES — verified.** I put that exact expression in
`entrypoints/review/main.tsx` and ran `wxt build`. WXT/Vite emitted a separate worker chunk
`.output/chrome-mv3/assets/worker-w501BojH.js` and compiled the call site to:

```js
new Worker(new URL(`/assets/worker-w501BojH.js`, `` + self.location.href), { type: `module` })
```

WXT's `defineImportMeta` Vite plugin rewrites `import.meta.url` → `self.location.href` globally (it
exists so background service workers don't crash reaching for `document.location` —
[#392](https://github.com/wxt-dev/wxt/issues/392)). On an extension page `self` is `window`, so
`self.location.href` is `chrome-extension://{id}/review.html`, and the root-relative
`/assets/worker-*.js` resolves to `chrome-extension://{id}/assets/worker-*.js` — **same origin.**
That satisfies the HTML spec's same-origin requirement for dedicated workers.

> Note this contradicts open issue [#2032](https://github.com/wxt-dev/wxt/issues/2032) ("vite does
> not package worker.js"), which was filed against `wxt@0.20.13`. On `wxt@0.21.4` + Vite 8.2.2 the
> worker **is** emitted correctly. Treat #2032 as fixed-by-upgrade for the build path, but see 7b —
> the dev-mode half of the problem is very much alive.

All four Vite worker import forms produce working production output on an extension page (verified
by reading the emitted chunk):

| Import form | Emitted production code | Extension page | Content script |
| --- | --- | --- | --- |
| `new Worker(new URL('./w.ts', import.meta.url), {type:'module'})` | `new Worker(new URL('/assets/w-*.js', ''+self.location.href), {type:'module'})` | ✅ | ❌ resolves against `https://github.com` |
| `import W from './w?worker'` | `new Worker('/assets/w-*.js', {name})` | ✅ | ❌ same reason |
| `import W from './w?worker&inline'` | `new Worker(URL.createObjectURL(blob))`, with a `data:` URL fallback | ✅ | ✅ (blob inherits the page origin) |
| `import url from './w?worker&url'` | `'/assets/w-*.js'` (a string) | ✅ | ❌ same reason |

**Content-script workers are a trap.** In a content script `self.location.href` is the *host page's*
URL, so every root-relative form resolves to `https://github.com/assets/worker-*.js` and 404s. Only
`?worker&inline` works there. WXT's official `web-worker-setup` example uses `?worker&inline` for
exactly this reason.

**No `web_accessible_resources` entry is needed** for a worker loaded by an extension page — it is
same-origin. WXT does **not** auto-add `/assets/worker-*.js` to WAR (verified: absent from the
generated manifest).

### 7b. **`wxt dev` breaks every worker form — this is the real gotcha**

**Verified empirically.** In dev, WXT serves extension-page scripts from the Vite dev server while
the page itself is at `chrome-extension://{id}/review.html`. The generated dev `review.html`
contains:

```html
<script type="module" src="http://localhost:3000/entrypoints/review/main.tsx"></script>
```

I fetched the dev server's transform of that module and of each worker query variant. **All four
forms yield an absolute `http://localhost:3000/...` URL:**

```js
// new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})  becomes:
new Worker(new URL(/* @vite-ignore */ "http://localhost:3000/entrypoints/review/worker.ts?worker_file&type=module", '' + import.meta.url), { type: "module" })

// ./worker.ts?worker  and  ./worker.ts?worker&inline  BOTH become:
export default function WorkerWrapper(options) {
  return new Worker("http://localhost:3000/entrypoints/review/worker.ts?worker_file&type=module",
                    { type: "module", name: options?.name });
}

// ./worker.ts?worker&url becomes:
export default "http://localhost:3000/entrypoints/review/worker.ts?worker_file&type=module";
```

Because the first argument is **absolute**, the base is ignored — you get a cross-origin worker from
a `chrome-extension://` page. Per spec that must throw `SecurityError`. Note `?worker&inline` is
**not** inlined in dev, so the official example's workaround does not save you here either.

Per open issue [#2599](https://github.com/wxt-dev/wxt/issues/2599) (filed 2026, still open, no
maintainer response as of this writing): **Chrome ≤147 tolerated this; Chrome 148+ enforces it and
crashes the whole render process** (`EXC_BREAKPOINT`/SIGTRAP) rather than throwing a catchable
error. Symptom: "extension has crashed, click to reload" and a manual reload from
`chrome://extensions`. Filed upstream at Chromium issue 532577557. *(I did not reproduce the crash
in a browser — that part is taken from the issue report. The cross-origin URL generation I did
verify directly.)*

The workaround from the issue (shim `Worker` in dev only; the blob inherits the page origin, and
the `import` inside it is CORS-governed rather than origin-governed, so the dev server can still
serve the module):

```ts
// utils/dev-worker-shim.ts — import this BEFORE creating any worker
if (import.meta.env.DEV) {
  const Native = Worker;
  class PatchedWorker extends Native {
    constructor(scriptUrl: string | URL, options?: WorkerOptions) {
      const url = String(scriptUrl);
      if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
        const shim = `import ${JSON.stringify(url)};`;
        const blob = new Blob([shim], { type: 'text/javascript' });
        super(URL.createObjectURL(blob), { ...options, type: 'module' });
      } else {
        super(scriptUrl, options);
      }
    }
  }
  (globalThis as Record<string, unknown>).Worker = PatchedWorker;
}
```

`import.meta.env.DEV` strips it from production builds.

### 7c. Other worker gotchas

- **IIFE footer bug** ([#942](https://github.com/wxt-dev/wxt/issues/942), open;
  [#1424](https://github.com/wxt-dev/wxt/issues/1424), closed as fixed). WXT appended an
  `iifeReturnValueName` to bundled IIFEs, which leaked a bare identifier into worker files and threw
  `ReferenceError: _content is not defined`. **I did not reproduce this on `0.21.4`** — my emitted
  worker was a clean `(function(){ ... })();` with no trailing identifier. The official
  `web-worker-setup` example still carries the `globalThis._content = undefined;` workaround, but it
  appears to be vestigial. Treat as fixed; if you ever see `ReferenceError: _review is not defined`,
  this is the cause.
- **Content-script ESM is unsupported** ([#357](https://github.com/wxt-dev/wxt/issues/357)) — the
  content script is always bundled as a single IIFE.
- **Never use `new Worker` in the background service worker.** A service worker cannot spawn
  dedicated workers. If you need off-main-thread work reachable from the background, you need an
  offscreen document (WXT has `offscreen-document-setup` and `offscreen-document-domparser`
  examples).

### 7d. Shiki specifically — **it does not need a Web Worker**

I checked Shiki 4.4.3's dependency graph and exports directly. Shiki has **no Web Worker in its
implementation.** The relevant axis is the *regex engine*, and the choice matters a lot under MV3:

| Engine | What it ships | MV3 impact |
| --- | --- | --- |
| `createJavaScriptRegexEngine()` from `shiki/engine/javascript` | pure JS (`oniguruma-to-es` → native `RegExp`) | **No WASM, no `eval`, no worker.** Verified: `0` occurrences of `eval(` and no `new Function` in the built chunk, and no `.wasm` in `.output/`. Runs under Chrome's *default* MV3 CSP with no `content_security_policy` key at all. |
| `createOnigurumaEngine(import('shiki/wasm'))` | Oniguruma compiled to WASM | Verified: bundles as a **622 kB base64-inlined JS chunk** (`chunks/wasm-*.js`), *not* a separate `.wasm` file — so no `web_accessible_resources` needed. But `WebAssembly.instantiate` **requires `'wasm-unsafe-eval'` in `content_security_policy.extension_pages`.** |

**Recommendation: use `createJavaScriptRegexEngine()` and a fine-grained `shiki/core` import.** It
sidesteps the CSP question, the WASM bundle-size question, and the worker question in one move.

```tsx
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const highlighter = await createHighlighterCore({
  themes: [import('@shikijs/themes/github-dark')],
  langs: [import('@shikijs/langs/typescript'), import('@shikijs/langs/tsx')],
  engine: createJavaScriptRegexEngine(),
});
```

Avoid the `shiki/bundle/full` and default `shiki` entrypoints — they pull every language and theme.
Even my two-language test build produced a 181 kB `typescript` chunk; the full bundle is
multi-megabyte.

### 7e. **The CSP dev/prod divergence — a genuine landmine**

Read directly from `packages/wxt/src/core/utils/manifest.ts`:

```ts
if (wxt.config.command === 'serve') addDevModeCsp(manifest);   // line 149
// ...
const DEFAULT_MV3_EXTENSION_PAGES_CSP =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";  // line 778
```

`addDevModeCsp` runs **only on `serve`**. Consequences, both verified by building:

- **`wxt` (dev):** manifest gets
  `"extension_pages": "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000; object-src 'self';"`
  — WASM works.
- **`wxt build` with no explicit CSP:** manifest has **no `content_security_policy` key at all**
  (verified: `undefined`). Chrome's default MV3 policy applies, which does **not** include
  `'wasm-unsafe-eval'` — WASM is blocked.

So a WASM-based highlighter **works in dev and silently dies in the production build.** If anything
on your extension pages touches WebAssembly, you must set `content_security_policy.extension_pages`
by hand in `wxt.config.ts` (as shown in §4). If you take the JS-engine route in 7d, you can drop
that key entirely.

---

## 8. Dev loop

### Commands and output directories (verified)

| Command | Output directory | Notes |
| --- | --- | --- |
| `npm run dev` → `wxt` | `.output/chrome-mv3-dev/` | dev server on `http://localhost:3000` |
| `npm run build` → `wxt build` | `.output/chrome-mv3/` | this is the one Playwright loads |
| `wxt build -b firefox` | `.output/firefox-mv2/` | not needed here |
| `wxt zip` | `.output/*.zip` | |
| `wxt prepare` | `.wxt/` | types only |

**Exact unpacked path to load in Chrome:**

- Development: `E:\source\gh-ext\.output\chrome-mv3-dev`
- Production / e2e: `E:\source\gh-ext\.output\chrome-mv3`

### Loading unpacked

If `web-ext` is installed (it is, in the dependency block above), `wxt` launches a fresh Chrome
profile with the extension already installed. To use your own browser instead, set
`disabled: true` in `web-ext.config.ts` and load manually:

1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select `.output/chrome-mv3-dev`

WXT prints `ℹ Load ".output\chrome-mv3-dev" as an unpacked extension manually` when it isn't
opening a browser for you. It also registers an `Alt+R` command (`wxt:reload-extension`) in dev
builds.

### HMR / reload behaviour

From WXT's own comparison table plus the content-script UI table:

| Change | Behaviour |
| --- | --- |
| Extension page (`review.html`, `options.html`) React component | **True HMR.** The page's scripts are served from the Vite dev server, so React Fast Refresh applies. |
| Extension page HTML file | Page reload. |
| **Content script** | **No HMR** — WXT reloads the content script (and re-injects it). `createIntegratedUi` and `createShadowRootUi` are marked HMR ❌; only `createIframeUi` gets HMR, since it hosts a real HTML page. |
| **Background** | **Reloads the entire extension** (footnote `[^g]` in the comparison table). |

### Dev-mode manifest divergences you must know about

Confirmed by diffing the dev vs. production `manifest.json` of the same project, and cross-checked
against `manifest.ts`:

1. **`content_scripts` is completely absent from the dev manifest.** Source comment:
   *"Don't add content scripts to the manifest in dev mode for MV3 - they're managed and reloaded at
   runtime."* WXT registers them via `chrome.scripting.registerContentScripts` instead. Practical
   effect: **do not write assertions against `manifest.content_scripts` in dev**, and expect
   content-script injection timing (`run_at`) to differ slightly from production.
2. Dev adds `permissions: ["tabs", "scripting"]` and `host_permissions: ["http://localhost/*"]`
   plus every content-script match pattern to `host_permissions`.
3. Dev adds `content_security_policy.extension_pages` and `.sandbox` (see §7e).
4. Dev adds `commands["wxt:reload-extension"]`.
5. Dev `review.html` is a shell that loads `main.tsx` from `http://localhost:3000` — this is the
   root cause of the worker problem in §7b.

**Always smoke-test a `wxt build` output before shipping.** Dev and production differ in CSP,
content-script registration, and asset origins.

---

## 9. Testing

### Vitest — verified end to end

The plugin name is **`WxtVitest`**, imported from **`wxt/testing/vitest-plugin`**. Confirmed in
`wxt/package.json`'s exports map:

```json
"./testing/vitest-plugin": {
  "types": "./dist/testing/wxt-vitest-plugin.d.mts",
  "default": "./dist/testing/wxt-vitest-plugin.mjs"
},
"./testing/fake-browser": { ... }
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom', // or 'jsdom'
    mockReset: true,
    restoreMocks: true,
  },
});
```

`WxtVitest()` does five things (per the docs, all observed working):

1. Polyfills the `browser` global with an **in-memory** implementation from
   `@webext-core/fake-browser` (a direct dependency of `wxt`, `^2.0.1`).
2. Applies your `wxt.config.ts` `vite` config and plugins.
3. Configures auto-imports, so `browser`, `storage`, `defineContentScript` etc. resolve in tests.
4. Defines WXT globals: `import.meta.env.BROWSER`, `.MANIFEST_VERSION`, `.IS_CHROME`, …
5. Wires the `@/*`, `~/*`, `@@/*`, `~~/*` aliases.

### Stubbing `chrome.*` — you mostly don't

`@webext-core/fake-browser` implements storage in memory, so `chrome.storage.local` and
`chrome.storage.session` behave for real. **Verified — this test file passed as written:**

```ts
// utils/__tests__/storage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { tokenItem, prCache } from '../storage';

describe('storage items', () => {
  beforeEach(() => {
    fakeBrowser.reset(); // resets all in-memory state + listeners
  });

  it('local: round-trips', async () => {
    expect(await tokenItem.getValue()).toBe(null);
    await tokenItem.setValue('ghp_x');
    expect(await tokenItem.getValue()).toBe('ghp_x');
  });

  it('session: round-trips', async () => {
    await prCache.setValue({ a: {} as any });
    expect(await prCache.getValue()).toHaveProperty('a');
  });

  it('browser global is stubbed', () => {
    expect(typeof browser.runtime.getURL).toBe('function');
  });
});
```

Result: `Test Files 1 passed (1) / Tests 3 passed (3)` on `vitest@4.1.11` + `happy-dom@20.12.0`.

For APIs `fake-browser` doesn't implement (`runtime.sendMessage` round-tripping, `tabs.create`,
`storage.session.setAccessLevel`), spy on them:

```ts
import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const createTab = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as any);
// ...
expect(createTab).toHaveBeenCalledWith({
  url: expect.stringContaining('/review.html#/pr/'),
});
```

**Mocking WXT's own utilities: you must mock the *real* module path, not `#imports`.** WXT rewrites
`#imports` into its constituent imports before Vitest sees it, so:

```ts
// ❌ vi.mock('#imports', ...)
// ✅
vi.mock('wxt/utils/inject-script', () => ({ injectScript: vi.fn() }));
```

Look up the real path in `.wxt/types/imports-module.d.ts` (regenerate with `wxt prepare` if
missing). For reference, that file maps `storage` → `wxt/utils/storage`, `browser` →
`wxt/browser`, `createShadowRootUi` → `wxt/utils/content-script-ui/shadow-root`.

**Testing the message router:** extract the handler into a plain function in `utils/` and unit-test
it directly — don't try to test through `browser.runtime.onMessage`. `defineBackground`'s `main()`
is not easily invokable in isolation.

### Playwright smoke test

WXT's guidance: follow Playwright's Chrome-extension docs and point it at the **production** output
directory. The practical shape, from WXT's own `playwright-e2e-testing` example (verbatim
`e2e/fixtures.ts`, adapted paths):

```ts
// e2e/fixtures.ts
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const pathToExtension = path.resolve('.output/chrome-mv3');

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // extensions do NOT load in classic headless mode
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker');
    await use(background.url().split('/')[2]);
  },
});

export const expect = test.expect;
```

```ts
// e2e/review-page.spec.ts
import { test, expect } from './fixtures';

test('review page boots', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/review.html#/`);
  await expect(page.locator('#root')).toBeVisible();
});
```

Practical notes:

- **Build first.** `wxt build` must run before `playwright test`; `.output/chrome-mv3` is what gets
  loaded. Chain it: `"e2e": "wxt build && playwright test"`.
- The `extensionId` fixture derives the ID from the service worker's URL — this is the only reliable
  way, since unpacked IDs are derived from the absolute path.
- `headless: false` is required for extension loading. On CI use `xvfb-run`, or Playwright's newer
  headless-shell-free mode. **UNVERIFIED** whether Chrome's `--headless=new` reliably loads MV3
  extensions on `@playwright/test@1.62.1`; the official WXT example still uses `headless: false`.
- Testing the **content script** against real github.com is flaky and needs auth. Prefer a local
  fixture page whose URL you can match, or test the content script's DOM logic in Vitest with
  `happy-dom` and reserve Playwright for `review.html` + options page smoke tests.
- `playwright.config.ts` from the WXT example: `testDir: 'e2e'`, single `chromium` project,
  `workers: 1` on CI.

---

## 10. TypeScript

### How type generation works

`wxt prepare` writes `<rootDir>/.wxt/`:

| File | Contents |
| --- | --- |
| `.wxt/tsconfig.json` | Base compiler options + all path aliases |
| `.wxt/wxt.d.ts` | Reference hub — pulls in everything below |
| `.wxt/types/paths.d.ts` | `PublicPath` union → **type-safe `browser.runtime.getURL()`** (§5) |
| `.wxt/types/globals.d.ts` | `ImportMetaEnv` (`MANIFEST_VERSION`, `BROWSER`, `CHROME`, `COMMAND`, `ENTRYPOINT`, …) |
| `.wxt/types/imports.d.ts` + `imports-module.d.ts` | Auto-import declarations and the `#imports` virtual module |
| `.wxt/types/i18n.d.ts` | i18n message keys |
| `.wxt/eslint-auto-imports.mjs` | ESLint globals (generated when ESLint is detected) |

`.wxt/wxt.d.ts` (verified content) also pulls in `wxt/vite-builder-env` — this is where
`vite/client`'s types come from, which is why `import W from './worker?worker&inline'` type-checks
**without** a `@ts-expect-error`. (I originally added `@ts-expect-error` to those imports and `tsc`
reported `TS2578: Unused '@ts-expect-error' directive` — so the query-suffix imports are properly
typed.) It also references `@wxt-dev/module-react`.

### Root `tsconfig.json`

Extend the generated one. This is the official React template's file, verbatim:

```jsonc
// tsconfig.json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx"
  }
}
```

`"jsx": "react-jsx"` is the piece that matters for React 19 (no `import React` needed in `.tsx`).

The generated `.wxt/tsconfig.json` in 0.21.4 is (verified verbatim):

```jsonc
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "paths": { "@": [".."], "@/*": ["../*"], "~": [".."], "~/*": ["../*"],
               "@@": [".."], "@@/*": ["../*"], "~~": [".."], "~~/*": ["../*"] }
  },
  "include": ["../**/*", "./wxt.d.ts"],
  "exclude": ["../**/node_modules", "../.output"]
}
```

Two of these are newly strict in 0.21 and will surface real errors in new code:
**`verbatimModuleSyntax`** (use `import type { X }` for type-only imports) and
**`noUncheckedIndexedAccess`** (`arr[0]` is `T | undefined`). The upgrade guide recommends fixing
the code rather than reverting.

If you're in a monorepo and can't extend, add instead:

```ts
/// <reference path="./.wxt/wxt.d.ts" />
```

### Path aliases

| Alias | Resolves to |
| --- | --- |
| `~~`, `@@` | `<rootDir>/*` |
| `~`, `@` | `<srcDir>/*` (same as rootDir unless you set `srcDir`) |

**Do not add custom aliases to `tsconfig.json`** — they won't reach the bundler. Use `alias` in
`wxt.config.ts`; WXT writes them into `.wxt/tsconfig.json` on the next `prepare` *and* registers
them with Vite:

```ts
import { resolve } from 'node:path';

export default defineConfig({
  alias: {
    api: resolve('utils/github-api'),
  },
});
```

### Commands

```sh
npx wxt prepare      # regenerate .wxt/ types
npx tsc --noEmit     # type-check (template maps this to `npm run compile`)
```

`wxt prepare` is wired to `postinstall` in the template, and `wxt`/`wxt build` run it implicitly.
Run it manually whenever you add an entrypoint (to refresh `PublicPath`), change `alias`, or see
phantom "cannot find name `browser`/`defineBackground`" errors in your editor.

### Custom compiler options

Two mechanisms:

1. Override a scalar in your root `tsconfig.json` (as the template does with `jsx`).
2. For things you can't express as an override (adding to `lib`, `paths`), use the
   `prepare:tsconfig` hook (added in 0.21.1):

   ```ts
   export default defineConfig({
     hooks: {
       'prepare:tsconfig': (wxt, { tsconfig }) => {
         tsconfig.compilerOptions.lib.push('WebWorker');
       },
     },
   });
   ```

   You'd want exactly that `WebWorker` lib addition if you write a worker source file (§7).

### Auto-imports (relevant to typing)

`@wxt-dev/module-react` registers React's hooks as auto-imports. From the generated
`.wxt/types/imports-module.d.ts` (verified):

```ts
export { useState, useCallback, useMemo, useEffect, useRef, useContext, useReducer } from 'react';
```

plus WXT's own `browser`, `storage`, `defineBackground`, `defineContentScript`,
`defineUnlistedScript`, `createShadowRootUi`, `createIntegratedUi`, `createIframeUi`,
`injectScript`, `MatchPattern`, `ContentScriptContext`, `fakeBrowser`, and more. Files in
`components/`, `hooks/`, and `utils/` are auto-imported too (all named + default exports).

If you'd rather have explicit imports, set `imports: false` in `wxt.config.ts` and import from
`#imports` (or the real paths) by hand. **UNVERIFIED** — I did not test disabling auto-imports.

---

## Appendix: quick decision summary for this project

| Question | Answer |
| --- | --- |
| Scaffold | `npx wxt@0.21.4 init gh-ext -t react --pm npm` |
| Dev command | `wxt` (**not** `wxt dev`) |
| `review.html` | `entrypoints/review/index.html` → unlisted page, not in the manifest |
| Open it from the content script | message → background → `browser.tabs.create({ url: browser.runtime.getURL('/review.html#/...') })`. Avoids `web_accessible_resources`. |
| Messaging | Raw `browser.runtime.*`; WXT ships no helper. `return true` for async `sendResponse`. |
| Storage | `storage.defineItem('local:...')` / `('session:...')`, `permissions: ['storage']` |
| Syntax highlighting | Shiki `shiki/core` + `createJavaScriptRegexEngine()` — **no worker, no WASM, no CSP change** |
| Web workers | Work in production on extension pages; **broken in `wxt dev` (cross-origin localhost)** — needs the dev shim from §7b |
| WASM anywhere on extension pages | Must hand-write `content_security_policy.extension_pages` with `'wasm-unsafe-eval'` — WXT only sets it in dev |
| Unit tests | `vitest` + `WxtVitest()` from `wxt/testing/vitest-plugin`, `fakeBrowser` from `wxt/testing/fake-browser` |
| E2E | Playwright `launchPersistentContext` + `--load-extension=.output/chrome-mv3`, `headless: false` |
| Prod build output | `.output/chrome-mv3` &nbsp;|&nbsp; Dev: `.output/chrome-mv3-dev` |
