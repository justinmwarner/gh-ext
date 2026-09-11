# A Better Reviewer

A browser extension (WXT + React 19) that replaces GitHub's pull request review
interface with a faster one. `README.md` covers install, the token, publishing
and the known limits; this file is only the things an agent tends to get wrong.

## Design context

- **`PRODUCT.md`** — who this is for, what it is, what it must never become. Register is `product`.
- **`DESIGN.md`** — the visual system: tokens, type, elevation, components, and a Do's and Don'ts section that is meant to be enforced rather than admired.

Read both before changing anything a reviewer looks at. The one-line version:
the extension deliberately wears GitHub's Primer palette so there is no visual
seam between the pull request page and the review page. That is a strategic
choice, not an accident of the Pierre components, and "make it look more like
ours" is the wrong instinct here.

## Rules that are easy to break

- **Colours live in `ui/tokens.css` and nowhere else.** All three surfaces read
  it: the review and options pages import it, and the injected card imports it
  with `?raw` and inlines the text into its shadow root, which is why the file
  declares `:root, :host`. A literal hex elsewhere is a one-off that needs a
  comment saying why, or a mistake.
- **`lib/` is pure.** No DOM, no `chrome.*`, no network. Two documented
  adapters are excepted: `token-provider.ts` and `settings-store.ts`. This
  boundary is why most of the logic tests in milliseconds under Node.
- **Read `docs/reference/` before touching API code.** It was written against
  real source and the live schema, and it records several behaviours that break
  the obvious implementation (an outdated thread's `line` is `null`; Pierre
  drops an annotation outside a rendered hunk silently; `CodeView` does not
  redraw an item whose `fileDiff` changed). If you change a GraphQL document,
  re-execute it against the live schema and update the reference.
- **`npm run dev` is bare `wxt`**, not `wxt dev` — the latter parses as a root
  directory. Content scripts get no HMR and are absent from the dev manifest
  entirely, so **verify anything touching the injected card against
  `npx wxt build` output**, not against the dev server.
- **Never load `.output/store/` as an unpacked extension.** Load
  `.output/chrome-mv3`. The store build omits the manifest `key` on purpose and
  lives in a directory the release scripts delete and recreate.

## Verifying

```bash
npm test          # vitest: lib (node) + ui and content (jsdom)
npm run typecheck
npm run test:e2e  # builds, then Playwright against the production build
```

The e2e suite drives the real production build in a real Chromium with GitHub
traffic mocked at the service worker. It is the only honest check for anything
touching the content script, the manifest, or the built CSS.
