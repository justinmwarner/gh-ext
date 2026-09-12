# Commenting on Rendered Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reviewer can leave a comment on any block of a rendered Markdown diff, and existing threads appear beside the prose they are about instead of in a collapsed drawer.

**Architecture:** The renderer moves from `marked` to `markdown-it`, whose `token.map` carries `[startLine, endLine]` on every block token. A core rule stamps each block with `data-md-anchor="<nonce>-R12"`; the nonce is minted per comparison so a pull request cannot forge one. `htmlDiff` carries the attribute through untouched. In `ui/`, the *unsafe* diffed HTML is parsed and split at block boundaries, and each block is sanitised immediately before being inserted — the sanitiser stays the last thing to touch every string. Each block becomes an ordinary React element, so thread cards, the comment affordance and the composer are plain siblings rather than portals into an `innerHTML` blob.

**Tech Stack:** TypeScript, React 19, `markdown-it` 15.0.2, `dompurify`, the vendored `lib/compare/htmlDiff`, vitest (node + jsdom), Playwright.

**Design source:** `docs/superpowers/specs/2026-09-12-markdown-review-design.md`. Read §3 through §7 before starting.

---

## Two things to know before you touch anything

**`lib/` is pure.** No DOM, no `chrome.*`, no network. `crypto.randomUUID()` counts as environment — the nonce is minted in `ui/` and passed in. The split in Task 6 needs `DOMParser`, which is why it lives in `ui/` and not in `lib/`.

**The sanitiser's ordering is a security property, not a style.** `ui/markdownHtml.ts` argues it at length: sanitisation must be the last transformation before insertion, because anything that rewrites markup afterwards is assembling new markup out of markup already declared safe. Task 6 splits *before* sanitising, upstream of the gate. Do not reorder it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/compare/markdown.ts` (modify) | Render both sides with `markdown-it`, stamp anchors, diff, return `unsafeHtml` + nonce |
| `lib/compare/markdownAnchors.ts` (create) | The anchor value's grammar: format, parse, validate against a nonce |
| `lib/review/commentable.ts` (create) | Which `{side, line}` pairs GitHub will accept, read off the patch |
| `lib/review/selection.ts` (modify) | `CommentAnchor` becomes a line-or-file union |
| `ui/markdownHtml.ts` (modify) | `ADD_ATTR` for the one anchor attribute |
| `ui/markdownBlocks.ts` (create) | Parse the unsafe diffed HTML, split it, sanitise each block |
| `ui/MarkdownCompare.tsx` (modify) | Render blocks as React elements; affordance, threads, composer |
| `ui/MermaidBlock.tsx` (create) | One diagram, rendered declaratively |

---

### Task 1: `markdown-it` replaces `marked`

**Files:**
- Modify: `package.json`, `lib/compare/markdown.ts`
- Test: `lib/compare/markdown.test.ts`

Read `lib/compare/markdown.ts` in full first. Its file comment explains why the mode is a rendered *diff* rather than a side-by-side preview, and why images render as text. Both survive this change; only the renderer underneath them moves.

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-exact markdown-it@15.0.2
npm install --save-dev --save-exact @types/markdown-it
```

Exact-pinned, matching how `marked` and `dompurify` are pinned in `package.json`.

- [ ] **Step 2: Write the failing tests**

Append to `lib/compare/markdown.test.ts`:

```ts
describe('markdown-it parity and fixes', () => {
  // Defect 3.2 of the design: `marked` emitted <del> for strikethrough, which
  // is the tag htmlDiff marks deletions with, so authored strikethrough was
  // painted and announced as a deletion.
  it('renders strikethrough as <s>, never <del>', () => {
    const result = compareMarkdown('~~struck~~ word', '~~struck~~ other');
    expect(result.unsafeHtml).toContain('<s>struck</s>');
  });

  it('still renders GFM tables', () => {
    const result = compareMarkdown('| a |\n|---|\n| b |', '| a |\n|---|\n| c |');
    expect(result.unsafeHtml).toContain('<table>');
  });

  it('still names images rather than loading them', () => {
    const result = compareMarkdown('![alt](x.png)', '![alt](y.png)');
    expect(result.unsafeHtml).toContain('md-image');
    expect(result.unsafeHtml).not.toContain('<img');
  });

  it('still treats a single newline as a wrap, not a break', () => {
    const result = compareMarkdown('one\ntwo', 'one\nthree');
    expect(result.unsafeHtml).not.toContain('<br>');
  });

  it('still reports two sides that render identically as unchanged', () => {
    expect(compareMarkdown('# A', 'A\n=').status).toBe('unchanged');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run lib/compare/markdown.test.ts -t "markdown-it parity"`
Expected: the strikethrough test FAILS (`marked` gives `<del>`). The other four should already pass under `marked` — they are the parity net. If any of those four fails *before* your change, stop and report it: the existing behaviour is not what this plan assumed.

- [ ] **Step 4: Swap the renderer**

In `lib/compare/markdown.ts`, replace the `marked` import and the `renderer` constant. Keep every existing comment about *why* — the image-as-text rationale, the `breaks: false` rationale — and move it onto the new configuration.

```ts
import MarkdownIt from 'markdown-it';

/**
 * The renderer, configured once.
 *
 * An instance rather than a module-level singleton with plugins applied, for
 * the reason the `Marked` instance here was one: `markdown-it`'s `use` mutates
 * the instance, and a shared one would hand its configuration to any feature
 * added later that reached for the same import.
 */
const renderer = new MarkdownIt({
  // Raw HTML in a `.md` file is passed through and sanitised downstream, which
  // is what GitHub does and what a README expects. `ui/markdownHtml.ts` is the
  // gate; turning this off here would silently change how documents render
  // without making anything safer.
  html: true,
  // Bare URLs become links, which is half of what `gfm: true` meant before.
  linkify: true,
  // Off, matching how GitHub renders a `.md` *file*: a single newline is a
  // wrap, not a line break. On, every re-wrapped paragraph in a pull request
  // would show as a structural change.
  breaks: false,
  // No smart quotes. A typographic substitution the author did not write is a
  // character this diff would mark as changed.
  typographer: false,
});

/**
 * An image is named, never loaded.
 *
 * [Keep the existing explanation from the `marked` renderer override verbatim —
 * it is unchanged by this swap and is the reason the rule exists.]
 */
renderer.renderer.rules.image = (tokens, index): string => {
  const token = tokens[index];
  if (token === undefined) return '';
  const href = token.attrGet('src') ?? '';
  const label = renderer.renderer.renderInlineAsText(token.children ?? [], {}, {});
  const title = token.attrGet('title') ?? '';
  const named = label !== '' ? label : title;
  const text = named !== '' ? `${named} (${href})` : href;
  return `<span class="md-image">Image: ${escapeHtml(text)}</span>`;
};
```

Replace the two `renderer.parse(...) as string` calls with `renderer.render(...)`.

- [ ] **Step 5: Run the whole markdown suite**

Run: `npx vitest run lib/compare/markdown.test.ts`
Expected: PASS, including every pre-existing test. If a pre-existing test asserts on exact HTML that `markdown-it` spells differently — whitespace inside `<pre>`, attribute order — update the assertion and say so in the commit. If one asserts on *behaviour* and now fails, stop and report it.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck`
Expected: PASS. `ui/mermaidBlocks.test.tsx` and `ui/MarkdownCompare.test.tsx` both consume this output — if either breaks, that is in scope for this task.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/compare/markdown.ts lib/compare/markdown.test.ts
git commit -m "feat: render markdown with a parser that knows where it came from"
```

---

### Task 2: Task lists become text

**Files:**
- Modify: `lib/compare/markdown.ts`, `entrypoints/review/style.css`
- Test: `lib/compare/markdown.test.ts`

This fixes design defect §3.1: ticking `- [ ]` → `- [x]` currently renders as *no change at all*, because the state lives in an attribute, `htmlDiff` strips attributes before comparing, and the sanitiser removes `<input>` anyway.

- [ ] **Step 1: Write the failing test**

```ts
describe('task lists', () => {
  // The §3.1 reproduction. This asserted nothing before: the whole document
  // came back with zero marks for a change the reviewer can see on github.com.
  it('marks a box being ticked', () => {
    const result = compareMarkdown('- [ ] ship it\n', '- [x] ship it\n');
    expect(result.status).toBe('ok');
    expect(result.unsafeHtml).toMatch(/<(ins|del)\b/);
  });

  it('renders the state as text rather than as an input', () => {
    const result = compareMarkdown('- [ ] a\n', '- [x] a\n');
    expect(result.unsafeHtml).not.toContain('<input');
    expect(result.unsafeHtml).toContain('md-task');
  });

  it('leaves a list item that is not a task alone', () => {
    const result = compareMarkdown('- plain\n', '- plainer\n');
    expect(result.unsafeHtml).not.toContain('md-task');
  });

  // A literal bracket pair mid-sentence is not a checkbox.
  it('only reads a marker at the start of an item', () => {
    const result = compareMarkdown('- a [ ] b\n', '- a [x] b\n');
    expect(result.unsafeHtml).not.toContain('md-task');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/compare/markdown.test.ts -t "task lists"`
Expected: the first two FAIL.

- [ ] **Step 3: Implement the core rule**

Add to `lib/compare/markdown.ts`:

```ts
/**
 * A ticked box is a character, not an attribute.
 *
 * `markdown-it` has no task lists and the obvious plugin is dormant, but a
 * plugin would be the wrong answer anyway. A checkbox puts its state in an
 * attribute, `htmlDiff` reduces every tag to its name before comparing, and
 * `ui/markdownHtml.ts` forbids `input` outright — so a rendered checkbox is
 * invisible to the diff twice over, and ticking one showed as no change at all.
 *
 * This is the same trade the image renderer above makes, and for the same
 * reason: state the diff can read is state written as text.
 */
const TASK_MARKER = /^\[([ xX])\]\s+/;

renderer.core.ruler.push('task-list-text', (state): void => {
  for (const [index, token] of state.tokens.entries()) {
    if (token.type !== 'inline') continue;
    // Only the first inline of a list item's paragraph. `markdown-it` emits
    // list_item_open, paragraph_open, inline — so look back two.
    if (state.tokens[index - 2]?.type !== 'list_item_open') continue;

    const matched = TASK_MARKER.exec(token.content);
    if (matched === null) continue;

    const ticked = matched[1] !== ' ';
    token.content = token.content.slice(matched[0].length);

    const first = token.children?.[0];
    if (first === undefined || first.type !== 'text') continue;
    first.content = first.content.replace(TASK_MARKER, '');

    const marker = new state.Token('html_inline', '', 0);
    marker.content = `<span class="md-task">${ticked ? 'x' : ' '}</span> `;
    token.children?.unshift(marker);
  }
});
```

If `state.Token` is not reachable that way in `markdown-it` 15, construct the token via `new (state.Token as unknown as TokenConstructor)(...)` or import `Token` from `markdown-it/lib/token.mjs` — whichever typechecks. Do not fall back to string surgery on rendered HTML.

- [ ] **Step 4: Style the marker**

In `entrypoints/review/style.css`, beside the existing `.markdown-rendered` rules, add a rule drawing `.md-task` as a box. Use existing tokens from `ui/tokens.css` — **a literal hex here is a test failure**, `ui/tokens.test.tsx` scans for it.

```css
/* The checked state as a glyph the diff can mark. See the note in
   `lib/compare/markdown.ts`: a real checkbox puts its state in an attribute,
   where this diff cannot see it, and the sanitiser deletes the element anyway. */
.markdown-rendered .md-task {
  display: inline-block;
  width: 1em;
  text-align: center;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  font-family: var(--font-mono);
  line-height: 1.2;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/compare/markdown.test.ts && npx vitest run ui/tokens.test.tsx`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add lib/compare/markdown.ts lib/compare/markdown.test.ts entrypoints/review/style.css
git commit -m "fix: show a ticked box as a change rather than as nothing"
```

---

### Task 3: Anchors

**Files:**
- Create: `lib/compare/markdownAnchors.ts`
- Modify: `lib/compare/markdown.ts`
- Test: `lib/compare/markdownAnchors.test.ts`, `lib/compare/markdown.test.ts`

- [ ] **Step 1: Write the failing test for the grammar**

Create `lib/compare/markdownAnchors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { anchorValue, parseAnchor } from './markdownAnchors';

const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

describe('anchorValue', () => {
  it('names a side and a line', () => {
    expect(anchorValue(NONCE, 'RIGHT', 12)).toBe(`${NONCE}-R12`);
    expect(anchorValue(NONCE, 'LEFT', 3)).toBe(`${NONCE}-L3`);
  });
});

describe('parseAnchor', () => {
  it('reads back what anchorValue wrote', () => {
    expect(parseAnchor(anchorValue(NONCE, 'RIGHT', 12), NONCE)).toEqual({
      side: 'RIGHT',
      line: 12,
    });
  });

  // The forgery case, and the reason the nonce exists. A `.md` file in a pull
  // request can write `data-md-anchor` itself; it cannot know a value minted
  // after it was authored.
  it('refuses a value bearing another nonce', () => {
    expect(parseAnchor(anchorValue('other-nonce', 'RIGHT', 12), NONCE)).toBeNull();
  });

  it.each(['', NONCE, `${NONCE}-`, `${NONCE}-R`, `${NONCE}-X1`, `${NONCE}-R0`, `${NONCE}-R-4`])(
    'refuses %p',
    (value) => {
      expect(parseAnchor(value, NONCE)).toBeNull();
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/compare/markdownAnchors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/compare/markdownAnchors.ts`:

```ts
/**
 * The grammar of a rendered block's source position, and the reason it can be
 * believed.
 *
 * Commenting on rendered prose needs to know which line of which side a block
 * came from, and the only place to carry that across the render-and-diff
 * pipeline is an attribute on the block itself. An attribute a pull request can
 * write is an attribute a pull request can forge, and a forged one would post a
 * reviewer's comment to a line they did not choose.
 *
 * So the value carries a nonce minted after the document was authored. A `.md`
 * file cannot guess it, and a value that does not bear the current one is
 * ignored — which costs a comment affordance on one block and never costs a
 * misdirected comment.
 *
 * `ui/markdownHtml.ts` admits exactly this one attribute name through a
 * sanitiser that otherwise strips every `data-*`. The note there explains why
 * that is narrow enough to be safe.
 */

import type { DiffSide } from '../github/types';

/** The attribute the anchor rides on. Named in one place, read in two. */
export const ANCHOR_ATTRIBUTE = 'data-md-anchor';

export interface BlockAnchor {
  side: DiffSide;
  /** One-based, as GitHub counts. `markdown-it`'s `map` is zero-based. */
  line: number;
}

export function anchorValue(nonce: string, side: DiffSide, line: number): string {
  return `${nonce}-${side === 'LEFT' ? 'L' : 'R'}${line}`;
}

/**
 * Read an anchor, or null.
 *
 * Null rather than a throw for every failure, including the forged one: this
 * runs over every block of a document a stranger wrote, and a document that can
 * raise an exception from the review page is a document that can stop the page
 * drawing.
 */
export function parseAnchor(value: string, nonce: string): BlockAnchor | null {
  if (!value.startsWith(`${nonce}-`)) return null;

  const rest = value.slice(nonce.length + 1);
  const side: DiffSide | null =
    rest.startsWith('L') ? 'LEFT' : rest.startsWith('R') ? 'RIGHT' : null;
  if (side === null) return null;

  const digits = rest.slice(1);
  // A strict test rather than `Number()`, which accepts '1e3', ' 1' and ''.
  if (!/^[1-9][0-9]*$/.test(digits)) return null;

  return { side, line: Number(digits) };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run lib/compare/markdownAnchors.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing test for stamping**

Append to `lib/compare/markdown.test.ts`:

```ts
describe('anchors', () => {
  const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

  it('stamps every block on the new side with its source line', () => {
    const result = compareMarkdown('# One\n\npara\n', '# One\n\npara two\n', NONCE);
    expect(result.unsafeHtml).toContain(`${ANCHOR_ATTRIBUTE}="${NONCE}-R1"`);
    expect(result.unsafeHtml).toContain(`${ANCHOR_ATTRIBUTE}="${NONCE}-R3"`);
  });

  it('stamps list items, not only the list', () => {
    const result = compareMarkdown('- a\n- b\n', '- a\n- c\n', NONCE);
    expect(result.unsafeHtml).toContain(`${ANCHOR_ATTRIBUTE}="${NONCE}-R2"`);
  });

  it('stamps the old side with L', () => {
    const result = compareMarkdown('gone\n', 'new\n', NONCE);
    expect(result.unsafeHtml).toContain(`${ANCHOR_ATTRIBUTE}="${NONCE}-L1"`);
  });

  it('carries its nonce back to the caller', () => {
    expect(compareMarkdown('a', 'b', NONCE).nonce).toBe(NONCE);
  });
});
```

- [ ] **Step 6: Implement stamping**

**This changes `compareMarkdown`'s signature, and Task 1's tests call it with two arguments.** Make `nonce` required rather than defaulted — an empty default would stamp anchors a document could forge, which defeats the whole mechanism — and update every existing two-argument call in `lib/compare/markdown.test.ts` to pass the `NONCE` constant. The typechecker will name them all. Do not add a default to avoid the churn.

In `lib/compare/markdown.ts`:

1. `compareMarkdown(before, after, nonce)` takes a third argument. Add `nonce: string` to `MarkdownComparison` and return it in every branch, including the refusals — `ui/` needs it even when there is no HTML, so that the failure path has one shape.
2. Render each side through a helper that installs the anchor rule for that side:

```ts
/**
 * Render one side, stamping each block with the line it came from.
 *
 * The side travels in the render environment rather than in the rule, so one
 * rule installed once serves both sides and neither can leak into the other.
 * Pushing a rule per render would look equivalent and would grow the instance's
 * rule chain on every card the reviewer opens.
 */
function renderSide(source: string, nonce: string, side: DiffSide): string {
  return renderer.render(source, { mdAnchor: { nonce, side } });
}
```

**Verified against `markdown-it` 15.0.2 on 2026-09-12:** `render(src, env)` threads `env` to core rules, the same instance renders `RIGHT` then `LEFT` without leakage, and a render with no `mdAnchor` in its env stamps nothing. Individual list items receive their own anchors (`R3`, `R4`), which is the granularity Task 8's affordance depends on.

and a rule reading that env:

```ts
renderer.core.ruler.push('source-anchors', (state): void => {
  const env = state.env as { mdAnchor?: { nonce: string; side: DiffSide } };
  const stamp = env.mdAnchor;
  if (stamp === undefined) return;

  for (const token of state.tokens) {
    // `nesting === -1` is a closing tag, which carries no attributes, and
    // `map` is absent on inline tokens. Both would stamp nothing useful.
    if (token.map === null || token.nesting === -1) continue;
    const line = token.map[0];
    if (line === undefined) continue;
    token.attrSet(ANCHOR_ATTRIBUTE, anchorValue(stamp.nonce, stamp.side, line + 1));
  }
});
```

`map` is zero-based and GitHub counts from one — the `+ 1` is the whole of that conversion and there is a test pinning it.

- [ ] **Step 7: Run**

Run: `npx vitest run lib/compare/markdown.test.ts lib/compare/markdownAnchors.test.ts`
Expected: PASS.

- [ ] **Step 8: Update the one caller**

`ui/RichCompare.tsx` calls `compareMarkdown(text.before, text.after)`. Give it a nonce minted in the same memo, so it is stable for as long as the two sides are:

```ts
const markdown = useMemo(
  () =>
    kind !== 'markdown' || text.status !== 'ready'
      ? null
      : // Minted here rather than in `lib/`, which is pure and has no crypto.
        // Per comparison, so a document cannot carry a value it has seen before.
        compareMarkdown(text.before, text.after, crypto.randomUUID()),
  [kind, text.status, text.before, text.after],
);
```

- [ ] **Step 9: Run everything and commit**

```bash
npm test && npm run typecheck
git add lib/compare/markdownAnchors.ts lib/compare/markdownAnchors.test.ts lib/compare/markdown.ts lib/compare/markdown.test.ts ui/RichCompare.tsx
git commit -m "feat: let a rendered block say which line it came from"
```

---

### Task 4: The sanitiser admits one attribute

**Files:**
- Modify: `ui/markdownHtml.ts`
- Test: `ui/markdownHtml.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('the anchor attribute', () => {
  it('survives, because the affordance depends on it', () => {
    expect(sanitizeMarkdownHtml(`<p ${ANCHOR_ATTRIBUTE}="n-R1">x</p>`)).toContain(
      ANCHOR_ATTRIBUTE,
    );
  });

  // The reason ALLOW_DATA_ATTR was false, and it must stay true of everything
  // except the one name above. DiffColumn finds threads with [data-thread] and
  // Shell finds a reply box with [data-reply-for] and casts it to a textarea.
  it.each(['data-thread', 'data-reply-for', 'data-file-card', 'data-unanchored'])(
    'still strips %s',
    (attribute) => {
      expect(sanitizeMarkdownHtml(`<p ${attribute}="x">y</p>`)).not.toContain(attribute);
    },
  );
});
```

- [ ] **Step 2: Run, expect the first to FAIL**

Run: `npx vitest run ui/markdownHtml.test.tsx -t "anchor attribute"`

- [ ] **Step 3: Implement**

Add `ADD_ATTR: [ANCHOR_ATTRIBUTE]` to `PURIFY_CONFIG`, importing `ANCHOR_ATTRIBUTE` from `@/lib/compare/markdownAnchors`. Amend the `ALLOW_DATA_ATTR` comment — it currently reads as absolute and is now one exception short of it:

```
   * No `data-*`, with exactly one exception.
   *
   * This page finds things by data attribute and then acts on what it finds:
   * `DiffColumn` locates a thread with `querySelectorAll('[data-thread]')`, and
   * `Shell` locates a reply box with `querySelector('[data-reply-for="…"]')`
   * and casts the result to a textarea. Either of those pointed at an element a
   * pull request supplied is a bug with no script in it anywhere.
   *
   * `ADD_ATTR` admits `data-md-anchor` and nothing else, so neither of those
   * queries can be reached. What that attribute *says* is a different question
   * from whether it survives, and the nonce in `lib/compare/markdownAnchors.ts`
   * is what answers it: a value not bearing the current one is ignored, so a
   * forged anchor costs an affordance and never costs a misdirected comment.
   *
   * Anyone widening this list should have to answer both halves again.
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run ui/markdownHtml.test.tsx
git add ui/markdownHtml.ts ui/markdownHtml.test.tsx
git commit -m "feat: admit the anchor attribute, and only that one"
```

---

### Task 5: Which lines GitHub will accept

**Files:**
- Create: `lib/review/commentable.ts`
- Test: `lib/review/commentable.test.ts`

**UNVERIFIED, and it matters:** the design asserts GitHub rejects a comment on a line outside the diff, and that is *not* recorded in `docs/reference/github-review-api.md`. This task builds the predicate either way — it is what decides whether a block posts as a line comment or as a file-level one, and both paths are wanted regardless of the answer. Do not block on verifying it; flag it in your report.

- [ ] **Step 1: Write the failing test**

Create `lib/review/commentable.test.ts`. A patch to test against:

```ts
const PATCH = [
  '@@ -1,3 +1,4 @@',
  ' context one',
  '-removed',
  '+added',
  '+also added',
  ' context two',
].join('\n');
```

```ts
describe('commentableLines', () => {
  it('accepts an added line on the right', () => {
    expect(commentableLines(PATCH).has('RIGHT:2')).toBe(true);
  });

  it('accepts a context line on both sides', () => {
    expect(commentableLines(PATCH).has('RIGHT:1')).toBe(true);
    expect(commentableLines(PATCH).has('LEFT:1')).toBe(true);
  });

  it('accepts a removed line on the left only', () => {
    expect(commentableLines(PATCH).has('LEFT:2')).toBe(true);
    expect(commentableLines(PATCH).has('RIGHT:99')).toBe(false);
  });

  it('is empty for a patch with no hunks', () => {
    expect(commentableLines('').size).toBe(0);
  });
});

describe('isCommentable', () => {
  it('reads the set for one side and line', () => {
    const lines = commentableLines(PATCH);
    expect(isCommentable(lines, { side: 'RIGHT', line: 2 })).toBe(true);
    expect(isCommentable(lines, { side: 'RIGHT', line: 400 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

Create `lib/review/commentable.ts`. Walk the patch's hunk headers (`@@ -oldStart,oldCount +newStart,newCount @@`) and step both counters:

- a line starting `+` advances the new counter and is commentable on `RIGHT`
- a line starting `-` advances the old counter and is commentable on `LEFT`
- a line starting with a space advances both and is commentable on both
- `\` (the "no newline" marker) advances neither

Key it as `` `${side}:${line}` `` so the set is a plain `Set<string>` — the design calls for a predicate over `{side, line}` and a keyed set is the cheapest honest shape. Export both `commentableLines(patch): ReadonlySet<string>` and `isCommentable(lines, anchor): boolean`.

Document why the predicate exists at all: the rendered view draws the *whole* document, so most blocks on a sizeable README are outside every hunk, and a comment affordance that posts a comment GitHub will refuse is worse than one that says up front it will be a file-level comment.

- [ ] **Step 4: Run, then commit**

```bash
npx vitest run lib/review/commentable.test.ts
git add lib/review/commentable.ts lib/review/commentable.test.ts
git commit -m "feat: work out which lines a comment can actually reach"
```

---

### Task 6: Split the document into blocks

**Files:**
- Create: `ui/markdownBlocks.ts`, `ui/markdownBlocks.test.tsx`
- Modify: `ui/MarkdownCompare.tsx`
- Create: `ui/MermaidBlock.tsx`

This is the structural heart of the change. Read §6 of the design first, and read `ui/MarkdownCompare.tsx` in full — the bug it documents (React rebuilding the `innerHTML` subtree and silently wiping the drawn diagrams) is the thing this task makes impossible.

- [ ] **Step 1: Write the failing test for the split**

Create `ui/markdownBlocks.test.tsx`:

```tsx
describe('markdownBlocks', () => {
  const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

  it('gives one entry per top-level element, in order', () => {
    const blocks = markdownBlocks('<h1>A</h1><p>B</p>', NONCE);
    expect(blocks.map((b) => b.html)).toEqual(['<h1>A</h1>', '<p>B</p>']);
  });

  it('reads each block anchor', () => {
    const blocks = markdownBlocks(`<p ${ANCHOR_ATTRIBUTE}="${NONCE}-R7">x</p>`, NONCE);
    expect(blocks[0]?.anchor).toEqual({ side: 'RIGHT', line: 7 });
  });

  it('leaves a forged anchor unanchored', () => {
    const blocks = markdownBlocks(`<p ${ANCHOR_ATTRIBUTE}="forged-R7">x</p>`, NONCE);
    expect(blocks[0]?.anchor).toBeNull();
  });

  it('sanitises each block', () => {
    const blocks = markdownBlocks('<p onclick="x">hi</p><script>bad()</script>', NONCE);
    expect(blocks.map((b) => b.html).join('')).not.toContain('onclick');
    expect(blocks.map((b) => b.html).join('')).not.toContain('<script');
  });

  it('says which blocks the diff marked', () => {
    const blocks = markdownBlocks('<p><ins class="diffins">new</ins></p><p>old</p>', NONCE);
    expect(blocks[0]?.changed).toBe(true);
    expect(blocks[1]?.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement the split**

Create `ui/markdownBlocks.ts`. Its file comment must carry the security argument, because this is where a reader will look for it:

```ts
/**
 * The rendered diff, cut into blocks, each one safe to insert.
 *
 * The whole document used to go into one `dangerouslySetInnerHTML`, which made
 * every later decision imperative: a thread card is a React component, and
 * reaching into a subtree React does not reconcile means portals, placeholder
 * elements, and the wipe hazard `MarkdownCompare` documents.
 *
 * **The split happens before sanitising, and that ordering is the point.**
 * Splitting the *sanitised* string would mean re-parsing and re-serializing
 * markup already declared safe, which `ui/markdownHtml.ts` refuses on the
 * grounds that every parse-and-print round trip is a chance for two parsers to
 * disagree. So the parse here runs on untrusted input, upstream of the gate,
 * exactly where `diffHtml` already sits — and each block is sanitised
 * immediately before it is handed over. The sanitiser is still the last thing
 * that touches every string.
 *
 * `DOMParser` is inert: the document it builds has no browsing context, so
 * nothing executes and nothing is fetched. There is a test for that.
 */
```

Shape:

```ts
export interface MarkdownBlock {
  /** Stable across re-renders of the same document. The index is enough. */
  key: string;
  /** Sanitised. Safe to insert. */
  html: string;
  /** Where a comment on this block would go, or null if it cannot be believed. */
  anchor: BlockAnchor | null;
  /** Whether the diff marked anything inside it. */
  changed: boolean;
  /** The block's text, for seeding a file-level comment's blockquote. */
  text: string;
  /** The Mermaid source, when this block is a diagram fence. Null otherwise. */
  mermaid: string | null;
}

export function markdownBlocks(unsafeHtml: string, nonce: string): MarkdownBlock[];
```

Reuse `ui/mermaidBlocks.ts` for the `mermaid` field rather than reimplementing the source reconstruction — its comment explains why that reconstruction is exact, and that reasoning is not worth duplicating.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Rewrite `MarkdownCompare`**

Each block becomes a React element:

```tsx
{blocks.map((block) =>
  block.mermaid !== null ? (
    <MermaidBlock key={block.key} block={block} />
  ) : (
    <div
      key={block.key}
      className="markdown-block"
      // eslint-disable-next-line react/no-danger -- sanitised in markdownBlocks,
      // immediately before this, with nothing in between. See the note there.
      dangerouslySetInnerHTML={{ __html: block.html }}
    />
  ),
)}
```

Delete `placeDiagram`, `placeRefusal`, the `useEffect` that walked the subtree, the `live` flag and the `html` memo. `MermaidBlock.tsx` renders one diagram declaratively: `useState` for the drawn SVG, `useEffect` to draw it, the caption when `block.changed`, and the marked-up source kept below when changed and hidden when not — preserving the existing behaviour and the reasoning behind it.

- [ ] **Step 6: Run the suites**

Run: `npm test && npm run typecheck`
Expected: PASS. `ui/MarkdownCompare.test.tsx` will need reworking — it asserts against the old single-subtree shape. Keep every *behaviour* it asserts; change only how it reaches for the DOM.

- [ ] **Step 7: Verify in a real browser**

The wipe bug this replaces **only ever showed up in a real browser**. Run `npx wxt build` and load `.output/chrome-mv3` as an unpacked extension, or run the e2e suite. Do not skip this step; the unit tests did not catch it last time.

- [ ] **Step 8: Commit**

```bash
git add ui/markdownBlocks.ts ui/markdownBlocks.test.tsx ui/MarkdownCompare.tsx ui/MarkdownCompare.test.tsx ui/MermaidBlock.tsx
git commit -m "feat: give every rendered block to React, and take the diagrams off the DOM"
```

---

### Task 7: A comment anchor can name a file

**Files:**
- Modify: `lib/review/selection.ts`, `ui/reviewSession.tsx`, and every call site the typechecker names
- Test: `lib/review/selection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('file-level anchors', () => {
  it('is its own subject', () => {
    expect(fileAnchor()).toEqual({ subject: 'file' });
  });

  it('a normalised selection is a line subject', () => {
    const result = normalizeSelection({ start: 3, end: 3, side: 'additions' });
    expect(result.ok && result.value.subject).toBe('line');
  });
});
```

- [ ] **Step 2: Implement the union**

```ts
export interface LineAnchor {
  subject: 'line';
  line: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
}

/**
 * A comment on the file rather than on a line.
 *
 * GitHub has always taken these — `subjectType: FILE` — and this application
 * has always *read* them; `ui/reviewThreads.ts` labels them "Whole file". It
 * has never posted one, because until now every comment started from a gutter
 * and a gutter is made of lines.
 *
 * The rendered Markdown view is what needs it: it draws the whole document, so
 * most of what is on screen is outside every hunk, and a block that cannot take
 * a line comment can still take this one.
 */
export interface FileAnchor {
  subject: 'file';
}

export type CommentAnchor = LineAnchor | FileAnchor;
```

Run `npm run typecheck` and fix every site it names. Most will be a `anchor.subject === 'line'` guard before reading `.line`. Do not widen types to silence it.

- [ ] **Step 3: Send it**

In `ui/reviewSession.tsx`, `addThread` sends `subjectType: 'FILE'` and omits `line`/`side` for a file anchor, keeping the existing "left out entirely rather than sent null" rule — an unsupplied variable is dropped from the coerced input, an explicit null is sent as a null.

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: let a comment be about the file rather than a line"
```

---

### Task 8: The affordance, the composer and the threads

> **Tasks 8 and 9 are deliberately specified as behaviour rather than as code, and that is a departure from this plan's own standard.** Both act on the component shape Task 6 produces, which does not exist yet — exact test code written now would be guessing at DOM that has not been designed. **Before starting Task 8, re-read `ui/MarkdownCompare.tsx` as Task 6 left it and write these tasks out properly, with real code, the way Tasks 1–7 are written.** Treat what follows as the requirements, not as the plan.

**Files:**
- Modify: `ui/MarkdownCompare.tsx`, `entrypoints/review/style.css`
- Test: `ui/MarkdownCompare.test.tsx`

- [ ] **Step 1: Write the failing tests**

Five behaviours, each its own test:

1. Every block carries a comment button.
2. A block whose anchor is commentable opens the composer with that `LineAnchor` — assert the line and side that reach the composer, not merely that something opened.
3. A block outside every hunk opens the composer with `fileAnchor()`, shows the sentence explaining it before the reviewer types, and seeds the body with the block's text as a blockquote.
4. A thread whose line matches a block anchor renders under that block.
5. An outdated thread — `line: null` — stays in `UnanchoredThreads` with its existing reason.

- [ ] **Step 2: Implement**

- The affordance is a button in the block's left margin, revealed on hover and on focus-within. **Not in the tab order** — a README has hundreds of blocks and one tab stop each would make the document unusable by keyboard. The keyboard route is Task 9.
- A block whose anchor is `isCommentable` opens the composer with that `LineAnchor`. Otherwise it opens with `fileAnchor()`, a sentence saying the block is not part of the diff, and the body seeded with `> ` + the block's text.
- Threads: partition the file's threads by whether their line matches a block anchor. Matches render under their block; the rest keep going to `UnanchoredThreads` with the reasons it already gives.

- [ ] **Step 3: Run, verify in a browser, commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: let a reviewer say something about the paragraph in front of them"
```

---

### Task 9: The keyboard

**Files:** Modify `ui/MarkdownCompare.tsx`, `ui/shortcutTargets.tsx` (or wherever `next-hunk` is handled)

No new bindings. `lib/keymap.ts` already declares `next-hunk` (`J`), `previous-hunk` (`K`) and `comment-on-line` (`c`), and all three currently do nothing in this view.

- [ ] **Step 1: Write the failing test** — `J` moves to the next *changed* block; `c` opens the composer on the current one.
- [ ] **Step 2: Implement.** A changed block is what a hunk is in a rendered document; say so in a comment where the mapping is made.
- [ ] **Step 3: Run and commit.**

```bash
git commit -m "feat: walk a rendered document with the keys that already meant this"
```

---

### Task 10: Browser coverage, and the record

**Files:** Modify `e2e/review.spec.ts`, `e2e/fixture.ts`, `README.md`, `docs/reference/github-review-api.md`

§5 of the rich-diff spec records that the rendered Markdown mode has **no browser coverage at all**. It must not stay that way through a change this size.

- [ ] **Step 1: e2e** — comment on a rendered Markdown block, both the anchored path and the file-level path, with GitHub mocked at the service worker. `e2e/fixture.ts` already has `MARKDOWN_FILE` and `MARKDOWN_TEXT`; extend the fixture text so it contains a changed block and an untouched one.
- [ ] **Step 2: Verify the UNVERIFIED.** Execute `addPullRequestReviewThread` against a real pull request with a line outside the diff. Record the answer in `docs/reference/github-review-api.md` whichever way it goes. If you cannot run it, say so plainly in your report — do not guess and do not quietly skip it.
- [ ] **Step 3: README.** The "Known limits" section says the PR description renders as plain text "because this project takes neither a Markdown renderer nor a sanitizer as a dependency". That has been false since the rendered mode shipped and is now doubly so. Fix it.
- [ ] **Step 4: Re-measure the bundle.** Build before and after with `npx wxt build` and record the real gzipped delta, replacing the scratch-build figure in §4 of the design spec.
- [ ] **Step 5: Full verification.**

```bash
npm test
npm run typecheck
npm run test:e2e
```

Report actual output. Do not claim success without it.
