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
  declares `:root, :host`. A literal hex elsewhere is a mistake, and a test says
  so — `ui/tokens.test.tsx` scans both stylesheets and the card, with exactly one
  documented exception.
- **That file is the default, not the palette.** Choosing one of the seventy-five
  themes overwrites every token on all three surfaces with values derived from
  it. Three consequences when editing:
  - A token added to `ui/tokens.css` must also be added to `lib/theme/tokens.ts`,
    and `npm run palettes` re-run. Otherwise it keeps its Primer pair while the
    page around it turns. The same test catches this.
  - `lib/theme/palettes.ts` is **generated**. Regenerate it, do not edit it.
    `lib/theme/palettes.test.ts` fails when it has fallen behind
    `lib/theme/derive.ts`.
  - Contrast ratios quoted in DESIGN.md are claims about the default only. A
    chosen theme is drawn as its author wrote it — that is deliberate and
    PRODUCT.md explains why.
- **On the two pages, put a theme on through `ui/pageTheme.ts` and nowhere
  else.** `applyChromeTheme` is the mechanism, but that file is what owns
  `<html>`: it also sets `data-syntax-theme` and mirrors the chosen id into
  `localStorage`, which is the only synchronous source a page has and therefore
  the only thing standing between a reviewer and a frame of the wrong palette
  on every load. Applying a theme around it leaves the mirror stale and the
  next load boots the previous choice. `App` calls `usePageTheme` once for every
  route; a new route needs nothing. The injected card is not part of this — it
  is handed an id at mount and calls `applyChromeTheme` directly.
- **One order, and `treeRows` owns it.** The tree and the diff column both read
  `fileOrder` — directories first, then files, counting the way a person does.
  `reviewFiles` sorts by it, so the whole diff and a narrowed one are laid out
  by the same rule without either caller knowing there is one. Do not re-sort
  at a surface: they disagreed once, and a root-level `README.md` came first in
  the column and last in the tree. There are **two** trees now — the checklist
  and the find panel's results — and `ui/searchRows.ts` defers to `treeRows`
  for exactly this reason rather than laying its own files out. Their shared
  keyboard is `ui/treeKeys.ts`, for the same reason twice over.

- **The rail's two panels must not declare `visibility: visible`.** `FilesView`
  stacks the file tree and the find panel in one grid cell and hides the
  inactive one, the way `.views` does one level out. The *showing* one is left
  to inherit. Declaring it visible overrides the hidden ancestor when the whole
  Files view is hidden, which puts an invisible, fully hit-testable file tree
  over the Conversations view where it silently eats clicks. Only the e2e suite
  caught it; jsdom performs no hit-testing.

- **The find panel downloads every archive, and that is on purpose.** A `.zip`
  is binary to GitHub, so its patch is empty and search could not see inside
  one. `ui/useArchiveIndexes.ts` reads each archive's index so its members are
  searchable, which costs a whole-blob download per side — the only fetching
  any search on this page does. Three rules make it affordable and they are
  stated in that file: never before the diff has arrived, never twice (it
  shares `fileSides`' cache *and its keys*, so a card later paints from cache),
  and never fatal. If you add a container kind, `ParsedEntry` in
  `lib/review/search.ts` is the seam — that module deliberately never says
  "archive".

- **The file icons are generated, like the palettes.** `material-icon-theme` is
  a devDependency and nothing from it ships; `npm run file-icons` writes the
  drawings to `public/file-icons/` and the mapping to `lib/icons/material.ts`.
  Regenerate, do not edit — `lib/icons/material.test.ts` fails when either has
  fallen behind the installed package, and it checks both directions, because a
  table naming a drawing that is not there is a broken `<img>` nobody sees
  until they open that kind of file. The mapping is a dynamic import on
  purpose: it is a quarter of a megabyte, and `ui/useFileIcons.ts` says why it
  must not be on the first paint.

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
