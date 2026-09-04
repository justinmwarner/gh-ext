# Rich diff types — what was built, and what is still a choice

**Date:** 2026-09-04
**Status:** Part implemented; the numbered decisions below are open and need a
human answer.

## 0. Provenance and trust rules

Same contract as `docs/reference/pierre-diffs-api.md`. Every version, licence,
size and behavioural claim below was read out of something real — the npm
registry, an extracted tarball, a build in this working tree, or a measurement
in Chrome — on **2026-09-03**. Anything that could not be verified is marked
**UNVERIFIED** in bold and should be checked before it is relied on.

Registry facts came from `npm view <pkg> version license time.modified
dist.unpackedSize`. Entry-point sizes came from `npm pack`, extracting, and
`ls` on the file the package's `exports` map actually points at — not from a
bundle-size website, and not from memory.

---

## 1. What this is

A unified text diff answers one question: which lines moved. For a large class
of file that is not the question anyone has, and for some of them there are no
lines at all.

The shipped work adds a per-file **mode switcher** and five families of
comparison. This document records the calls that were made and, more
importantly, the ones that were **not** — the places where the trade-off is
real enough that guessing would be worse than asking.

## 2. What is implemented

| Kind | Extensions | Modes | Engine |
| --- | --- | --- | --- |
| Image | `png` `apng` `jpg` `jpeg` `jfif` `gif` `webp` `avif` `bmp` `ico` | Side by side · Swipe · Onion skin · Difference · Raw | `ui/ImageCompare.tsx` |
| SVG | `svg` | Rendered · Difference · Raw | same |
| Table | `csv` `tsv` | Grid · Changed rows · Raw | `lib/compare/tabular.ts` |
| JSON | `json` | Key paths · Formatted · Raw | `lib/compare/structured.ts` |
| Notebook | `ipynb` | Cells · Cells and outputs · Raw | `lib/compare/notebook.ts` |
| Everything else | — | Raw | `ui/diffItems.ts` |

Three rules hold across all of them, enforced in `lib/compare/modes.ts` rather
than left to the renderers:

- **Raw is on every file and it is last.** Every smart view is a guess about
  intent; a guess that cannot be backed out of is worse than none.
- **A mode that cannot work is not offered.** Onion-skinning a newly added
  image against nothing is not a comparison, and a control that visibly does
  nothing reads as a defect rather than as an absence.
- **Nothing is remembered.** The page persists no interface state anywhere, and
  a mode that survived a reload would be the one exception.

Everything is bounded, and the bounds are exported constants so they can be
argued with: `ALIGN_BUDGET` (1,000,000 cells), `TABLE_LIMITS` (2,000 rows / 30
columns / 30,000 cells), `JSON_LIMITS` (20,000 leaves / 2,000 changes),
`NOTEBOOK_LIMITS` (500 cells / 4,000 output chars / 400,000 base64 chars),
`MAX_BINARY_BYTES` (4 MB), and the existing `MAX_BLOB_BYTES` (1 MB of text).

### What it cost

Measured by building this working tree at `1b6b955` (before the feature) and at
`8cb1ffd` (after), with `npx wxt build`:

| Artifact | Before | After | Delta |
| --- | --- | --- | --- |
| `chunks/review-*.js` | 915,046 B | 945,886 B | **+30,840 B (+3.4%)** |
| same, gzipped | 256,583 B | 266,249 B | +9,666 B (+3.8%) |
| `assets/review-*.css` | 21,389 B | 28,887 B | +7,498 B (+35%) |
| same, gzipped | 3,789 B | 4,821 B | +1,032 B (+27%) |

**No dependency was added.** `package.json` is untouched.

For scale, the thing already in the bundle: `chunks/wasm-*.js` is **622,325
bytes** of base64-encoded WebAssembly, reachable only from Shiki's
`shiki-wasm` engine, which this project deliberately never selects
(`DiffColumn` never sets `preferredHighlighter`; there is a test pinning that
absence). It is dead weight and it is 20× the size of everything added here.
Any proposal below should be weighed against the fact that **deleting that one
chunk would pay for all of them several times over** — see decision 12.

---

## 3. Decisions already made, and why

These are the places a dependency was the obvious alternative and was not
taken. They are recorded so they can be overturned deliberately rather than
rediscovered.

### 3.1 The CSV parser is hand-written

~60 lines in `lib/compare/tabular.ts`, covering RFC 4180: quoted delimiters,
quoted newlines, doubled quotes, CRLF, ragged rows, plus a delimiter sniff for
the semicolon-separated files Excel writes in every comma-decimal locale.

| Option | Version | Licence | Modified | Unpacked | Verdict |
| --- | --- | --- | --- | --- | --- |
| hand-written | — | — | — | ~2 kB source | **chosen** |
| `papaparse` | 5.7.0 | MIT | 2026-08-24 | 270,635 B | rejected |
| `csv-parse` | 7.0.2 | MIT | 2026-08-02 | 1,606,924 B | rejected |

Both are healthy, permissively licensed and would work under MV3. The reason
not to take one is that the value they add over sixty lines is streaming,
worker offload, type coercion and dynamic typing — and every one of those is
something this code would then have to bound anyway, because the input is
whatever somebody committed. Reaching for a parser would mean writing the
ceiling regardless and then owning the seam between our ceiling and theirs.

Revisit if a real file mis-parses. The failure mode is visible (a column
shifts and the whole grid paints as changed), Raw is one press away, and the
parser has a test per quoting rule.

### 3.2 The row alignment is hand-written

`lib/compare/rows.ts`: shared prefix and suffix trimmed first, then an exact
LCS on what is left, then a hard budget past which the middle is reported as
one wholesale replacement and flagged `approximate`.

`diff` (jsdiff) **9.0.0, BSD-3-Clause, modified 2026-04-13** is already in the
dependency tree — `npm ls diff` shows it under `@pierre/diffs@1.3.6` — so
`diffArrays` would cost approximately zero new bytes. That is a genuinely
strong argument and it was still declined, because `diffArrays` has no budget
of any kind and the budget is the entire point. A 100,000-row generated CSV
would allocate a ten-billion-cell table before drawing anything.

Revisit if the alignment is ever wanted somewhere the input is known small.

### 3.3 SVG renders through `<img>`, never inline

An SVG loaded as the `src` of an `<img>` is a *secure static* document: no
script, no external references, no interaction. Inlining the same markup into
the page would be executing content that arrived from a pull request inside an
extension origin that holds a GitHub token in `chrome.storage.local`.

The cost is real — no CSS from the page reaches it, no text selection, no
hit-testing — and it is the right trade every time. Inlining would need
DOMPurify (see decision 1) and would still be a larger surface than it is
worth for a rendered preview.

### 3.4 Image bytes travel as base64 through `runtime.sendMessage`

`runtime.sendMessage` serializes as JSON, so a `Uint8Array` arrives as
`{"0":137,"1":80,…}` — four times the size and no longer a buffer. Base64 is
what survives, at a third more bytes than the file. That inflation is why
`MAX_BINARY_BYTES` is 4 MB rather than 10: two sides at the ceiling is eleven
megabytes of JSON string built in the worker and parsed on the page.

See decision 11 for the alternative.

### 3.5 A lockfile opens Raw, whatever its extension promises

`package-lock.json` is `.json` and would otherwise open on the structural view,
which means two multi-megabyte blob reads — both of which the 1 MB text cap
would refuse anyway — to answer a question nobody asked about a file nobody
reads. Files matching `DEFAULT_NOISE_PATTERNS` open Raw; the structural view is
still one press away.

---

## 4. Open decisions

### Decision 1 — Markdown: rendered preview, or leave it as source?

`.md` is probably the single most common non-code file in a pull request, and
it is currently offered nothing but the text diff.

**The problem with the obvious answer.** A rendered before/after does not show
what changed. Two prose paragraphs side by side, both rendered, is *harder* to
compare than the source diff, which at least highlights the words. The mode
that would actually earn its place is a **rendered diff** — the new document
rendered with insertions and deletions marked inline — and that is a
substantially larger piece of work than "render both sides".

**Options.**

| Option | Version | Licence | Modified | Entry size | MV3 |
| --- | --- | --- | --- | --- | --- |
| A. Do nothing | — | — | — | 0 | — |
| B. `marked` + sanitizer | 18.0.11 | MIT | 2026-08-24 | `lib/marked.esm.js` 43,800 B unminified | no `eval`/`new Function` anywhere in `lib/` (grepped) |
| C. `markdown-it` + sanitizer | 15.0.1 | MIT | 2026-08-27 | 1,962,169 B unpacked | not inspected |
| D. `snarkdown` | 2.0.0 | MIT | **2022-06-26** | 39,999 B unpacked | not inspected |
| E. Rendered diff (B or C plus an inline word-diff over the rendered tree) | — | — | — | B/C plus new code | — |

Whichever renderer is chosen, the output has to be sanitized before it reaches
the DOM, because a pull request can contain `<img onerror>` and this origin
holds the token.

| Sanitizer | Version | Licence | Modified | Entry size | Note |
| --- | --- | --- | --- | --- | --- |
| `dompurify` | 3.4.14 | MPL-2.0 OR Apache-2.0 | 2026-08-19 | `dist/purify.es.mjs` 129,175 B unminified | no `eval`/`new Function` in the ESM entry; the only hit in the package is `dist/purify.cov.cjs.js`, a coverage build that no `exports` path points at |
| `Element.setHTML()` | platform | — | — | 0 B | **UNVERIFIED**: which Chrome version ships it un-flagged, and whether it is available to an extension page. Must be tested before it is relied on |

**Large-file behaviour.** All of these are linear in document size and none has
a built-in ceiling. A cap would have to be added, as everywhere else here.
`marked` in particular has had catastrophic-backtracking advisories
historically — **UNVERIFIED** whether 18.x is affected; check before shipping.

**Recommendation: A for now, then E if it is wanted at all.** B or C plus
DOMPurify is ~170 kB unminified to produce a view that is *worse* than the
source diff for the thing reviewers actually do with Markdown, which is read
prose changes. If a rendered view is wanted, it is worth doing properly as a
rendered diff, and that is its own piece of work rather than a mode to bolt on
this week. **This is the decision I am least confident about** — if the
repositories in question are documentation-heavy, B plus DOMPurify plus a
byte cap is defensible and cheap.

### Decision 2 — YAML: structural comparison?

Arguably a bigger gap than CSV. GitHub Actions workflows, Kubernetes manifests,
`docker-compose.yml`, `.gitlab-ci.yml` — YAML is edited in an enormous share of
real pull requests, and it has exactly the failure that motivated the JSON
mode: re-indenting or re-ordering a block rewrites lines that did not change,
and an anchor or a merge key means the text and the meaning diverge.

| Option | Version | Licence | Modified | Unpacked | Note |
| --- | --- | --- | --- | --- | --- |
| A. Do nothing | — | — | — | 0 | current state |
| B. `yaml` | 2.9.0 | ISC | 2026-05-11 | 685,953 B | full YAML 1.1/1.2, comment-preserving CST |
| C. `js-yaml` | 5.4.1 | MIT | 2026-08-26 | 1,570,301 B | registry values as read on 2026-09-03 |

Either would feed straight into `compareJson` — parse to a plain object, hand
it the same walker, and YAML gets key paths and a formatted mode for free. That
is maybe thirty lines on top of the parser.

**Large-file behaviour.** `JSON_LIMITS` already bounds the walk. The parse
itself is bounded by the existing 1 MB text cap. Both libraries are
single-pass; neither is a plausible hang at a megabyte, but neither has been
measured here.

**Recommendation: B.** `yaml` is smaller, ISC, actively maintained, has no
dependencies, and its CST would later support a comment-aware view. It reuses
an engine that already exists. Of everything in this document this is the
change with the best ratio of reviewer value to bytes, and the only reason it
was not simply done is the standing rule that a new dependency is a decision
for a human.

### Decision 3 — JSON with comments

`tsconfig.json`, `.eslintrc.json`, `devcontainer.json` and everything under
`.vscode/` are JSONC, and `JSON.parse` refuses them. Verified: parsing
`{\n  // a comment\n  "a": 1\n}` throws. So a `tsconfig.json` opens on the
structural view and immediately says it cannot read the file.

That message now names comments as the likely cause and points at Raw, so it is
honest rather than mystifying — but it is still a poor first impression on one
of the most-edited files in a TypeScript repository.

| Option | Version | Licence | Modified | Entry size | Note |
| --- | --- | --- | --- | --- | --- |
| A. Leave the message | — | — | — | 0 | current state |
| B. `jsonc-parser` | 3.3.1 | MIT | 2026-07-16 | `lib/esm/main.js` 9,363 B unminified; 212,821 B unpacked | no `eval`/`new Function` (grepped); zero dependencies; it is the parser VS Code itself uses |
| C. Strip comments by hand and re-parse | — | — | — | ~30 lines | same state machine as the CSV parser |

**Large-file behaviour.** B is a scanner, linear, no ceiling of its own — bounded
by the existing 1 MB cap.

**Recommendation: B.** Nine kilobytes of ESM entry for a parser maintained by
Microsoft as part of VS Code, and it removes a visible wart on a common file.
C is tempting and is the wrong instinct: a comment stripper that does not
correctly track string state will silently corrupt any document containing
`//` inside a string, which is every file with a URL in it.

### Decision 4 — PDF

PDFs turn up in documentation and design repositories, rarely elsewhere.

| Option | Version | Licence | Modified | Unpacked | MV3 |
| --- | --- | --- | --- | --- | --- |
| A. Say "binary file changed", plus sizes | — | — | — | 0 | fine |
| B. `<embed type="application/pdf" src="blob:…">` | platform | — | — | 0 | **UNVERIFIED** — whether Chrome's built-in PDF viewer will render a `blob:` URL inside a `chrome-extension://` page, and whether that counts as `object-src 'self'`. Must be tested |
| C. `pdfjs-dist` | 6.3.289 | Apache-2.0 | 2026-08-29 | **34,781,083 B** | its worker and its optional WASM are both a problem under MV3 |

**Large-file behaviour.** B hands the whole file to a plugin, which is
Chrome's problem rather than ours. C would have to render page by page and
would need its own ceiling.

**Recommendation: A, then test B.** C is out of the question — 34 MB unpacked
against a 30 kB feature, plus a worker path that would have to be shipped as a
static asset and a WASM path that MV3 forbids without a CSP key this project
refuses to add. B is worth twenty minutes of experiment: if `<embed>` works, a
side-by-side of two PDFs is a mode for free. If it does not, A is the honest
answer and A is what is shipped today.

### Decision 5 — Fonts

`.woff2`, `.woff`, `.ttf`, `.otf`. Not common, but when they change the text
diff is worthless and the change is often visible at a glance.

There is a cheap and rather good option here that needs **no dependency at
all**: `new FontFace(name, arrayBuffer)` accepts bytes directly, and
`document.fonts.add()` makes them usable. The bytes are already reaching the
page for images. A specimen — a pangram at several sizes, before and after, and
the same two overlaid with the difference blend the image modes already have —
is perhaps eighty lines.

| Option | Version | Licence | Modified | Unpacked | Note |
| --- | --- | --- | --- | --- | --- |
| A. Say "binary file changed" | — | — | — | 0 | current state |
| B. `FontFace` specimen | platform | — | — | ~2 kB source | needs unique family names and removal on unmount; `document.fonts` is global state |
| C. `opentype.js` | 2.0.0 | MIT | 2026-05-06 | 3,642,174 B | glyph counts, tables, per-glyph diffing |
| D. `fontkit` | 2.0.4 | MIT | **2024-08-09** | 5,610,637 B | two years without a release |

**Large-file behaviour.** B is bounded by `MAX_BINARY_BYTES`; a font past 4 MB
is refused with the same sentence an oversized image gets.

**Recommendation: B, if fonts turn up in these repositories at all.** It was
not implemented because it is the least likely of the open items to be used
and because `document.fonts` is process-global state that has to be cleaned up
carefully — a leak there outlives the card. C and D are both far too large for
what they would add.

### Decision 6 — Lockfiles: a dependency summary?

Lockfiles are currently de-emphasised: `DEFAULT_NOISE_PATTERNS` marks them, the
tree greys them, and they now open Raw. Is there something better?

The only thing anyone wants from a lockfile diff is: which packages were added,
which were removed, which changed version. Nothing else in the file is read by
a human, ever.

| Format | What it is | Cost of a summary |
| --- | --- | --- |
| `package-lock.json` | JSON | **already covered** — the key-path mode reports `packages["node_modules/foo"].version: "1.2.3" → "1.2.4"`, which is exactly the summary. It opens Raw only because of the noise rule, and only because the file usually exceeds the 1 MB text cap |
| `go.sum` | one `module version hash` per line, sorted | the text diff is already a perfectly good dependency summary. Nothing to do |
| `Cargo.lock` | TOML | needs a TOML parser |
| `pnpm-lock.yaml` | YAML | free if decision 2 is taken |
| `yarn.lock` v1 | bespoke | needs a bespoke parser |
| `yarn.lock` berry | YAML | free if decision 2 is taken |

**Large-file behaviour.** This is the binding constraint and it is not about
parsing. A real `package-lock.json` is several megabytes, so both sides are
refused by `MAX_BLOB_BYTES` (1 MB) before any parser is reached. A dependency
summary would need either a much larger text cap — which puts multi-megabyte
strings through `runtime.sendMessage` — or a fundamentally different approach:
**derive the summary from the patch alone**, which is already in the payload
and costs nothing.

That last idea is the interesting one. A lockfile patch's added and removed
lines contain the version strings; pairing `"version": "x"` removals with
additions under the same enclosing key would give a real summary from data
already in hand, with no fetch, no cap and no parser.

**Recommendation: do nothing for now, and consider the patch-derived summary as
a separate piece of work.** It is a genuinely good idea and it is not a
comparison mode — it is a different feature that happens to live on the same
card. Taking decision 2 gets `pnpm-lock.yaml` and berry `yarn.lock` incidentally
for the ones small enough to load.

### Decision 7 — Image difference: a blend, or a number?

The difference mode today is `mix-blend-mode: difference` over two stacked
`<img>`s: pure CSS, no decode, no canvas, works at any size the browser will
paint. It answers "where did it change" beautifully and "how much" not at all.

A canvas version could answer both: draw both images, `getImageData`, count
differing pixels, report "3.4% of pixels changed" and draw a bounding box round
each changed region. Object URLs created in this page are same-origin, so the
canvas is **not** tainted and `getImageData` is available. **UNVERIFIED** — not
tested; the claim is from the same-origin rules for `blob:` URLs, not from an
experiment.

| Option | Cost | Buys |
| --- | --- | --- |
| A. CSS blend (current) | 0 | where it changed, instantly, at any size |
| B. Canvas diff, hand-written | ~80 lines | a percentage and bounding boxes; needs a pixel budget |
| C. `pixelmatch` 7.2.0, ISC, 2026-04-29, 21,538 B unpacked | one small dependency | anti-alias-tolerant matching, a proper threshold |

**Large-file behaviour.** A is free. B and C are O(pixels) and would need a
ceiling — a 6000×4000 photograph is 24 million pixels and ~96 MB of
`ImageData` per side. That cap is the real design work, not the diffing.

**Recommendation: A, and add B behind the same mode if a number is wanted.**
`pixelmatch` is small, ISC and well maintained, and it is the right choice *if*
this is done — but the reason to do it is a number, and a number needs a
pixel budget that is most of the effort either way.

### Decision 8 — XML and HTML: a structural comparison for free?

`pom.xml`, `.csproj`, `.plist`, Android manifests, `.svg` source, RSS. These
have the same reformatting problem as JSON, and the browser ships a parser:
`DOMParser.parseFromString(text, 'application/xml')`. No dependency at all.

The walker in `lib/compare/structured.ts` is written against plain JavaScript
values, so an XML-to-plain-object adapter — element name, attributes, children
— would reuse it whole. Perhaps sixty lines.

**Large-file behaviour.** `DOMParser` is linear and bounded by the 1 MB text
cap; the existing `JSON_LIMITS` bound the walk.

**Safety.** Parsed as `application/xml`, not `text/html`, and never inserted
into the document — only walked as data. No script runs.

**Recommendation: worth doing, and cheaper than it sounds.** It was not done
because it is the least certain of the "obvious" items: XML's data model
(attributes versus children, mixed content, namespaces) does not map onto the
JSON walker as cleanly as YAML does, and getting that mapping wrong produces a
comparison that is confidently wrong rather than absent. It needs a design
decision about how attributes are pathed, which is a smaller version of the
same question this document exists to ask.

### Decision 9 — Archives

`.zip`, `.jar`, `.vsix`, `.crx`. A file-list comparison — what entered, what
left, what changed size — is the only useful view.

`fflate` 0.8.3, MIT, modified 2026-07-20, 796,742 B unpacked, would do it. But
committed archives are rare outside a few ecosystems and are usually build
output that the noise rules already hide.

**Recommendation: do nothing.** Reopen if a repository in real use commits
them.

### Decision 10 — Video and audio

`<video src="blob:…">` and `<audio>` accept object URLs; a side-by-side of two
`<video controls>` elements is nearly free.

The obstacle is size. `MAX_BINARY_BYTES` is 4 MB and a committed video is
rarely under that, so the honest expectation is that this feature would almost
always report "too large". Raising the cap runs into decision 11.

**Recommendation: do nothing until decision 11 is settled.** If the transport
changes to something that streams, a side-by-side video mode is a small
addition on top of it.

### Decision 11 — The byte ceiling and how bytes travel

Today: the worker `fetch`es the blob, base64-encodes it, and sends it as one
JSON message. 4 MB of file is 5.4 MB of string; both sides at once is eleven
megabytes of string built in the worker, serialized, parsed on the page and
thrown away.

| Option | Cost | Buys | Large-file behaviour |
| --- | --- | --- | --- |
| A. Current: base64 in one message, 4 MB cap | 0 | works, simple, tested end to end in Chrome | refuses above the cap with a sentence |
| B. Chunk over a long-lived `runtime.connect` port | ~100 lines both ends | a much higher ceiling; progress reporting | still holds the whole file in memory on both sides |
| C. Worker creates the object URL and sends the URL | ~20 lines | no encoding at all; no size limit worth naming | **UNVERIFIED, and probably not viable**: a `blob:` URL is scoped to the origin *and agent cluster* that created it. Whether a URL minted in an MV3 service worker resolves in an extension page is exactly the kind of thing that works in one Chrome version and not the next. Must be tested before it is believed |
| D. Raise the cap and keep A | 0 | bigger images | the stall is quadratic-feeling in practice; 20 MB of base64 through `sendMessage` is a visible freeze |

**Recommendation: A, and test C.** If C works it is strictly better than
everything else here and deletes the base64 path entirely. If it does not, A is
the right shape and the cap is the right kind of answer — a screenshot larger
than 4 MB is not one whose pixels anybody is comparing.

### Decision 12 — Delete the unreachable WASM chunk

Not a diff type, but it is the largest single thing in this bundle and it
belongs in any conversation about size.

`chunks/wasm-*.js` is 622,325 bytes of base64 WebAssembly, dynamically imported
by Shiki only on the `shiki-wasm` branch. This project never selects that
engine — `DiffColumn` deliberately never sets `preferredHighlighter`, and there
is a test asserting the absence, because the wasm path works in development and
dies silently in a build with no CSP key.

The chunk is emitted because the dynamic `import()` is statically visible to
the bundler. **UNVERIFIED**: whether a Rollup `external` entry, a resolver
alias to an empty module, or a `manualChunks` exclusion can drop it without
breaking Shiki's module graph.

**Recommendation: spike it.** Half a megabyte, for code that provably cannot
execute in this extension. It would pay for every other decision in this
document combined.

---

## 5. Types deliberately left as "binary file changed"

For these the honest answer really is a good sentence, and the sentence now
names what happened — added, removed or changed — rather than only that it is
binary:

- Compiled output: `.wasm`, `.so`, `.dll`, `.class`, `.pyc`, `.o`
- Office and design documents: `.docx`, `.xlsx`, `.pptx`, `.sketch`, `.fig`,
  `.psd`. Each is a zip of XML with a bespoke schema; a useful comparison is a
  product, not a mode.
- Databases and stores: `.sqlite`, `.db`, `.mmdb`
- Certificates and keys: `.p12`, `.pfx`, `.der`. Rendering these would be
  actively unhelpful and mildly alarming.
- Source maps `.map`: JSON in content, but the registry keys on the extension
  and `map` is not in it, so they get Raw. That is deliberate rather than an
  oversight — they are generated, enormous, and a key-path list of `mappings`
  would be noise on top of noise. They are usually caught by the `dist/**`
  noise rule anyway.

---

## 6. What to answer

In rough order of value per byte:

1. **Decision 2 (YAML).** The biggest real gap; reuses an engine that exists.
2. **Decision 12 (drop the WASM chunk).** Pure win if it works.
3. **Decision 3 (JSONC).** Nine kilobytes, removes a visible wart.
4. **Decision 11 (test the worker-minted object URL).** Might delete a whole
   code path.
5. **Decision 8 (XML via `DOMParser`).** No dependency, needs a design call.
6. **Decision 1 (Markdown).** The most-requested and the least clearly useful.
7. Everything else — decisions 4, 5, 6, 7, 9, 10 — is reasonable to leave.
