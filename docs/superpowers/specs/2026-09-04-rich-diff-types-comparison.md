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

**Correction, 2026-09-05.** The sizes below are mostly `dist.unpackedSize`, and
that unit is misleading enough to have changed two of the recommendations. A
tarball carries the CJS build *and* the ESM build *and* the types *and* the
sourcemaps *and* the tests; a bundler takes one path through one of them. Where
it matters, the honest number is now given as **the output of `esbuild
--bundle --minify` on a file importing only the one function needed, gzipped**,
and it runs five to twenty times smaller:

| Package | Unpacked | Bundled, minified, gzipped |
| --- | --- | --- |
| `yaml` (`parse`) | 685,953 B | **30,427 B** |
| `smol-toml` (`parse`) | 109,164 B | **4,372 B** |
| `jsonc-parser` (`parse`) | 212,821 B | **3,313 B** |
| `fflate` (`unzipSync`) | 796,742 B | **2,769 B** |
| `pixelmatch` | 21,538 B | **1,485 B** |
| `marked` | 479,846 B | **12,852 B** |
| `dompurify` | 1,802,029 B | **11,081 B** |

Those last two shipped on 2026-09-05 (§3.7). Their measured cost together, in a
real build rather than in isolation, was **+25,860 B gzipped** — less than the
sum above, because a bundle shares what its dependencies have in common.

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
| JSON | `json` `jsonc` | Key paths · Formatted · Raw | `lib/compare/structured.ts` |
| YAML | `yaml` `yml` | Key paths · Formatted · Raw | same, via `lib/compare/syntax.ts` |
| TOML | `toml` | Key paths · Raw | same |
| Notebook | `ipynb` | Cells · Cells and outputs · Raw | `lib/compare/notebook.ts` |
| Markdown | `md` `markdown` `mdown` | Rendered diff · Raw | `lib/compare/markdown.ts` |
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

**No dependency was added by that change.** Five have been added since, all on
2026-09-05: three when decisions 2 and 3 were taken (§3.6), and two more when
decision 1 was (§3.7). A sixth — `htmldiff-js` — was vendored instead.

For scale, the thing already in the bundle: `chunks/wasm-*.js` is **622,325
bytes — 230,057 gzipped**, measured on 2026-09-05 — of base64-encoded WebAssembly, reachable only from Shiki's
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

### 3.6 Three syntaxes share one engine, and TOML is denied one mode

Decisions 2 and 3 were taken on 2026-09-05, and the TOML gap this document had
under-sold was taken with them. `lib/compare/syntax.ts` is the whole of the
seam: three parsers in, one plain value out, and the walker in
`structured.ts` — renamed `compareStructured`, since it no longer only compares
JSON — never learns which spelling it was handed.

| Package | Version | Licence | Modified | Bundled + gzipped | For |
| --- | --- | --- | --- | --- | --- |
| `yaml` | 2.9.0 | ISC | 2026-05-11 | 30,427 B | `.yaml` `.yml` |
| `smol-toml` | 1.8.0 | BSD-3-Clause | 2026-08-11 | 4,372 B | `.toml` |
| `jsonc-parser` | 3.3.1 | MIT | 2026-07-16 | 3,313 B | `.json` `.jsonc` |

All three are exact-pinned rather than caret-ranged, as `@pierre/diffs` is.
None contains `eval` or `new Function` in the path `exports` points at, grepped
from the extracted tarballs. None has a dependency of its own.

**Measured cost.** Building this working tree before and after with
`npx wxt build`: `chunks/review-*.js` went 727,178 → 845,932 B raw and
**204,135 → 240,999 B gzipped, +36,864 B (+18.1%)**. The CSS is untouched.
That is still 160 kB gzipped less than the dead WASM chunk in decision 12.

Three calls inside it are worth recording, because each is the kind that would
otherwise be rediscovered:

**`.json` is parsed as JSONC, always.** Not a new extension — the problem was
never `.jsonc` files, which are rare. It was that `tsconfig.json`,
`.eslintrc.json` and everything under `.vscode/` are JSONC wearing a `.json`
extension, and `JSON.parse` refuses them. `jsonc-parser` reads strict JSON
identically, so there is no second path and nothing to choose between.

**A recovering parser is not believed.** `jsonc-parser` is built for an editor,
where returning a value for a half-typed document is correct behaviour: handed
`{ not json` it returns `{}` and a list of errors. Reading the value and
ignoring the errors would report every key in the file as deleted. The error
list is authoritative, and there is a test that fails if it stops being.

**TOML is not offered the formatted mode.** The formatted view exists so that a
pure reformatting shows as no change. JSON and YAML both have comment-preserving
formatters — `jsonc-parser`'s `format`/`applyEdits`, and `yaml`'s
`parseDocument().toString()` — and both are used, so neither loses a `#` line or
a `//` line. `smol-toml` has no such formatter, and re-serializing from the
parsed value would make a comment-only change in a `Cargo.toml` show as *no
change at all*. That is not a smaller claim than the text diff's, it is a wrong
one, so the mode is absent — the same rule that already withholds onion-skinning
from a newly added image.

### 3.7 Markdown is a rendered *diff*, and the sanitiser runs last

Decision 1 was taken on 2026-09-05. Four calls inside it are worth recording.

**The obvious mode was not built.** Rendering both sides and putting them side
by side is the thing everyone asks for and it is worse than what it replaces:
two blocks of formatted prose have to be compared by eye, where the source diff
at least paints the words that moved. Formatting *removes* the marks. So the
mode renders the new document and marks the insertions and deletions inside it
— the one arrangement that keeps the formatting and the marks at once.

That is also why the mode is `needsBothSides`. On an added or deleted `.md`
there is no what-changed, only a document, and a button labelled "Rendered
diff" that can only produce a preview is the rejected mode wearing a diff's
clothes. A new file's raw diff is already every line in green. Same rule as the
onion skin on a new image, and as the formatted mode on TOML.

**`htmldiff-js` is vendored, not depended on.** ISC, 9,565 B minified, untouched
since 2022-05-05. Four reasons, any two sufficient: its `main` is
`dist/htmldiff.min.js`, a webpack-4 UMD bundle with no `module` field, no
`exports` map and no types, so depending on it means shipping an unreadable ES5
blob into the origin that holds the token; a dormant package with a live publish
key is the shape this document already refused for `toml`; at that size
outsourcing trust buys very little; and reading it found four defects, three of
which TypeScript will not compile. All four are real and were reproduced against
the published bundle — `< >` in a document throws `TypeError`, its
block-expression feature throws `ReferenceError: index is not defined`, and a
module-scope `/…/ig` used with `.test()` makes the same two documents diff
differently on the second call (107 of 40,000 random pairs) and makes an
unrelated file diffed in between change the answer for one already on screen
(77 of 40,000). The port is byte-identical to a `g`-flag-corrected upstream over
**40,000 random document pairs**, so the algorithm is upstream's and only the
defects moved.

**Sanitisation happens after the diff, never before.** Both are true and only
the ordering is subtle. Sanitising each side first would look tidier and is
unsound: the word diff then splices tags into the token stream at positions it
chooses, assembling new markup out of markup already declared safe with nothing
left to check the join. So `lib/compare/markdown.ts` returns a field named
`unsafeHtml`, and `ui/markdownHtml.ts` is the only thing that reads it. The
seam falls exactly where the existing `lib`-is-pure rule already put it, because
DOMPurify needs a `Document`.

The configuration is DOMPurify's, narrowed four ways, each of which was ablated
to confirm a test fails without it: `USE_PROFILES: { html: true }` — because the
default allows inline SVG and MathML, and §3.3 already decided SVG from a pull
request never renders inline in this origin; `FORBID_TAGS` for `img` and the
form controls; `FORBID_ATTR` for `style` and `id`; and `ALLOW_DATA_ATTR: false`,
which is load-bearing rather than tidy — this page finds threads with
`querySelectorAll('[data-thread]')` and a reply box with
`querySelector('[data-reply-for="…"]')` that it casts to a textarea.

Markdown images are rendered as *text* rather than as `<img>`, which is one step
beyond §3.3: an absolute `src` in a `.md` file is a network request that needs
no script and tells a third party who is reviewing what, from where, from inside
this origin — and a relative one has nothing to resolve against. Naming the file
also makes swapping an image a change the word diff can mark, which two `<img>`
tags could not be, since the diff strips attributes before comparing.

**The ceiling is on work, not on size, because size does not predict the cost.**
`MARKDOWN_LIMITS` caps the source at 64,000 characters and the rendered HTML at
80,000, both cheap to check. Neither is sufficient. Measured: 37,000 characters
of rendered Markdown with one word changed per section diffs in 568 ms, and
40,000 characters of *one word repeated* takes 10,952 ms — nineteen times, at
the same size — because every block index key collides. At 160,000 characters
that shape takes three and a half minutes. So `HTML_DIFF_BUDGET` (2,000,000
comparisons) bounds the match finder the way `ALIGN_BUDGET` bounds row
alignment, and `diffHtml` returns null rather than a half-marked document,
which is the one failure a reviewer could not see. The number is calibrated
rather than chosen: this repository's own README needs 21,829 of it, this
document needs 92,840, seventy-five kilobytes of varied prose needs 1,945,059,
and the pathological shapes give up inside 500 ms.

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

**Taken on 2026-09-05: E.** `marked` 18.0.11 (MIT) and `dompurify` 3.4.14
(MPL-2.0 OR Apache-2.0), both exact-pinned; `htmldiff-js` **vendored rather
than depended on**. The `.md` `.markdown` `.mdown` extensions get a `markdown`
kind offering one mode — *Rendered diff* — plus Raw. §3.7 has the rest.

The rejection above rested on a number that was never measured. The real cost,
built before and after with `npx wxt build`, is **+25,860 B gzipped** on
`chunks/review-*.js` and +268 B gzipped on the CSS: a ninth of the dead WASM
chunk in decision 12, for the file type a pull request contains most often.

The `marked` advisories this section flagged as **UNVERIFIED** are resolved.
There are two, both from January 2022 — GHSA-rrrm-qjm4-v8hf and
GHSA-5v2h-r2cx-5xgj — and both are `marked <= 4.0.9`, patched in 4.0.10;
confirmed by auditing a tree pinned to 4.0.9 and watching them appear.
`npm audit --omit=dev` on this tree reports zero. Verified behaviourally as
well, because a version range is a claim about metadata: 18.0.11 was timed
against the published proof-of-concept shapes for both advisories and is
linear on all of them — 5,000 stacked `[` characters parse in 9.7 ms and
20,000 spaces inside a `block.def` in 0.1 ms.

### Decision 2 — YAML: structural comparison? — **TAKEN, `yaml` 2.9.0**

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

**Taken on 2026-09-05.** B, at 30,427 B gzipped rather than the 685,953 B this
table implies — see the correction in §0. `parseDocument` is used rather than
`parse`, so the formatted mode keeps the comments and the error carries a line
number. §3.6 has the rest.

### Decision 3 — JSON with comments — **TAKEN, `jsonc-parser` 3.3.1**

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

**Taken on 2026-09-05.** B, at 3,313 B gzipped, and applied to *every* `.json`
file rather than to a new `.jsonc` extension — the wart was never on `.jsonc`
files. Trailing commas came along with it. §3.6 records the one trap: this
parser recovers from broken input by design, so its error list rather than its
return value is what decides whether a document was read.

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

### Decision 13 — A rich card in the middle of the column mis-measures — **PARTLY FIXED**

Found on 2026-09-05 while taking decision 1, and it is not a Markdown problem —
Markdown is only the first file type common enough to expose it.

`CodeView` sizes a collapsed item from one global metric and never measures it
at all. Read `computeApproximateSize` in `VirtualizedFileDiff`: it adds the
header region and, if the item is collapsed, **returns there** — before the
measured correction the expanded path applies. There is no per-item height input
anywhere in its options, so no version bump, re-render or reconciliation can
correct it; the arithmetic has nowhere to put the number. Every rich comparison renders in
a collapsed card's header, and its body arrives later, from the worker: a
rendered Markdown diff settles at ~153 px, an image at ~126 px, a CSV grid at
~179 px. The shortfall is scroll range the viewer does not know it has, it
accumulates down the column, and past `.column-tail`'s 40vh of slack the last
card can no longer be scrolled to the top — which puts its mode buttons below
the fold with nowhere left to go.

Until now every rich file in the browser fixture was at the *bottom* of the
column, where the tail absorbed it: image plus table costs ~229 px and fits.
Two rendered-Markdown cards above them cost ~459 px and do not. **Reproduced on
the commit before Markdown existed** by moving a single `.csv` into the middle
of the fixture's file list, which fails the same two tests — so the cause is
rich cards in general.

| Option | Cost | Note |
| --- | --- | --- |
| A. Grow `.column-tail` | one number | Hides it for one more card and adds dead space to every pull request. The error is cumulative, so this never closes |
| B. Observe the header slots | ~20 lines | A `ResizeObserver` per mounted item, telling `CodeView` its height moved. `CodeView` already constructs one, for its root and its sticky container only |
| C. Reserve a fixed height per rich mode | ~10 lines of CSS | `min-height` on each comparison so the card's height is known before its content arrives. Cheap, and wrong for a two-line document |

**Recommendation: B, and do not grow the tail in the meantime.** The number in
`.column-tail` is load-bearing for the reason it was written and growing it to
cover this would quietly couple the two. The browser fixture keeps its `docs/`
files as `.txt` so that it goes on testing what it was built to test; the
consequence is that **the Markdown mode has no browser coverage**, which is the
main thing worth fixing about it once B lands.

**Fixed on 2026-09-05.** `lib/review/columnTail.ts` sizes `.column-tail` to
cover the shortfall, on the one element whose height the viewer does measure.
Two things were learned doing it, both from the shipped package and neither
documented:

- **A second measurement bug sits behind the first.** `reconcileHost`
  re-measures the footer only when the render callback's *identity* changes, and
  the React wrapper replaces that callback with a stable internal `noopRender`
  and delivers the real content through a portal. Its `ResizeObserver` does
  observe the footer element, and `handleResize` drops every entry that is not
  the sticky container. So the footer is measured exactly once, at mount, and a
  tail that grows afterwards is ignored — the core goes on clamping scroll to
  the stale number. That is why the slack is *estimated from the file list* at
  mount rather than measured from the headers as they settle: the measurement
  arrives long after the only reading that counts has been taken.
- **The reachability and the aim are separate symptoms.** Sizing the tail
  restores how far the column *can* scroll, and it does not fix where
  `scrollTo({type: 'item'})` lands, because that targets the item's modelled
  top and is short by the deficit of every rich card above it. Measured: with
  three rich cards above it, choosing the last file from the tree lands 331 px
  short. A post-hoc correction was tried — measure the card and adjust
  `scrollTop` over a few frames — and made it *worse*, 331 px to 607 px,
  because `CodeView` re-clamps and re-anchors a manual write. It was backed out
  rather than shipped unproven. **This half is still open.**

- **A third symptom, found on 2026-09-06, and the one a reviewer notices
  first: the column skips cards.** Reported against the `test/diff-fixtures`
  pull request, whose first four files are a `README.md` and three binaries —
  four rich cards in a row. Scrolling down from the top goes straight past the
  zip, the woff2 and the pdf and lands on `code/app.js`. Measured in Chrome on
  the browser fixture, walking the scrollport 25 px at a time and watching one
  card's top: the content tracks the scroll exactly, 25 px for 25 px, until an
  item is *released* at the top of the render window — and then it lurches by
  that item's whole under-count.

  | released card | real header | lurch |
  | --- | --- | --- |
  | `docs/readme.md` | 166 px | 122 px |
  | `docs/changelog.md` | 153 px | 109 px |
  | `assets/logo.png` | 126 px | 82 px |

  Each lurch is the card's real header less the 44 px the metric assumes, to
  the pixel. It is the same wrong number seen from the other side: `CodeView`
  picks its render window from modelled tops and anchors the mounted stack at
  the modelled top of the first item in it, so releasing a card that was
  modelled 122 px short pulls everything below it up by 122 px in one frame.
  Four in a row is ~300 px of the review vanishing over a few pixels of scroll.
  A plain-text control walked over the same distance holds 1.00 throughout.

  **None of this is the page moving the scroll.** `shouldScrollDiff` is false
  for `origin === 'scroll'`, so a scroll never scrolls back, and the only
  `scrollTo` calls in the column are hunk navigation, a tree click and a thread
  jump. Nor is it the tail: `recomputeLayout` accumulates item heights alone
  and the tail is the footer, after every item, so it can change how far the
  column scrolls and nothing about where an item is modelled. Ablating it
  reproduces the *original* defect instead — `scrollHeight` falls to 4,458,
  max scroll to 3,830, and the last card sits at 641 px in a 628 px scrollport.

- **1.4.1 fixes one of the two library bugs and not the other.** Checked on
  2026-09-06 against the published package rather than its notes, then
  **upgraded to it**. `handleResize` gained a branch for the header and footer
  host elements that calls `setHostHeight(host, blockSize)`: growing the tail
  by 940 px after mount now takes `scrollHeight` from 5,018 to 5,958 and the
  scroll reaches the new end, where 1.3.6 ignored it entirely. So the estimate
  above is no longer *forced* and a `ResizeObserver` over the mounted headers
  could set the true shortfall — deliberately, though, not as a side effect of
  a dependency bump. `computeApproximateSize` is unchanged: a collapsed item is
  still one global metric and `CodeViewDiffItem` still carries no per-item
  height, so **the skipping survives the upgrade**.

  Three other things the upgrade turned up, all measured rather than read:

  - **A new patch under an existing item id now draws.** Through 1.3.6
    `CodeView` kept the code it first rendered for an id, which is what
    `diffGeneration` remounts around; 1.4.1 draws the new patch. The remount
    stays for the weaker reason that every card's collapsed and mode choice was
    made about a comparison that no longer exists.
  - **The first viewer on a page now waits for the highlighter.** With
    `disableWorkerPool` — which this project always sets — 1.3.6's `isReady`
    answered `true` on the spot; 1.4.1 defers to `isSharedHighlighterReady` and
    renders nothing until `preloadHighlighter` resolves. In jsdom that put the
    custom headers one macrotask out, so whichever test was *first in its file*
    failed and the identical second one passed. `ui/testSetup.ts` warms the
    shared highlighter, which is the same job as its `ResizeObserver` and
    `scrollTo` polyfills; not one assertion changed.
  - **The rendered rows are now replaced wholesale once, after first paint.**
    A `MutationObserver` on the shadow roots from before first render: 1.3.6
    removes 2 nodes and settles; 1.4.1 removes 44 and adds 44 back, about
    200 ms after the first card appears. Harmless to a reviewer, who cannot
    click that fast, and enough to detach an element a browser test had already
    resolved.

- **The route out of this is proven, on 2026-09-07, and it is the annotation
  API.** `reconcileHeights` *measures* a file-level annotation and folds it into
  the item through `setFileAnnotationHeight` → `measuredHeightDeltaTotal`, which
  the non-collapsed path of `computeApproximateSize` adds to the height. That is
  the per-item number the options do not have, reached through a public API this
  page already uses for comment threads.

  Two things were checked rather than assumed. In jsdom, an item with
  `hunks: []` and `collapsed: false` **does** get a `data-line-annotation` host,
  and the React content is projected into it through the light DOM; collapsed
  gets no host at all, so the item has to be expanded. Then in Chrome, against
  the browser fixture, one image card was temporarily given an empty diff,
  `collapsed: false` and a `lineNumber: 0` annotation 200px tall:
  `scrollHeight` went **5,018 → 5,218 at the moment the card mounted**, exactly
  the annotation's height, and stayed there after the card was released again.
  The library measured it and kept it.

  The same spike also showed what the fix has to include. Widening it to every
  rich card did **not** remove the lurching, because it only *added* a measured
  annotation and left the comparison in the custom header, which is still sized
  at the 44px metric. So attaching an annotation is not enough: the comparison
  has to **move out of the header and into it**. The header keeps the fixed row
  it is modelled as — name, counts, viewed, mode buttons, collapse — and the
  variable-height body becomes the measured annotation.

  Two design questions to settle before starting. The per-file list of threads
  the diff cannot show is also variable-height and also in the header
  (`src/beta.ts` measures 92px against the same 44px metric), so it needs the
  same treatment or a deliberate exemption. And a collapsed rich card should
  carry no annotation, so that collapsing goes on meaning "header only".

---

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

Decisions 2 and 3 were taken on 2026-09-05, along with TOML, which this
document had only mentioned in passing under lockfiles. What is left, in rough
order of value per byte:

1. **Decision 12 (drop the WASM chunk).** Pure win if it works, and now the
   largest item by a distance: 230,057 B gzipped of code that provably cannot
   execute here, against 36,864 B for all three parsers together.
2. **Decision 11 (test the worker-minted object URL).** Might delete a whole
   code path.
3. **Decision 8 (XML via `DOMParser`).** No dependency, needs a design call.
   `pom.xml`, `.csproj`, `.plist` and Android manifests would join the same
   walker the three syntaxes above now share, which makes the adapter the only
   work left in it.
4. ~~**Decision 1 (Markdown).**~~ **Taken on 2026-09-05**, as option E and at
   **+25,860 B gzipped** rather than the 27,341 B estimated — `htmldiff-js` was
   vendored rather than depended on, which is where most of the difference
   went. §3.7 records it.
5. **Decision 13 (rich cards mis-measure).** The reachability half was fixed
   on 2026-09-05 — see the section above — and `docs/readme.md` is back in the
   browser fixture with the sanitiser test jsdom could not make. **Two halves
   are still open**, both reported or measured on 2026-09-06: where
   `scrollTo({type: 'item'})` lands, and the column skipping cards as it
   releases them. They are the same missing number, and no fix for either sits
   inside the library's options — it takes moving a rich comparison out of the
   card header, which is where the next design call is.
6. Everything else — decisions 4, 5, 6, 7, 9, 10 — is reasonable to leave.

Two libraries examined on 2026-09-05 and rejected outright, recorded so nobody
re-examines them:

- **`xlsx` (SheetJS) must not be used from npm.** The registry reports a
  `time.modified` of 2026-07-17, which reads as maintained. It is not: the last
  actual publish is **0.18.5 on 2022-03-24**, and the prototype-pollution and
  ReDoS fixes exist only in the builds SheetJS self-hosts. The recent timestamp
  is metadata churn on an abandoned package.
- **`toml`, the npm package, is not the TOML parser to take.** Dormant since
  2019, then 4.1.2 to 5.0.0 inside a fortnight in July 2026. That may be a
  genuine revival, but it is also the shape of a takeover, and `smol-toml`
  (BSD-3-Clause, continuously maintained, 4,372 B gzipped) needs no such
  judgement. `@ltd/j-toml` is LGPL-3.0 and stale since 2023.

**Every dependency was taken to its latest publish on 2026-09-07** — `npm
outdated` reports nothing. That included two majors, each verified rather than
assumed: **Vitest 5.0.0** needed no config change, and **TypeScript 7.0.2**, the
native compiler, typechecks the project clean. "Clean" on a compiler this new is
worth nothing unverified, so it was ablated — a `noUncheckedIndexedAccess`
violation and a bad assignment both still fail it, TS18048 and TS2322.

**Four high-severity advisories are left in place, deliberately.** All four are
one issue: a denial of service in `image-size`'s ICNS parser, reached through
`addons-linter` → `web-ext` → `wxt`. Three things decide it. `npm audit
--omit=dev` reports **zero**, so none of it reaches the extension. `image-size`
2.0.2 is the latest publish and still carries the advisory, so there is nothing
to upgrade to. And npm's own `fixAvailable` is a **downgrade** — `web-ext` to
5.5.0 and `wxt` to 0.20.27 — which would give up the MV3 tooling this project is
built on. Trading that for a dev-time image-parser DoS is the wrong way round.
