# Diff fixtures

A pull request whose only job is to be looked at.

Every file here exists in two states so the review page has a real diff to
draw, and each one was chosen because some renderer has to make a decision
about it. Nothing in this directory is used by the extension at runtime, and
this branch is not meant to be merged.

## Images — `images/`

The interesting part of an image diff is not *whether* it changed but *how you
compare the two*, so the set is built to exercise each comparison mode
differently.

| File | What it is there for |
| --- | --- |
| `logo.png` | Same dimensions, one colour changes. The clean case: onion-skin, swipe and difference blend all line up. |
| `photo.jpg` | Lossy, and the change is a *moved* element rather than a recolour. A difference blend lights up in two places, not one. |
| `resized.png` | The dimensions themselves change, 200×120 → 320×180. Every overlay mode has to decide what to do when the sides are not the same shape. |
| `transparent.png` | An alpha channel. An onion-skin has to composite against something rather than assume an opaque backdrop. |
| `animation.gif` | Indexed colour. Fine for an `<img>` swap; a canvas read-back may disagree. |
| `icon.bmp` | 32×32, uncompressed, and *every* pixel differs. |
| `huge.png` | 1600×1200, far wider than the column. Whatever the renderer does about scale it has to do without locking the page up. |
| `added.png` | Added by the pull request — there is no "before" to compare against. |
| `removed.png` | Deleted by it — there is no "after". |

## Vector — `vector/`

`chart.svg` is text, so a source diff works and shows a handful of changed
attributes. Rendered, the bars move and change colour. Both readings are
useful and neither is a substitute for the other. `icon-tiny.svg` is added.

## Data — `data/`

| File | What it is there for |
| --- | --- |
| `people.csv` | One cell changed, one row added, one row removed. |
| `reordered.csv` | The same rows with the columns reordered. A line diff calls every line changed; a column-aware one should say the data did not move. |
| `wide.tsv` | 24 columns, tab separated. Needs horizontal scrolling. |
| `big.csv` | 4,000 rows. Any cell-by-cell renderer has to decide what it does here *before* someone opens it. |
| `config.json` | A value changed three levels down, a key added, a key removed, an array extended. |
| `reordered.json` | Identical content, different key order. Structurally nothing changed; a text diff reports the whole file. |
| `array.json` | An element inserted mid-array, which shifts every index after it. |
| `package-lock.json` | Long, generated, and not worth a reviewer's attention. Marked `linguist-generated`. |

## Notebooks — `notebooks/`

`analysis.ipynb` edits one cell, adds another, and changes the recorded
outputs. As raw JSON it is unreadable; the whole question is whether cells and
outputs can be shown as cells and outputs.

## Docs — `docs/`

`guide.md` and `table.md`, for the rendered-versus-source question. Markdown is
drawn as plain text everywhere in the review page today.

## Generated — `generated/`

`schema.generated.js` and `api.pb.go`, both marked `linguist-generated=true` in
`.gitattributes`. GitHub's `PullRequestChangedFile` has no field for this, so
`.gitattributes` is the only part of linguist's answer a client can read.

## Binary — `binary/`

`report.pdf` is a genuinely valid one-page PDF. `archive.zip` is a real
archive. `font.woff2` is added and is deliberately *not* a real font — what
matters is that it is recognised as binary and not rendered.

## Edges — `edges/`

The cases that break renderers rather than the ones that exercise them.

| File | What it is there for |
| --- | --- |
| `empty.txt` | Added, and completely empty. There is no diff to draw. |
| `no-newline.txt` | Ends without a newline on both sides. Git reports this specially. |
| `crlf.txt` | Every line ends CRLF. Strip them or show stray glyphs. |
| `unicode.txt` | Zero-width joiners, combining marks, right-to-left runs, CJK. Anything counting characters as bytes gets these wrong. |
| `long-lines.txt` | One line of twelve thousand characters. |
| `whitespace.py` | A whitespace-only change: tabs against spaces, nothing else. |
| `renamed-from.txt` → `renamed-to.txt` | A pure rename, 100% similarity. |
| `renamed-edited.txt` → `renamed-edited-new.txt` | Renamed *and* edited, so detection is a judgement call. |
| `deleted.txt` | Present on the base side only. |
| `permissions.sh` | The file mode changes, and so does the body. |

## Code — `code/`

`app.js`, `server.py`, `main.go` — ordinary diffs in three languages, for
syntax highlighting and for a baseline to compare the smart renderers against.

## Commits

The changes are split across several commits so the commit picker has a real
history to walk: one commit per area rather than one enormous one.
