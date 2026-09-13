# Reviewing Markdown — commenting on rendered prose, and a mode that is remembered

**Date:** 2026-09-12
**Status:** Design approved, not yet implemented. Every decision below is taken;
the open items are marked **UNVERIFIED** and must be checked before they are
relied on.

## 0. Provenance and trust rules

Same contract as `2026-09-04-rich-diff-types-comparison.md`, which this document
amends. Every version, licence, size and behavioural claim was read out of
something real — the npm registry, a package installed in a scratch directory, a
`vitest` probe against this working tree, or `esbuild` on a bundle — on
**2026-09-12**. Sizes are the output of `esbuild --bundle --minify` on a file
importing only what is needed, gzipped, because `dist.unpackedSize` counts the
CJS build and the ESM build and the types and the sourcemaps and the tests, and
a bundler takes one path through one of them.

Anything that could not be verified is marked **UNVERIFIED** in bold.

---

## 1. What this is

Two requests, which turn out to share a spine.

**A reviewer cannot comment on a rendered Markdown diff.** The mode ships and is
the default for `.md`, and it is a dead end: `showsTextDiff` in `ui/diffItems.ts`
is true only in the raw mode, so every rich mode is handed `emptyDiffFor(file)` —
a diff with no hunks. No hunks means no gutter, no line selection and no
composer. Worse, every existing thread on the file falls through to the
`UnanchoredThreads` drawer, collapsed, where a reviewer will not find it. To say
anything at all about a documentation change you press Raw, which is the mode the
rendered view was built to replace.

**The mode switcher forgets everything.** Pressing Raw on a `.md` file applies to
that file, in that pull request, until the page is reloaded. `ui/ModeSwitcher.tsx`
states this as a principle and §2 of the comparison spec lists it as one of three
rules that hold across every kind.

Investigating the first found two defects in the shipped feature that are more
serious than either request. §3 has them.

---

## 2. What was decided

| # | Decision | Reverses |
| --- | --- | --- |
| 1 | Renderer moves from `marked` to `markdown-it` | §3.7 of the comparison spec |
| 2 | Every block carries its source line on a nonce-scoped attribute | — |
| 3 | The sanitiser allows exactly one named `data-*` attribute | `ui/markdownHtml.ts` |
| 4 | The document is split into per-block React elements | `ui/MarkdownCompare.tsx` |
| 5 | Every block is commentable; blocks outside the diff post file-level | — |
| 6 | Threads render under the block they belong to | — |
| 7 | The Markdown mode is remembered across files and pull requests | `ui/ModeSwitcher.tsx` |

Each is argued below. Decisions 1, 3, 4 and 7 edit files whose comments explain
why the opposite was chosen, so those comments are amended rather than deleted —
a future reader loosening one further should have to read what it was for.

---

## 3. Two defects found on the way, which set the priority

Both were reproduced against this working tree with `vitest` probes.

### 3.1 Ticking a checkbox renders as no change at all

```
compareMarkdown('- [ ] ship it', '- [x] ship it')
  → status: 'ok'
  → sanitised: <ul> <li> ship it</li> </ul>
```

Status `ok`, and a document with **zero marks**. Three shipped decisions
compound:

- `marked` with `gfm: true` renders a task list as `<input type="checkbox">`,
  and the checked state as an *attribute*.
- `htmlDiff` reduces every tag to its name before comparing — `stripAttributes`,
  and deliberately so, since attribute changes are invisible to this diff by
  design. `<input checked>` and `<input>` are the same token.
- The sanitiser's `FORBID_TAGS` includes `input`, so both are removed anyway.

The result is a rendered *diff* that draws the whole document and marks nothing,
for a change the reviewer can plainly see on github.com. A view that silently
reports a real change as no change is the one failure mode this feature exists
to prevent, and it is worse than the absent view §3.7 was arguing against.

### 3.2 Authored strikethrough is painted as a diff deletion

`marked` renders `~~struck~~` as `<del>`. `entrypoints/review/style.css` styles
`.markdown-rendered del` — a bare element selector, not `.diffdel` — with the
danger background and a line through it. So a struck-through word a human wrote
is drawn identically to a word the diff says was removed, and, since the comment
above that rule correctly observes that `<del>` carries its meaning to a screen
reader on its own, it is *announced* as removed content too.

`markdown-it` emits `<s>` for strikethrough, which fixes this by construction
and is the second reason decision 1 is not merely ergonomic.

---

## 4. Decision 1 — `markdown-it` replaces `marked`

### Why the renderer changes at all

Commenting on rendered prose needs to know which source line a block came from.
`marked` does not carry positions: the workable trick is to call `lexer`, walk
the top-level tokens accumulating `raw` lengths into a `WeakMap<Token, number>`,
then call `parser` on the same objects. That was verified to work, and it is
about fifteen lines of offset arithmetic we would own, correct only for
top-level blocks — nested `raw` offsets are not relative to the document, so a
list is one anchor and its items are none.

`markdown-it` hands the same information over as `token.map`, a `[startLine,
endLine]` pair present on every block token including list items and table rows.
Injecting the anchor is a four-line core rule. Verified:

```
heading_open     map [0,1]        bullet_list_open map [4,7]
paragraph_open   map [2,3]        list_item_open   map [4,5]
fence            map [7,10]       table_open       map [11,14]
```

The layer that would have been the most fragile thing in this design stops
existing.

### What it costs

The three candidates weighed against each other on a scratch `esbuild --bundle
--minify` build, gzipped. This compares renderers; it does not measure this
project, and that distinction is why the real number below was owed:

| Renderer | Bundled gz | Source positions | Packages |
| --- | --- | --- | --- |
| `marked` 18.0.11 | 13,191 B | none | 1 |
| **`markdown-it` 15.0.2** | **41,665 B** | `token.map`, every block | **1** |
| `unified` + `remark-parse` + `remark-gfm` + `remark-rehype` + `rehype-stringify` | 50,144 B | `node.position`, every node | 5 |

remark was rejected: it costs more, needs five packages, and the extra it buys —
positions on *inline* nodes — is not wanted, because GitHub anchors a comment to
a line and not to a word.

**Measured on the real build, 2026-09-12.** `npx wxt build` at `04ad174^`
(`marked` 18.0.12) and at `04ad174` (`markdown-it` 15.0.2) — the swap and
nothing else — in a clean worktree with `npm ci` at each, which is how §2 of
`2026-09-04-rich-diff-types-comparison.md` measured the rich modes. Gzipped with
`gzip -9`:

| Artifact | Before | After | Delta |
| --- | --- | --- | --- |
| `chunks/review-*.js` | 864,218 B | 918,687 B | **+54,469 B (+6.3%)** |
| same, gzipped | 247,276 B | 275,528 B | **+28,252 B (+11.4%)** |
| `assets/review-*.css` | 39,278 B | 39,278 B | 0 |
| same, gzipped | 7,573 B | 7,573 B | 0 |

**The estimate held.** The scratch figure claimed +28,474 B gzipped and the real
one is +28,252 B — 222 bytes lower, 0.8% out. That is closer than a scratch
build has any right to be in general, and the reason it is close here is the
shape of the change rather than luck: one dependency in, one out, nothing shared
between them for the bundler to fold away, and not a byte of stylesheet either
way. The cost was accepted knowingly and it is the cost that was described.

It roughly doubles what the Markdown feature cost when it shipped (+25,860 B for
`marked` and `dompurify` together). That is the price of the defects in §3 and
of the anchors in §5.

For scale, everything on this branch *after* the swap — the anchors, the block
split, the comment affordance, the composer path, the keyboard, the drawer —
adds **+1,896 B gzipped** to the same chunk and +177 B to the stylesheet,
measured the same way at `c840192`. The renderer is very nearly the whole cost
of the feature, and the rest of it is rounding.

### Due diligence

- `markdown-it` 15.0.2, MIT, `time.modified` 2026-09-12. Actively maintained.
- **No `@types/markdown-it`.** It was installed, found to be redundant, and
  removed: 15.0.2 ships first-party declarations through its `exports` map, and
  the DefinitelyTyped package is still on 14.x, so adding it puts a stale-major
  type surface beside a newer runtime — a trap rather than a safety net.
  Confirmed by removing it and re-running `tsc --noEmit` clean.
- **`marked` is removed from `dependencies`.** Nothing imports it once this
  lands; "replaces" means the old one goes rather than lingering unreferenced.
- No `eval(` and no `new Function` anywhere in `dist/` or `lib/` — grepped,
  which is the same check §3.7 ran on `marked` for MV3.
- `npm audit --omit=dev` on a tree containing it: zero.
- GFM parity checked by rendering: tables, strikethrough and `linkify`
  autolinks are core. **Task lists are not**, and are handled in §4.1.
- **UNVERIFIED:** `markdown-it`'s own advisory history has not been audited the
  way §3.7 audited `marked`'s two 2022 entries, and it has not been timed
  against pathological inputs. Both must be done before this ships, and the
  existing `MARKDOWN_LIMITS` gates stay either way.

### 4.1 Task lists are rendered as text, not as a checkbox

A core rule turns a list item whose inline content begins with `[ ]` or `[x]`
into a leading text marker — an empty or checked ballot box — inside a
`<span class="md-task">`. No plugin: `markdown-it-task-lists` 2.1.1 (ISC) was
last modified 2022-06-19, which is the dormant-package-with-a-live-publish-key
shape this project already refused for `toml` and for `htmldiff-js`.

The rule is also the *correct* answer rather than the cheap one, and the
argument is one this codebase has already made. `lib/compare/markdown.ts`
renders Markdown images as text, and says why: "swapping one image for another
becomes a text change, which is something this diff can mark. Two `<img>` tags
with different `src` attributes are invisible to a word diff that strips
attributes before comparing." A checkbox is the same shape exactly — state in an
attribute, invisible to the diff — and it has the additional problem that the
sanitiser forbids `input` outright, so nothing can reach the page anyway.

**Correction, made while implementing this on 2026-09-12.** The paragraph above
originally claimed this rule fixes §3.1, and it does not. `markdown-it` has no
task-list support at all, so `- [x] ship it` arrives as literal text and the
renderer swap in decision 1 restores the diff mark on its own — which showed up
as only one of the two tests for §3.1 failing before the rule was written. What
the rule actually earns is narrower and still worth having: the marker reads as
the control it stands in for rather than as stray punctuation, and `[X]` and
`[x]` normalise to one document so a case change is not drawn as an edit. The
source comment says the same thing. Decision 1 is load-bearing for §3.1;
decision 4.1 is not, and the record should not credit it.

The marker is ASCII `[ ]` and `[x]`, not the ballot-box characters this section
first suggested. Two reasons, either sufficient: U+2610 and U+2611 need a symbol
font the reviewer may not have, and they would make the rendered view disagree
with the Raw view one press away, on a card whose whole purpose is flipping
between the two. The brackets also diff better — `htmlDiff` marks the single
interior character that carries the state and leaves the brackets standing.

---

## 5. Decisions 2 and 3 — anchors, and the one attribute the sanitiser allows

### The pipeline

1. `ui/` mints a nonce (`crypto.randomUUID()`) per comparison and passes it to
   `compareMarkdown(before, after, nonce)`. The nonce is minted in `ui/` so
   `lib/` stays pure, which is the boundary CLAUDE.md already enforces.
2. A `markdown-it` core rule sets `data-md-anchor="<nonce>-R12"` on every block
   token with a `map`. The before side emits `L`, the after side `R`, so after
   the merge each surviving block still names the file and line it came from.
3. `diffHtml` merges the two documents. **Verified:** the attribute survives
   verbatim across both an insertion and a deletion. `stripAttributes` affects
   only matching, never emission.
4. `sanitizeMarkdownHtml` gains `ADD_ATTR: ['data-md-anchor']`.
5. `ui/` reads anchors off the DOM and ignores every value not carrying the
   current nonce.

### Why this is not a hole

`ALLOW_DATA_ATTR: false` exists because this page does
`querySelectorAll('[data-thread]')` and `querySelector('[data-reply-for="…"]')`
and casts the result to a textarea, so content that can mint a data attribute is
content that can redirect the application's own queries. **Verified:** with
`ADD_ATTR: ['data-md-anchor']` set alongside `ALLOW_DATA_ATTR: false`, DOMPurify
keeps `data-md-anchor` and still strips `data-thread`. The documented hazard is
untouched; exactly one new attribute name is admitted.

The nonce is what makes that attribute safe to *believe*. It is minted at render
time, after the document was authored, so a `.md` file cannot produce a valid
one — a forged anchor yields no comment affordance rather than a comment posted
to a line the reviewer did not choose.

Both halves get a test that fails if either is loosened, and the comment in
`ui/markdownHtml.ts` is amended to explain the exception rather than leaving the
next reader to find it by grep.

### 5.1 Three things found while building this, on 2026-09-12

**Stamping breaks the `unchanged` comparison, and the fix is `htmlDiff`'s own
rule one layer up.** Two sides that render identically no longer compare equal
once each carries its own anchors — one says `L`, the other `R`. So
`compareMarkdown` strips anchors for the two decisions that must not see
bookkeeping — the `maxRenderedChars` gate and the `unchanged` equality test —
while `unsafeHtml` is always the anchored form. That is exactly `htmlDiff`'s
"strip attributes for matching, never for emission", and stripping for the size
gate too is deliberate rather than incidental: an anchor is about forty-five
characters a block that `toWords` never pays for, since a tag is one token
whatever its attributes, so counting them would shrink the accepted document
size in exchange for measuring nothing real.

**A raw HTML block gets no anchor, so it cannot be commented on.**
`markdown-it` gives `html_block` a `map`, but its renderer returns
`token.content` verbatim — the attribute never reaches the output. A README
containing a hand-written `<table>` or `<details>` therefore has a block with no
comment affordance. This is a real gap in §7's "everything is commentable" and
the affordance must not pretend otherwise: a block with no anchor gets the
file-level path, not a missing control. `inline` tokens do carry a `map`,
contrary to what this document first assumed, but stamping one is useless —
`renderInline` walks children and never prints the container.

**An unchanged block is emitted as the new side's tag, so it carries `R`.**
`htmlDiff`'s `equal` branch slices `newWords`, and tags are compared with
attributes stripped, so a `<p>` present on both sides emits the new document's
anchor. The old side's `L` survives only where its tag falls inside a delete or
replace region — a genuinely removed block. That is the right behaviour rather
than a limitation: one element on screen is one block of the new document, and
it should name the line a comment on it would actually reach.

---

## 6. Decision 4 — the document is split into per-block React elements

Today the whole rendered document is one `dangerouslySetInnerHTML`. That forces
every later decision into imperative DOM work, and `ui/MarkdownCompare.tsx`
already documents the cost: React rebuilds the subtree whenever the prop's
identity changes, which silently wiped the drawn Mermaid diagrams and showed up
in no test, no error and no effect re-run — only in a real browser.

Thread cards and a composer are React components, so a single blob would force
either portals into imperatively-inserted placeholders, or splitting the
*sanitised* string, which means re-parsing and re-serializing markup that has
already been declared safe. `ui/markdownHtml.ts` refuses that second one on the
grounds that each parse-and-print round trip is a chance for two parsers to
disagree, and it is right to.

So the split happens **before** sanitising, on untrusted input, upstream of the
gate where `diffHtml` already sits. `ui/` parses the unsafe diffed HTML with
`DOMParser`, takes `body.children`, and sanitises each block immediately before
inserting it. **The sanitiser is still the last thing that touches every
string**, which is the rule that was actually being defended.

Three probes, all passing against this tree:

- Splitting at top-level elements loses only inter-block whitespace text nodes,
  which render as nothing between block elements.
- Every block sanitises on its own to exactly what the whole-document sanitise
  produces.
- `DOMParser` executes no script and fetches nothing — an inert document has no
  browsing context.

**Verified on 2026-09-12, and the claim now rests on something.** The sanitiser
corpus moved into `ui/markdownHtml.fixture.ts` so that suite cannot gain an
attack the split path never sees. Twenty-seven shapes — fifteen attacks, four
must-survive documents, and eight chosen to straddle the cut, including foreign
content between blocks, unclosed tags across a boundary, and SVG and MathML
nested inside a table cell — were compared per-block against whole-document by a
depth-tagged walk recording tag, sorted attributes and text. **All twenty-seven
are identical.** A second sweep asserts independently that the output is
harmless, since the comparison alone would pass if both paths were equally
broken. Both were mutation-checked.

**The first probe's claim was too strong, and building it found where.**
"Splitting loses only inter-block whitespace" holds for `markdown-it` output and
is false for raw HTML: `<div>a</div> and more` is one `html_block` followed by a
top-level text node, and dropping it would be the rendered view silently losing
authored text. Non-whitespace top-level text is kept as its own block;
whitespace-only nodes are still dropped.

**One behaviour was traded rather than preserved.** A Mermaid fence inside a
list item or a blockquote is no longer drawn — it stays as its marked-up source.
The old imperative placement could reach anywhere in the subtree; a block-level
component cannot, and drawing one would mean splitting a block around its own
descendants, which is the surgery this arrangement exists to remove. Top-level
fences, which is where almost every diagram is, are unaffected. Accepted rather
than fixed: the source stays on screen and readable, so nothing becomes
unknowable, and it is recorded in the README's known limits.

What it buys is a reduction in total machinery, not an addition:

- Thread cards, the comment affordance and the composer are ordinary React
  siblings. No portals, no placeholder elements.
- The subtree-wipe hazard cannot occur, because React owns the blocks.
- `placeDiagram`'s DOM surgery, the `live` flag and the
  re-find-the-blocks-after-await dance collapse into a `<MermaidBlock>`
  component that renders declaratively. `ui/mermaidBlocks.ts` recovers a
  diagram's source from marked-up markup and is still needed; the imperative
  placement is not.

---

## 7. Decisions 5 and 6 — what is commentable, and where threads go

### Everything is commentable, and the fallback is explicit

GitHub's `addPullRequestReviewThread` takes `path`, `line` and `side`.
**Executed on 2026-09-12** against `justinmwarner/gh-ext#1`, in a pending review
that was discarded afterwards, and recorded in
`docs/reference/github-review-api.md` §1 and §4. It refuses a line outside the
diff — and the refusal is HTTP 200 with no `errors` array and `thread: null`,
which is a success carrying nothing. `publishThread` cannot tell that from a
comment that posted. So this section's premise holds, and holds harder than it
was written: the predicate below is not choosing between two good shapes, it is
the only thing between a reviewer and a comment that disappears in silence.

A rendered view shows the *whole* new document, so on any sizeable README most
blocks are outside every hunk. The decision is that every block still gets an
affordance.

- A block whose line falls inside a hunk posts an ordinary line comment. Which
  lines qualify is computed from the patch `fileDiffFor` already parses, by a new
  pure predicate in `lib/review/` — not guessed.
- A block outside every hunk posts `subjectType: FILE`. The composer says so
  before the reviewer types, and seeds the body with a blockquote of the block,
  so the comment carries its own context when read on github.com.

File-level threads are already *read* — `ui/reviewThreads.ts` labels them "Whole
file" — but nothing in this application has ever *posted* one.
`lib/github/mutations.ts` already declares `$subjectType`, so the work is a
file-level shape on `CommentAnchor` and the composer path, and the extension
gains whole-file comments, which it currently lacks entirely.

### Threads render under their block

The affordance is a comment button in the block's left margin, revealed on
hover and on focus, in the gutter position a reviewer already reaches for on
github.com. It is not in the tab order — a README has hundreds of blocks and
one tab stop each would make the document unusable by keyboard — which is why
the keyboard route below goes through the existing block navigation instead.

A thread whose line lands in an anchored block renders below that block.
Outdated threads, threads GitHub sent no line for, and threads belonging to a
different commit stay in `UnanchoredThreads` with the reasons it already gives.
Today every thread on a `.md` file in the rendered mode is in that drawer, so
this is strictly better in every case and much better in the common one.

**A thread that lands in no block at all also goes to the drawer**, under a
seventh reason — `no-block`, added on 2026-09-12. Blocks carry ranges and those
ranges do not tile the file: the blank line between two paragraphs is in none of
them, and a raw `html_block` carries no range at all for the reason §5.1 gives.
A comment on such a line is inside a hunk, so `layoutThreads` makes it an
annotation — and a rich card is handed `emptyDiffFor`, which has no rows, so
Pierre drops that annotation in silence. Drawn nowhere, listed nowhere, and no
error raised anywhere: the exact failure `ui/UnanchoredThreads.tsx` calls the
worst outcome available.

Matching such a thread to the nearest block at or before its line was considered
and refused. That draws a reviewer's comment beside prose it was not written
about, which is the misattribution the `outdated` verdict already refuses to
make, and it is worse than the drawer because nothing on screen would admit to
it. Only the rendered view knows which lines its blocks covered, so
`MarkdownCompare` reports what it could not place and `ui/FileBody.tsx` lists
it; the sentence sends the reviewer to Raw, which shows the comment on its line.
The same channel carries a comment still in flight, where losing it would lose
writing that is on GitHub nowhere.

### The keyboard needs no new bindings

The existing keymap maps onto this view without additions:

- `J` / `K` — `next-hunk` / `previous-hunk` move between **changed blocks**. A
  changed block is what a hunk is in a rendered document, and these two actions
  currently do nothing here at all.
- `c` — `comment-on-line` opens the composer on the current block.
- `n` / `p` / `N` / `P` — thread navigation, which only starts working once
  threads are placed rather than buried.

---

## 8. Decision 7 — the Markdown mode is remembered

### What changes

Pressing a mode button on a `.md` card sets a preference for the Markdown kind,
flips every other Markdown card in the open pull request immediately, and
persists so the next pull request opens the same way.

Stored under a `storage.local` key of its own rather than a field on `Settings`,
following the `CARD_COLLAPSED_KEY` precedent in `lib/settings.ts`: two writers
doing read-modify-write on one key will eventually lose one of the two edits.
The shape is kind → mode id.

`resolveModeForFile` already handles a stored mode a file cannot offer, so a
one-sided `.md` — where `markdown:rendered` is `needsBothSides` — still falls
back to its default without a new branch.

The card buttons are the only control. Nothing is added to the options page.

### Markdown only, and why

The obvious generalisation is to remember every kind, and it was considered and
declined. `ui/ModeSwitcher.tsx` argues for per-file modes with a concrete case:
two images in one pull request want different modes, because one was redrawn and
wants side by side while the next moved four pixels and wants the difference
blend. A kind-wide preference that flips every card makes the second reviewer
action undo the first. That argument is sound for images, tables and notebooks,
where the right mode is a property of the individual change.

It does not hold for Markdown, which offers exactly two modes and where the
choice is a property of the *reviewer* — some people read prose changes as
rendered documents and some read them as source, and neither changes their mind
per file. So Markdown remembers and the other kinds do not.

### Answering the objection the rule was written for

`ModeSwitcher.tsx` says a remembered mode would be "silently deciding what the
reviewer sees on a file they have never opened", and `lib/settings.ts` makes the
sharper version of the same point about `ignoreWhitespace`: a preference that
*hides lines* must not arrive already on without the reviewer knowing.

The Markdown mode is not that, and the difference is the reason this is
acceptable where `ignoreWhitespace` needed an options-page home. Nothing is
hidden either way. Both modes show the whole change; Raw is always present, is
always last, and is one press away on the card the reviewer is already looking
at. The reviewer set the preference themselves, by pressing a button on a card,
and unset it the same way. The comment in `ModeSwitcher.tsx` is amended to say
which rule survives and why, rather than being quietly deleted.

---

## 9. What has to be tested

Node, under `lib/`:

- `token.map` → anchor emission, on every block shape including list items and
  table rows, and on both sides.
- The commentable-lines predicate against real patches: added lines, context
  lines, both sides, an empty patch, a patch with no hunks.
- Task-list markers diff as text — the §3.1 reproduction becomes a regression
  test asserting the tick *is* marked.
- The `markdown:rendered` mode still refuses one-sided changes.

jsdom, under `ui/`:

- The existing sanitiser suite, re-run through the per-block split path. This is
  the one that licenses §6 and it is not optional.
- A forged `data-md-anchor` in a `.md` file yields no affordance.
- `data-thread` and `data-reply-for` are still stripped with `ADD_ATTR` set.
- Strikethrough renders as `<s>` and is not painted as a deletion.
- A thread on a line inside a block renders under that block; an outdated one
  stays in the drawer.
- A thread on a line *between* two blocks — a blank separator, or a line inside
  a raw `html_block` — reaches the drawer rather than nowhere. Driven through
  the whole column, because the defect is in the join between two halves that
  are each individually correct: `ui/comparisonModes.test.tsx`.
- The file-level composer says so, and seeds its blockquote.
- The mode preference flips sibling cards and survives a remount.

Playwright, against the production build:

- Commenting on a rendered Markdown block end to end, both anchored and
  file-level, with GitHub mocked at the service worker.
- The mode preference surviving a reload and a second pull request.

§5 of the comparison spec records that the rendered Markdown mode had **no
browser coverage**. That is now out of date, and this branch is what dated it:
`e2e/review.spec.ts` carries four specs against the production build — the prose
is marked and none of it executes, a diagram is drawn rather than left as
source, a block can be commented on, and the mode outlives the page.

---

## 10. Open items

1. ~~**UNVERIFIED** — that GitHub rejects a comment on a line outside the diff.~~
   **Closed on 2026-09-12.** Executed against `justinmwarner/gh-ext#1` in a
   pending review that was discarded afterwards. It refuses — silently: HTTP
   200, no `errors`, `thread: null`. §4 of `docs/reference/github-review-api.md`
   has the four responses and the method; §7 above says what it means here.
2. **UNVERIFIED** — `markdown-it` advisory history and behaviour on pathological
   inputs, to the standard §3.7 applied to `marked`. Still open, and the only
   item on this list that was open when the branch started and still is.
3. ~~**UNVERIFIED** — per-block sanitising equals whole-document sanitising.~~
   **Closed on 2026-09-12.** Twenty-seven shapes compared structurally, all
   identical, both directions mutation-checked. §6 has the detail.
4. ~~The +28,474 B is a bundle-size claim about a scratch build.~~ **Closed on
   2026-09-12.** Re-measured with `npx wxt build` at `04ad174^` and `04ad174`:
   **+28,252 B gzipped**, 222 bytes under the estimate and no stylesheet cost at
   all. §4 has the table and the figures for the rest of the branch.
5. **Opened on 2026-09-12, by closing item 1.** A comment on an *expanded
   context* line may be lost the same silent way, and nothing on that path
   checks. `composerFor` in `ui/composerAnchor.ts` has three refusals —
   cross-side, invalid range, other-commit — and none of them asks whether the
   line is one the patch contains. Expanding unchanged context puts exactly such
   rows under a gutter, and the probe refused a line three rows outside a hunk
   with HTTP 200 and `thread: null`. Whether GitHub takes *any* expanded line is
   not settled by that one probe; github.com's own interface offers the gesture,
   so it may send something other than a bare `line`. Execute it, and if it
   refuses, `commentableLines` is already the predicate that would guard it.
   Outside this feature's scope and larger than it.
