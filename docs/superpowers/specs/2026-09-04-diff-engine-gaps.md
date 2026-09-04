# The diffing engine — what we have, where the ceiling is, and what would raise it

## 0. Provenance and trust rules

Same contract as the other reference documents here: every claim below was read
out of source, run against the registry, or measured. Anything I could not
establish is marked **UNVERIFIED** and says what would establish it.

| How | What |
| --- | --- |
| Read | `ui/DiffColumn.tsx`, `lib/github/assembly.ts`, `lib/github/blobs.ts`, `docs/reference/pierre-diffs-api.md` |
| Ran | `npm view <pkg> version license time.modified dist.unpackedSize` against the live registry |
| Measured | `.output/chrome-mv3/` after `npx wxt build` |
| Read | `.output/chrome-mv3/manifest.json` as actually emitted |

`WebFetch` is denied by a hook in this environment, so no claim here comes from
reading a web page. Package facts come from the npm registry directly. Two
search results are cited where they are the only evidence, and they are labelled
as such.

---

## 1. The fact that governs everything else

**We do not compute diffs. We render GitHub's.**

`lib/github/assembly.ts` fetches the pull request's unified diff and
`parseUnifiedDiff` turns it into hunks. The hunk boundaries, the line pairing,
the rename detection and the algorithm behind all three are decided on GitHub's
servers before the bytes reach us, and the REST API exposes no parameter to
influence any of it.

Everything in section 3 that is *not* a rendering option follows from this one
sentence. Our diff is exactly as good as `git diff` with GitHub's settings, and
no amount of front-end work changes that while the patch is the input.

The escape is in section 4, and it is already half-built.

---

## 2. What is already good

Worth stating plainly, because three of these are better than I expected and
none of them needs work.

- **Intra-line word diffs are on.** `@pierre/diffs` takes `lineDiffType`, which
  defaults to `'word-alt'`, and `CODE_VIEW_OPTIONS` never overrides it. Changed
  lines are already highlighted word by word, not whole-line.
- **Syntax highlighting** through Shiki, themed to match the page.
- **Context expansion** reads whole files at both commits through the worker
  (`MAX_BLOB_BYTES` = 1,000,000), so unchanged code above and below a hunk can
  be pulled in on demand.
- **Comment anchoring survives a narrowed diff**, because the scoping work made
  the column refuse anchors on a side whose line numbers mean something else.
- **Rich types** — images with five comparison modes, SVG, CSV/TSV, JSON,
  notebooks — landed in `4c8cc24`.

---

## 3. The gaps

Ordered by value divided by cost, not by ambition.

### 3.1 There is no split view, and it is one line away

`BaseDiffOptions.diffStyle` accepts `'unified' | 'split'` and the library's own
default is `'split'`. `ui/DiffColumn.tsx:145` hardcodes `'unified'`, with a
comment explaining the choice: the reviewer arrived from GitHub's Files-changed
tab, which is unified.

That reasoning is sound as a *default* and wrong as a *fixed* answer. GitHub
offers the toggle; people have strong and unshakeable preferences about it; and
`docs/reference/pierre-diffs-api.md` §B.3 says switching between the two needs
**no annotation data change** — comment anchoring works in both, natively.

Cost: a control, a piece of state, and passing it through. The largest
value-to-effort ratio on this list by some distance.

### 3.2 There is no whitespace-insensitive mode

No `-w`. A pull request that reindents a function shows every line of it as
changed, and the reviewer has to read all of them to find the one that is not
just indentation.

GitHub's *web* UI has `?w=1`. The API's `.diff` does not, and we take the API's.
This one cannot be fixed by an option — it needs section 4.

### 3.3 The hunk quality is Myers, and Myers is the weak one

Git's default algorithm produces the well-known bad alignments: a closing brace
attributed to the wrong function, a block of added lines paired against an
unrelated removed block because both contain `}` and a blank line. `--histogram`
and `--indent-heuristic` exist precisely because Myers is not good enough for
reading, and they make a visible difference on real code.

**UNVERIFIED:** which algorithm GitHub actually runs, and whether it applies
`--indent-heuristic` to the API's `.diff` output. I could not establish it from
anything I have access to. What *is* verified is that we cannot influence it.
`test/diff-fixtures` (PR #1) is now a controlled corpus this could be measured
against — a file crafted with repeated braces would settle it in one look.

### 3.4 There is no move detection

A block moved from one file or function to another shows as a deletion in one
place and an addition in another, and the reviewer reads the same forty lines
twice before realising they are identical. `git diff --color-moved` exists for
this; nothing in our pipeline does anything equivalent.

On refactoring pull requests this is frequently the single biggest readability
win available, and it is also the gap with the least off-the-shelf help
(section 5).

### 3.5 Intra-line diffs give up on long lines

`maxLineDiffLength` defaults to 1000 and we never raise it. A line longer than
that is shown as wholly changed with no word highlighting — which is exactly the
case where a reviewer most needs to be told *which part* moved. Minified assets,
long string literals, generated code, single-line JSON.

Cheap to change; needs a judgement about the CPU cost on pathological files.

### 3.6 Granularity is not exposed

`lineDiffType` also accepts `'word'` and `'char'`. `'char'` is meaningfully
better for renames-within-a-line and for prose. We ship one setting for
everything.

### 3.7 A very large diff degrades and then stops

Past GitHub's threshold the `.diff` endpoint answers 406 and we fall back to the
files endpoint; past *that*, the file is listed with no patch. That is handled
honestly today — the page says so rather than pretending — but "handled" is not
"good". Section 4 would let a reviewer ask for one specific oversized file to be
diffed locally.

### 3.8 Nothing is syntax-aware

The frontier: a diff that knows a function was renamed rather than deleted and
added, that a parameter was inserted, that a block was wrapped in a conditional.
Difftastic and GumTree do this. See section 5 for why it is out of reach here,
and note that the reason is a hard constraint rather than a preference.

---

## 4. The pivotal decision: compute diffs locally

Everything in 3.2, 3.3, 3.4 and 3.7 needs the same thing — the two file
*contents*, not GitHub's patch. We are closer to that than it sounds.

**We already fetch both sides.** `lib/github/blobs.ts` reads whole files at an
arbitrary commit through the background worker, capped at 1 MB, with a cache.
Context expansion uses it today.

**The library already accepts contents instead of a patch.** `MultiFileDiff`
takes `oldFile` / `newFile` as `FileContents` and diffs them itself.

**The engine is already in the bundle.** `@pierre/diffs@1.3.6` depends on
`diff@9.0.0` — jsdiff, BSD-3-Clause. Nothing new to install, nothing new to
audit, no change to the bundle.

So a local path costs **zero new dependencies**. What it costs instead:

| Cost | Detail |
| --- | --- |
| Requests | Two blob reads per file. A 50-file pull request is 100 extra calls against a 5,000/hour limit — fine for one, not something to do eagerly for every file of every review. |
| Ceiling | 1 MB per side, already enforced. |
| CPU | jsdiff on two 1 MB files is not free. `maxEditLength` and `timeout` exist to bound it. |
| Honesty | A locally computed diff is **not** the diff GitHub is showing anyone else. Line numbers used for comment anchoring must keep coming from GitHub's patch, exactly as `AnchorableSides` already enforces for narrowed diffs. |

**Recommendation: per file, on demand, never eagerly.** The same shape as
"expand context" — an affordance on a file the reviewer is actually looking at,
not a policy applied to the whole pull request. That keeps the request cost
proportional to attention, and it keeps GitHub's patch as the thing comments are
anchored against.

---

## 5. Library proposals, verified

Queried against the registry on 2026-09-04.

| Package | Version | Licence | Last publish | Unpacked | Verdict |
| --- | --- | --- | --- | --- | --- |
| `diff` (jsdiff) | 9.0.0 | BSD-3-Clause | already a dependency | — | **Use it.** |
| `patience-diff` | 0.0.2 | Apache-2.0 | 0.0.2, ~8 years old | — | **No.** |
| `diff-match-patch` | 1.0.5 | Apache-2.0 | 2022-06-15 | 97 kB | Wrong tool. |
| `@sanity/diff-match-patch` | 3.2.0 | Apache-2.0 | 2026-04-08 | 470 kB | Wrong tool, maintained. |
| `jsondiffpatch` | 0.7.6 | MIT | 2026-05-14 | 163 kB | **No** — already hand-rolled. |
| `web-tree-sitter` | 0.27.0 | MIT | 2026-08-30 | **4.68 MB** | **Ruled out by the manifest.** |

**`diff` (jsdiff) — already present.** Its options are exactly the missing
controls: `ignoreWhitespace`, `ignoreCase`, `newlineIsToken`, `stripTrailingCr`,
`ignoreNewlineAtEof`, plus `maxEditLength` and `timeout` for bounding. Section
3.2 is free once section 4 exists. Its algorithm is Myers, so it does **not**
fix 3.3 — recomputing with jsdiff buys control, not better hunks.

**`patience-diff` — abandonware.** Version 0.0.2. The only evidence of its age
is a [search result reporting the last publish as roughly eight years ago](https://www.npmjs.com/package/patience-diff);
the registry confirms the version has never left 0.0.2. Not something to put
under a review tool.

**`diff-match-patch` and the Sanity fork — a different problem.** Both are
character-level with semantic cleanup, aimed at prose and collaborative editing.
We already have word-level intra-line diffs from Pierre, and neither of these
does line-level hunk selection, which is what 3.3 is about. The Sanity fork is
the one to reach for *if* we ever want better intra-line than `'word-alt'` — it
is maintained where the Google original is not.

**`web-tree-sitter` — ruled out on a hard constraint.** Not on size, though 4.68
MB before any language grammar is disqualifying on its own. The emitted
`manifest.json` declares **no `content_security_policy`**, so MV3's default
applies, and under that default WebAssembly cannot be instantiated without
adding `'wasm-unsafe-eval'`. This project does not add a CSP. Every WASM-based
diff engine — tree-sitter, a difftastic port — is out for the same reason.

That constraint also explains something already in the bundle: the dead Shiki
WASM chunk is **622,325 bytes** and is not merely unreachable, it *could not
run* under this manifest if it were reached. It should be deleted, and the
argument for deleting it is stronger than "nothing imports it".

**No maintained JavaScript histogram implementation was found.** Given that, and
given this codebase already hand-writes its CSV parser, its row alignment and
its structural JSON walk, the honest proposal for 3.3 is **write it**. Histogram
is a well-specified refinement of patience — anchor on the rarest line that
appears in both sides, recurse on the regions either side of it — and is on the
order of 150 lines with a clear test surface. That is less code than the
notebook reader already merged.

**Move detection has no library and does not need one.** Once a local diff
exists, the algorithm is: hash each removed block and each added block after
normalising whitespace, match them, and mark the pairs. Bounded by block count.
The hard part is presentation, not detection.

---

## 6. Recommended order

Each step is independently shippable, and each earlier one makes the next
cheaper.

1. **Split view.** Hours. Pure gain, no new machinery, and `diffStyle` is
   already a supported option we happen to pin.
2. **Expose `lineDiffType` and raise `maxLineDiffLength`.** Hours. Fixes 3.5 and
   3.6 together.
3. **Local recompute, per file, on demand** — the section 4 path, with jsdiff
   and `ignoreWhitespace`. About a day. Unblocks everything below.
4. **Histogram hunks on the local path.** A day or two, hand-written, tested
   against `test/diff-fixtures`.
5. **Move detection.** A day or two, on top of 3 and 4.
6. **Delete the dead WASM chunk.** Minutes, and worth 622 kB.

Steps 1, 2 and 6 are unambiguous improvements and I would do them without
further discussion. Steps 3 to 5 are where the real quality is, and step 3 is
the one that needs a decision because it changes what the page is showing.

---

## 7. Open questions

1. **Is a locally computed diff acceptable at all?** It would differ from what
   GitHub shows everyone else on the pull request. My position: yes, per file,
   on demand, clearly labelled, with comment anchoring still driven by GitHub's
   patch. But it is a real change in what the page claims to be.
2. **Which algorithm does GitHub actually run?** Worth ten minutes against PR #1
   with a file crafted to expose Myers' weakness. If GitHub already applies
   `--indent-heuristic`, step 4 is worth much less than I think.
3. **Split view: default, or remembered?** This page persists no interface state
   at all today. A view preference is the most natural first exception, and I
   would rather break that rule deliberately than let it decay.
4. **How aggressive should the recompute affordance be?** Silent for files under
   some size, or always an explicit action?

---

## 8. What I could not verify

- GitHub's server-side diff algorithm and flags (3.3, question 2 above).
- Whether jsdiff's output is in practice better or worse than GitHub's on real
  files. It is Myers either way, so I expect *comparable* — but "expect" is not
  "measured", and PR #1 exists to measure it on.
- Real-world CPU cost of jsdiff on two 1 MB files in this extension's context. I
  did not benchmark it.
