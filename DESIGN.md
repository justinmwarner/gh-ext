---
name: A Better Reviewer
description: A fast review UI for GitHub pull requests, wearing GitHub's own palette on purpose.
colors:
  canvas-default: "#ffffff"
  canvas-default-dark: "#0d1117"
  canvas-subtle: "#f6f8fa"
  canvas-subtle-dark: "#212830"
  canvas-overlay: "#ffffff"
  canvas-overlay-dark: "#151b23"
  fg-default: "#1f2328"
  fg-default-dark: "#e6edf3"
  fg-muted: "#59636e"
  fg-muted-dark: "#9198a1"
  fg-subtle: "#8c959f"
  fg-subtle-dark: "#6e7681"
  border-default: "#d1d9e0"
  border-default-dark: "#3d444d"
  border-muted: "#eef1f4"
  border-muted-dark: "#2d333b"
  neutral-hover: "#eef1f4"
  neutral-hover-dark: "#262c36"
  accent-fg: "#0969da"
  accent-fg-dark: "#4493f8"
  accent-subtle-bg: "#ddf4ff"
  accent-subtle-bg-dark: "#121d2f"
  success-fg: "#1a7f37"
  success-fg-dark: "#3fb950"
  success-emphasis: "#1f883d"
  success-emphasis-dark: "#238636"
  danger-fg: "#cf222e"
  danger-fg-dark: "#f85149"
  attention-fg: "#9a6700"
  attention-fg-dark: "#d29922"
  attention-subtle-bg: "#fff8c5"
  attention-subtle-bg-dark: "#2a2213"
  done-emphasis: "#8250df"
  done-emphasis-dark: "#8957e5"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  card: "14px"
  pill: "999px"
spacing:
  "2xs": "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  button:
    backgroundColor: "{colors.canvas-subtle}"
    textColor: "{colors.fg-default}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.neutral-hover}"
    textColor: "{colors.fg-default}"
  button-primary:
    backgroundColor: "{colors.success-emphasis}"
    textColor: "#ffffff"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  button-primary-hover:
    backgroundColor: "{colors.success-fg}"
    textColor: "#ffffff"
  input:
    backgroundColor: "{colors.canvas-default}"
    textColor: "{colors.fg-default}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  badge:
    backgroundColor: "{colors.success-emphasis}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "1px 10px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.fg-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "1px 10px"
  card-injected:
    backgroundColor: "{colors.canvas-default}"
    textColor: "{colors.fg-default}"
    rounded: "{rounded.card}"
    padding: "14px"
    width: "248px"
  cta-injected:
    backgroundColor: "{colors.success-fg}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "9px 18px"
---

# Design System: A Better Reviewer

## 1. Overview

**Creative North Star: "The Borrowed Room"**

This system furnishes a room in someone else's house. A reviewer arrives from a
github.com pull request page and lands on a page that is not github.com, and the
design's entire job is to make that transition unnoticeable. Nothing announces
itself as new. There is no logo lockup on the review page, no accent colour that
GitHub does not already use, no typeface GitHub does not already use. The
improvement the reviewer feels is speed and keyboard reach, not decoration. If
someone screenshots the review page and a colleague cannot immediately tell it
is not GitHub, the system is working.

That constraint is load-bearing rather than lazy. Both `@pierre/diffs` and
`@pierre/trees` render into shadow roots and theme themselves from
`color-scheme: light dark` plus `light-dark()`. Matching them means there is one
source of truth for theme, the operating system, and no second theme system to
drift. Every colour below is a GitHub Primer value written as a `light-dark()`
pair, and it is named here as a Primer value so nobody later mistakes it for a
choice that is theirs to nudge. Changing one of these is not a taste decision;
it is a decision to introduce a seam.

**The tokens live in `ui/tokens.css` and that file is the only place they are
written down.** All three surfaces consume it: the review page and the options
page import it as a stylesheet, and the card imports it with `?raw` and inlines
the same text into its shadow root, which is why the file declares `:root, :host`
rather than `:root`. A literal hex anywhere else is a mistake. Before this
existed the palette was written out three times and had already drifted in two
places, which was the original argument for it; the stronger argument arrived
later, when the tokens became the mechanism by which a reviewer's chosen theme
reaches the whole product rather than only the code inside a diff.

**All of the above describes the default.** It is the default because it is
right for someone who has not asked for anything else, and the seamlessness
argument is a real one. But it stopped being the *only* answer the moment this
extension offered seventy-five syntax themes and then drew them inside a page
that stayed GitHub-white. Choosing a theme now replaces every token on all three
surfaces. The section on [Themed Palettes](#themed-palettes) sets out what is
derived, what is taken verbatim, and the two things this system is still allowed
to repair.

The density is that of a tool used under load. The workhorse size is 12px, not
14px. Controls are 28px tall, not 40px. Padding is measured in 4px and 6px
steps, not 16px ones. This system explicitly rejects the visual language of a
developer tool that is being sold: no gradient hero, no metric tiles, no
purple-to-blue accent, no illustrated empty states. It equally rejects being a
second GitHub with everything in it, and the interface should never read as
though it is trying to be comprehensive.

**Key Characteristics:**

- Dual-theme by default, driven entirely by `color-scheme: light dark` and `light-dark()`. There is no theme toggle and no theme context — one setting names a theme, and a palette derived from it is written over the tokens.
- GitHub Primer palette by default, hard-coded and matched deliberately; any of seventy-five themes on request, across all three surfaces.
- System font stack only. Zero web fonts, zero network requests for type.
- Dense: 11/12/13px carry the interface; 14px is body prose.
- Flat by default. Three shadows exist and all three mean "this floats".
- One accent (Primer blue) for interaction, one green for affirmative action, one red for destructive and deletion.
- Motion is 120-150ms and confined to colour, with two exceptions, both on the injected card.

## 2. Colors

The palette is GitHub Primer, adopted whole. Each token is a `light-dark()` pair
and both halves are given, light first. The names below are Primer's own role
names because the name is the constraint: these are matched values, not authored
ones.

**This section describes the default, and only the default.** A reviewer who
chooses a syntax theme replaces every value below with one derived from that
theme, on all three surfaces at once — the review page, the options page and the
injected card. The names survive; the values do not. Read
[Themed Palettes](#themed-palettes) at the end of this section before assuming
any measurement here still holds, and before adding a token.

### Primary

- **Primer Accent Foreground** (`#0969da` / `#4493f8`): The only interaction colour. Links, the `:focus-visible` outline, `accent-color` for native checkboxes and search fields, and the "modified" tint pushed into Pierre's diff renderer. It is the answer to "can I click this" and to "where am I", and it is used for nothing else. Set as `accent-color` on `:root` specifically so the user agent does not introduce a fifth blue.
- **Primer Success Emphasis** (`#1f883d` / `#238636`): Fill for the primary button and for the open-state badge. The affirmative action, once per screen at most.
- **Primer Success Foreground** (`#1a7f37` / `#3fb950`): Text-weight green. Additions in the diff, passing checks, the primary button's hover fill. Pushed into Pierre as `--diffs-addition-color-override` because Pierre's own `#0dbe4e` measures 2.47:1 on white and the counts render at 12px. **That push is conditional now.** It sits behind `:root:not([data-syntax-theme])`, so it applies only while the reviewer is letting Pierre choose the theme. Choosing one releases it, deliberately: the themes most worth choosing are the four built for colour vision deficiency, and repainting their added and removed lines in a Primer red and a Primer green would undo exactly what they are for.

### Secondary

- **Primer Danger Foreground** (`#cf222e` / `#f85149`): Deletions, failed checks, error results, the warning panel. Also pushed into Pierre as `--diffs-deletion-color-override`.
- **Primer Attention Foreground** (`#9a6700` / `#d29922`): Pending and in-progress only. Checks that have not finished, work that is not yet resolved. Never a warning about the user's own action. Amber has four roles and they are not interchangeable: this one stands on the page, **Attention Foreground, Tinted** (`#7d4e00` / `#e3b341`) sits on an already-tinted panel and so has to be darker, **Attention Border** (`#d4a72c` / `#d29922`) edges a panel, and **Attention Border Muted** (`#f0d58c` / `#6b4b12`) edges a chip sitting on the tint. There was a fifth, `#bf8700`, on exactly one inset stripe; it has been retired into the first, whose dark half was already identical to it.
- **Primer Done Emphasis** (`#8250df` / `#8957e5`): Merged state, and nothing else. It appears on exactly one badge. **Done Foreground** (`#8250df` / `#a371f7`) is its text-weight twin, on the tree's "renamed" status and nowhere else. Purple means *finished*, as distinct from went-well or went-badly, which is the whole of its licence.

### Tints, edges and hovers

Each of the four coloured families — accent, success, danger, attention — carries
the same small set of derived roles, and they used to be written as literal pairs
at each point of use. Naming them is what lets a chosen theme reach them.

- **Subtle Background**: the family's colour as a panel tint. `--accent-subtle-bg` (`#ddf4ff` / `#121d2f`), `--success-subtle-bg` (`#e6ffec` / `#12261e`), `--danger-subtle-bg` (`#ffebe9` / `#25171c`), `--attention-subtle-bg` (`#fff8c5` / `#2a2213`).
- **Subtle Hover**: that tint with the cursor on it. One step, not a new colour.
- **Border**: the edge of such a panel. `--accent-border` (`#b6d7ff` / `#1f4b7d`), `--danger-border` (`#ffcecb` / `#6e2529`), `--success-border` (`#1f883d` / `#2f6f42`) — the last is the primary button's own edge, because a green control outlined in Border Default reads as a grey control somebody painted.
- **Foreground, Tinted**: the family's text colour when it is standing on its own tint rather than on the page, and therefore stepped away from the page. `--accent-fg-tinted` (`#0550ae` / `#79c0ff`), `--danger-fg-tinted` (`#a40e26` / `#ff8182`).
- **Emphasis** and **Emphasis Hover**: fill weight, for a badge or a pressed control. `--accent-emphasis` (`#0969da` / `#316dca`), `--danger-emphasis` (`#cf222e` / `#da3633`), `--neutral-emphasis` (`#59636e` / `#6e7781`).
- **Accent Muted Background** (`#dbe9ff` / `#253143`): stronger than a tint, still not a fill. The selected row in the file tree and the active row in the search palette — both of which have to win against the row above and below rather than only against the panel.

### Text on a coloured fill

Six tokens — `--on-accent`, `--on-success`, `--on-danger`, `--on-attention`,
`--on-neutral`, `--on-done` — where a single white would nearly do. All are
`#ffffff` except `--on-attention`, which is `#ffffff` / `#0d1117`: white clears
4.5:1 on the light amber and reaches only 2.52:1 on the dark one, so the dark
half inverts to the page colour.

The other five look redundant and are not. A fill and the text on it are one
decision, and under a chosen theme the right answer differs per fill: white reads
on GitHub Light's red and measures 2.8:1 on its green, where black measures
7.5:1. Six tokens is what lets a theme's fills be used exactly as their author
wrote them and still leave every badge legible — the derivation picks each label
against its own fill rather than darkening anybody's green.

### Neutral

- **Primer Canvas Default** (`#ffffff` / `#0d1117`): The page. Also assigned to `diffs-container` as `--diffs-bg` from the outer tree, because the shadow sheet's own `:host` declares that slot and an inherited value would lose to it. Left alone, three different backgrounds meet at the seams.
- **Primer Canvas Subtle** (`#f6f8fa` / `#212830`): Resting fill for secondary buttons, inline `code`, and grouped rows. The first step of layering.
- **Primer Canvas Inset** (`#f6f8fa` / `#010409`): Sunken rather than layered — *darker* than the page in both modes, which is what makes the scope bar and the view-tab rail read as a channel cut into the page rather than a panel resting on it. The opposite direction from Canvas Overlay, and the pair of them is the whole of this system's depth.
- **Primer Canvas Overlay** (`#ffffff` / `#151b23`): Menus and popovers only. In dark mode it is deliberately *lighter* than the page, which is what makes an overlay read as above rather than as a hole.
- **Primer Foreground Default** (`#1f2328` / `#e6edf3`): All body and control text.
- **Primer Foreground Muted** (`#59636e` / `#9198a1`): The most-used colour in the system, at 63 declarations. Timestamps, secondary counts, hints under settings, path prefixes. Measured 6.11:1 light and 6.50:1 dark on Canvas Default. **Nothing quieter than this is permitted for text**, which is the rule that keeps this system out of the usual failure mode of light grey body copy.
- **Primer Foreground Subtle** (`#8c959f` / `#6e7681`): Non-text only, and the token most likely to be misused. It measures 3.04:1 on Canvas Default, which clears the 3:1 bar for a graphical object and does not clear the 4.5:1 bar for text. Icon strokes, the 1.5px inset ring on an indeterminate control, and disabled labels.
- **Primer Border Default** (`#d1d9e0` / `#3d444d`): 60 declarations, and the system's main separator. Every control outline, every panel edge, every divider.
- **Primer Border Muted** (`#eef1f4` / `#2d333b`): Lighter-weight structure, where a full border would be too loud: the rules between grid cells, and the tiles of the transparency checkerboard behind an image diff.
- **Neutral Hover** (`#eef1f4` / `#262c36`): The one-step-warmer fill that every hoverable neutral surface moves to. One value: this used to be `#262c36` on buttons and `#212830` on tree rows and view tabs, which is one interaction state answered two different ways. The second has been collapsed into the first.

### Named Rules

**The Matched Value Rule.** Every colour in *the default palette* exists in
GitHub Primer at the same role name. Introducing a colour that Primer does not
have requires a reason that survives the question "what happens at the seam when
a reviewer looks at both pages in the same minute". There are two standing
exceptions, both on the injected card, and both are documented in Components.

The qualifier is new and it is load-bearing. The rule constrains what this
system *authors*; it does not constrain what a reviewer *chooses*. See
[Themed Palettes](#themed-palettes).

**The Named Colour Rule.** A colour literal outside `ui/tokens.css` is a defect,
not a style violation. It used to be merely a duplicate of a value that already
had a name, and duplicates drift. Now it is a colour that *cannot follow the
reviewer's theme* — a patch of Primer left behind on a page that has become
somebody's Nord. `ui/tokens.test.tsx` enforces this across the review
stylesheet, the options stylesheet and the card, with exactly one allowed
exception: the `#000000` plate behind an image diff's difference blend, which is
an operand of `mix-blend-mode` rather than a surface.

**The One Blue Rule.** `#0969da` / `#4493f8` is the only blue. It means
interaction. A second blue for information, for headings, or for a link that is
somehow different, is prohibited. Native controls are pinned to it via
`accent-color` for exactly this reason.

**The Pushed-In, Not Pulled-Out Rule.** When Pierre's colours are wrong, they are
overridden from this system rather than copied out of it. Read the fallback slot
(`--diffs-light-bg`), not the declared property (`--diffs-bg`), because `:host`
inside the shadow sheet declares the latter and beats anything inherited. Never
duplicate a Pierre value into page CSS: two copies drift.

### Named Rules

**The Reviewer Owns The Colours Rule.** Everything in section 2 is this system's
to decide *by default*, and the reviewer's to replace. It used to stop at the
diff's edge — the syntax colours inside a diff were a setting and the page
around them was not. That was a seam down the middle of one screen, and a worse
one than the seam with github.com the Primer palette exists to avoid, because a
reviewer sees both halves of it at once. Choosing a theme now recolours the
diff, the page around it, the options page and the injected card. Nothing here
may override a theme the reviewer has chosen, and that includes the addition and
deletion colours this page is otherwise entitled to push into Pierre.

<a id="themed-palettes"></a>

### Themed Palettes

The reviewer's choice is a theme id. Everything else is derived from it.

**The default is not a theme.** Left on "Match the page", no derivation runs at
all: `ui/tokens.css` keeps the hand-matched Primer pairs above, with the
measured ratios they were chosen for. That split is the whole design. The
default ships accessible; a theme the reviewer went and chose is rendered as its
author wrote it.

**The token names are the interface.** `lib/theme/tokens.ts` lists every name in
`ui/tokens.css`, in an order the generated table depends on positionally.
`ui/tokens.test.tsx` fails if the two lists disagree — a token declared in the
stylesheet and missing from the list keeps its Primer pair while everything
around it turns, which is the failure this feature exists to remove.

**Three kinds of derived token**, and it is worth knowing which is which when
reading `lib/theme/derive.ts`:

- **Stated.** The theme has a workbench key for it, and it is taken.
- **Chained.** Several keys might carry it. The chains are ordered by how often
  themes actually declare each key, measured across all seventy-five rather than
  guessed, and every chain ends somewhere that cannot fail. `terminal.ansiBlue`
  sits ahead of `focusBorder` in the accent chain because a focus ring is often
  a muted neutral — Solarized Light's is a tan — while a theme's ansi blue is
  the blue its author would name if asked.
- **Stepped.** No theme states it: a hover, a tint, a panel edge. Derived by
  moving a stated colour a fixed distance toward the page or away from it.
  "Away from the page" is darker on a light theme and lighter on a dark one,
  which is the single rule that lets one derivation serve both halves of the
  list.

**Two repairs, and no more.** A stated value is declined only when it is not so
much a colour as a missing one:

- A `list.hoverBackground` equal to the surface under it, or one that would
  erase the row text. `@pierre/theming` does this itself.
- A `panel.border` that is either invisible against the page or is plainly the
  theme's accent wearing a border's name. `--border-default` rules sixty
  declarations here where it rules one divider in an editor, and Dracula's
  `#BD93F9` would draw every hairline on the page in a bright purple that also
  collides with what this system uses to mean "merged". The accepted band is
  1.15:1 to 4:1 against the page, set against the list rather than picked.

Nothing else is adjusted. In particular **a theme's fills are never darkened to
make their labels fit** — the label moves instead, which is what the six `--on-*`
tokens are for.

**Contrast is a default-only guarantee.** Every ratio quoted in section 2 is
measured, and every one of them is a statement about "Match the page". A palette
derived from seventy-five community themes cannot carry the same promise, and
pretending otherwise by quietly rewriting an author's colours would be the worse
failure. The options page says this in as many words, and points a reviewer who
needs the guarantee back at the default.

**`color-scheme` travels with the palette.** A chosen theme pins it to the mode
that theme was built for, so choosing a dark theme gives a dark page on a
machine set to light — what an editor does. It is also the safety net: anything
still written as `light-dark()` at least resolves to the half the chosen theme
expects, so a straggler is off-palette rather than a white panel in a black page.

**The table is generated.** `npm run palettes` derives all seventy-five palettes
and writes `lib/theme/palettes.ts`; `lib/theme/palettes.test.ts` re-derives them
and fails if the committed table has fallen behind. It is baked rather than
resolved at runtime because the content script has to paint the card in the
reviewer's colours on the first frame, on someone else's page, without making
seventy-five theme files web-accessible to github.com.

## 3. Typography

**Display Font:** none. This system has no display type and should not acquire any.
**Body Font:** `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

The injected card uses `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`
instead, matching GitHub's own stack character-for-character, because it renders
inside GitHub's page and any difference in metrics is visible against the text
beside it.

**Character:** The reviewer's own operating system, at small sizes, with weight
doing all the hierarchy work. There are no web fonts and there should never be
one: a font request is a render-blocking round trip in a product whose entire
argument is speed, and the system stack is what GitHub uses anyway.

### Hierarchy

- **Headline** (600, `1.375rem`/22px, 1.5): The options page `h1`. The largest type in the product. There is nothing above it and nothing needs to be.
- **Title** (600, 13px, 1.5): Section headings, button labels, file names in the tree, thread authors. Weight, not size, separates this from body.
- **Body** (400, 14px, 1.5): Prose. Comment bodies, hint text, the options walkthrough. Also the `:root` default that everything inherits from.
- **Label** (500, 12px, 1.4): The workhorse, at 43 declarations. Badges, chips, counts, metadata rows, tab labels. Most of the interface is this size.
- **Micro** (400-600, 11px): Line numbers, keyboard shortcut hints, dense counters. The floor. Nothing in this product is smaller than 11px.
- **Mono** (400, 12px): Code, paths, tokens, rate-limit figures, anything the reviewer might compare character by character.

### Named Rules

**The Weight-First Rule.** Hierarchy is established by weight (400 to 600) and by
colour (Foreground Default to Foreground Muted) before it is established by size.
The whole scale spans 11px to 22px; there is no room to shout, so do not try.

**The No Web Font Rule.** Prohibited without exception. The system stack is not a
fallback here, it is the choice.

**The No Eyebrow Rule.** No small uppercase tracked labels above sections. This
is a tool, not a landing page, and at 11px an uppercase tracked label is both
unreadable and a genre signal from a genre this product rejects. All-caps is
permitted only inside a status value that GitHub itself sends in caps.

## 4. Elevation

**Flat by default. A shadow means the element genuinely floats above the page,
and it is the only thing a shadow is allowed to mean.**

Separation between resting surfaces is a 1px Primer Border Default line, or a
step to Canvas Subtle, never a shadow. The review page contains exactly three
drop shadows and all three are on overlays; its other `box-shadow` declarations
are rings and insets that draw on the box rather than beneath it. Depth in dark mode is carried
by tone rather than shade, which is why Canvas Overlay is lighter than the page
rather than darker: a dark surface with a dark shadow reads as a hole.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 8px 24px light-dark(rgba(31, 35, 40, 0.16), rgba(1, 4, 9, 0.6))`): Menus and popovers. The default float.
- **Overlay, large** (`box-shadow: 0 12px 32px light-dark(rgb(140 149 159 / 25%), rgb(1 4 9 / 65%))`): The notice panel, which is bigger and sits further from the surface.
- **Overlay, modal** (`box-shadow: 0 8px 24px light-dark(rgb(140 149 159 / 20%), rgb(1 4 9 / 60%))`): The shared `.overlay` shell behind the search panel, the shortcut help and the commit picker. Same geometry as the default, a third alpha pair.
- **Injected card** (`box-shadow: 0 10px 28px light-dark(rgba(31, 35, 40, 0.14), rgba(1, 4, 9, 0.62)), 0 4px 18px -8px light-dark(rgba(31, 136, 61, 0.4), rgba(63, 185, 80, 0.36))`): The heaviest shadow in the product, and the only tinted one. It is licensed because the card floats over a page this system does not control and has to separate from arbitrary content beneath it. The green pass sits *under* the neutral shadow rather than replacing it: enough to tint the page beneath, not enough to be a glow.
- **Focus ring** (`outline: 2px solid light-dark(#0969da, #4493f8); outline-offset: 1px`): Not elevation, but the only other thing permitted to draw outside an element's box. Inside scrolling containers it becomes `outline-offset: -2px` so it is not clipped.
- **Selection ring** (`box-shadow: 0 0 0 2px <colour>`): A 2px ring in Border Default, Danger Foreground or Success Emphasis, used where an outline would be clipped.

### Named Rules

**The Shadow Means Float Rule.** If the element is in normal flow, it gets a
border. If it is in a portal, a popover, or someone else's page, it may have a
shadow. There is no third case, and there is no decorative shadow.

## 5. Components

**Character: "Borrowed, then sharpened."** Every control is recognisably a GitHub
control. It just responds faster and wastes less space. A new component passes if
a reviewer would not look at it twice, and fails if it introduces a shape, a
radius or a colour the rest of GitHub does not have.

### Buttons

- **Shape:** Gently rounded (`6px`), the system default. 28px tall at `padding: 4px 12px`, `font-size: 13px`, `line-height: 20px`.
- **Secondary (default):** Canvas Subtle fill, 1px Border Default outline, inherited text colour. This is the common case; most buttons in the product are this.
- **Primary:** Success Emphasis fill (`#1f883d` / `#238636`), white text, matching border. At most one per view. Hover moves to `#1a7f37` / `#29903b`.
- **Hover:** Fill only, to Neutral Hover, over `background-color 0.12s ease`. Nothing moves and nothing scales. Guard it with `:not(:disabled)`: Blink still applies `:hover` to a disabled control, and a dead button that lights up under the cursor reads as one that should work.
- **Disabled:** Real disabled colours, never a blanket `opacity`. Both variants drop to the same neutral treatment (Foreground Subtle text, Border Default outline, Canvas Subtle fill); the primary loses its green entirely. Compositing the primary at reduced opacity instead would land its white label at 2.0:1 against its own fill, and that is the state a pull request author sees on Approve and Request changes every time, so it is the one place the page most needs to be legible about why a control is off. What it currently reaches is **2.85:1 light and 3.24:1 dark**: better than the alternative and formally exempt, since WCAG excludes inactive components from 1.4.3, but not yet legible in the sense the code comment is arguing for. Treat it as the ceiling to raise, not a solved problem.

### Chips and badges

- **Shape:** Full pill (`999px`), `padding: 1px 10px`, 12px/500.
- **Badge:** Solid fill, white text. Pull request state only: open (Success Emphasis), draft (Foreground Muted), merged (Done Emphasis), closed (Danger Foreground).
- **Chip:** Transparent fill, 1px Border Default outline, coloured *text*. Status checks: good (Success Foreground), bad (Danger Foreground), pending (Attention Foreground), neutral (Foreground Muted).
- **State:** The chip always carries a written label ("Checks passed", "Checks failed", "Checks running"). The colour reinforces the word; it never replaces it.
- Badge and chip share one box on purpose: the badge carries a transparent 1px border it does not paint, so the two sit on the same baseline in the same bar.

### Cards and containers

Cards are used sparingly and never nested. Grouping is done with a 1px Border
Default rule, a step to Canvas Subtle, or whitespace, in that order of
preference. Where a container is genuinely a card it takes `8px` corners, a 1px
Border Default outline, Canvas Default or Canvas Subtle fill, no shadow, and
12px-16px internal padding.

### Inputs

- **Style:** 1px Border Default outline, `6px` corners, `font: inherit` unless the content is code, in which case mono at 13px.
- **Focus:** The global 2px Accent Foreground outline at `1px` offset. No glow, no border colour change, no size change.
- **Borderless variant:** Where an input is the first child of a panel it drops its outline entirely and keeps a single `border-bottom`, matching the panel's own `8px 8px 0 0` corners so the focus rectangle does not lose its top two corners.
- **Error:** Danger Foreground text on the result line, in mono. The field itself is not recoloured.

### Navigation

There is no site navigation. The review page has a 52px top bar (`--topbar-height`,
a layout constant the sticky rail below it has to know and CSS cannot ask for) and
a resizable file tree. Tabs are text plus a count, separated by weight and by the
Accent Foreground underline on the active one. Rows in the tree hover to Neutral
Hover with a 20px hit target around a 13px box: the box is what the reviewer sees,
the target is what they hit.

### The injected card (signature component)

The one place in the product with expressive treatment, and the reasoning belongs
in the document because the licence is narrow. It lives in a shadow root on
someone else's page, so it has to read as *not part of GitHub* while sitting
inside GitHub, which is the opposite of every other surface here.

- **Shape:** `14px` corners, `248px` minimum width, `14px` padding, `12px` internal gap.
- **Edge:** A gradient border, lit green-to-blue at the top-left and Border Default the rest of the way round. Two backgrounds and a transparent border: surface clipped to the padding box, edge to the border box. It is lit from one corner rather than coloured all the way round, because a fully coloured border reads as a status, and status means something specific three inches away in the diff this card opens.
- **Bloom:** A radial gradient in from the corners rather than a wash over the surface, so the card is still white in light mode and still near-black in dark. Lit, not tinted.
- **CTA:** Full pill, `9px 18px`, 600 weight, white on a top-to-bottom green gradient (Success Emphasis to `#1a7f37` / `#187433`) with a 1px inset white highlight. Its gradient runs vertically while the card's runs from a corner, so the two do not fight. Hover lifts 1px and deepens its shadow; active returns to 0 and dims, because a button that only ever rises has no bottom to it. **The top stop is not free.** The label is white at 14px/600, which is not large text, so it answers to 4.5:1 across the whole band and not just at the bottom. This started at `#2ea043`, which is 3.37:1 against white; Success Emphasis measures 4.52:1 light and 4.63:1 dark at the top edge. The hover used to add `filter: brightness(1.07)` and that is gone for the same reason: it took the top of the band to 4.02:1, so the button was least readable exactly while being read.
- **Collapse:** The pill and the card are one material at two sizes, so collapsing reads as the same object folding up rather than a swap for a second component.
- **Theme:** Follows `data-color-mode` on GitHub's `<html>`, not the OS, because a reviewer who has pinned GitHub to dark should not get a light card on it. A chosen theme outranks both: the card wears the reviewer's palette even here, on someone else's page. That is a deliberate narrowing of the seamlessness argument — the card is already licensed to read as not-part-of-GitHub, and a reviewer who has themed the product has said which seam they care about. It is applied at mount rather than a frame later, which is why the content script reads settings before its first sync: a card that paints in Primer and turns Dracula on the next frame is a flash in the corner of a page somebody is already reading. The mark keeps its own colours throughout; it is a logo.

### Motion

Motion is a component property here, not a system, which is why it lives in this
section. On the review page it is `background-color 0.12s ease` almost
everywhere: colour only, which reduced motion has no quarrel with. The
transition exists at all because the file tree animates its own rows, and
without a matching rule a tree row would fade while the entry directly below it
snapped.

The one exception is the tree's disclosure chevron, which transitions `rotate`.
That is transform-family and it does move, so it carries a
`prefers-reduced-motion: reduce` block that drops the transition and leaves the
end state. It is the only such block on the review page because it is the only
thing on the review page that moves.

The injected card is the exception and carries the product's only real
animations: `rise` (420ms, `cubic-bezier(0.16, 1, 0.3, 1)`), `sweep` (680-820ms,
`cubic-bezier(0.33, 0, 0.15, 1)`) and `draw` (440ms, `cubic-bezier(0.22, 1, 0.36, 1)`),
plus a 150ms transform on the CTA. All easing is exponential ease-out. All of it
is suppressed under `@media (prefers-reduced-motion: reduce)`.

## 6. Do's and Don'ts

### Do:

- **Do** write every colour as a `light-dark()` pair from the token list in section 2. Both halves, always. A single-value colour is a bug in one of the two themes.
- **Do** name the Primer role the value came from when adding a token, so the next reader knows it is matched rather than chosen.
- **Do** add a new token to `lib/theme/tokens.ts` in the same change that adds it to `ui/tokens.css`, and re-run `npm run palettes`. A token that exists in only one of the two is a control that stays Primer while the page around it turns. `ui/tokens.test.tsx` will tell you, but it is cheaper to remember.
- **Do** pair a coloured fill with its own `--on-*` label rather than a white. White is right for every fill in the default and wrong for some theme's green.
- **Do** override Pierre's colours through the fallback slot (`--diffs-light-bg`) or by targeting the host element from the outer tree. Setting `--diffs-bg` does nothing: `:host` declares it and wins.
- **Do** separate surfaces with a 1px Primer Border Default line or a step to Canvas Subtle. Reach for a shadow only when the element genuinely floats.
- **Do** carry status in a word first. "Checks failed" with red text, never red text alone. The most common colour vision deficiency makes red and green the two worst colours to encode a diff's primary signal in.
- **Do** keep the type between 11px and 22px and get hierarchy from weight and from Foreground Muted.
- **Do** give every animation a `prefers-reduced-motion: reduce` alternative, and prefer colour-only transitions that need none.
- **Do** use real disabled colours. `opacity` on the primary button drops its label to 2.0:1.
- **Do** keep the focus ring. 2px Accent Foreground at `1px` offset, or `-2px` inside a scrolling container so it is not clipped.
- **Do** label buttons verb-plus-object: "Submit review", "Resolve conversation", "Save token".

### Don't:

- **Don't** introduce a colour GitHub Primer does not have *into the default palette*. See The Matched Value Rule. What a reviewer's chosen theme puts on the page is not this rule's business.
- **Don't** "fix" a theme's colours in the derivation. Two repairs are licensed and named in Themed Palettes; a third needs the same standard — that the stated value is a missing colour rather than an ugly one. Darkening somebody's green so a white label fits is exactly the move the six `--on-*` tokens exist to avoid.
- **Don't** add a second blue. Accent Foreground means interaction and nothing else means interaction.
- **Don't** load a web font. The system stack is the choice, not the fallback.
- **Don't** use a coloured side stripe above 1px, by any technique. The options page warning panel and the review page's `.notice` both carried a 4px `border-left-width` and both now use their whole 1px border. One remains: the scope bar's lost/failed state draws `box-shadow: inset 4px 0 0`, which avoids the 4px layout shift a real border would cause when something goes wrong mid-row. It is a known exception, not a precedent. Use a full 1px border, a background tint, or a leading icon.
- **Don't** add a fifth amber. There are four named roles in section 2 and one has already been retired into another; pick one of the four, or give the new one a role name and a reason.
- **Don't** write a literal colour outside `ui/tokens.css`, at all. This is no longer a matter of avoiding duplicates — a literal cannot follow the reviewer's theme, so it is a patch of Primer left on a themed page. See The Named Colour Rule, which is enforced by a test.
- **Don't** build the visual language of a tool that is being sold: no gradient hero, no metric tiles, no purple-to-blue accent, no illustrated empty states, no product tour. PRODUCT.md names "a SaaS-looking developer tool" as an anti-reference.
- **Don't** write chatty or cute copy. No emoji in interface text, no exclamation marks, no "Oops! Something went wrong." Say what failed and what to do.
- **Don't** nest cards, and don't reach for a card grid where a list of rows would do. This interface is rows.
- **Don't** put a small uppercase tracked eyebrow above a section.
- **Don't** apply a decorative shadow, a glass blur, or a gradient anywhere except the injected card, whose exceptions are enumerated in section 5 and are not precedents.
- **Don't** animate layout properties. Colour, transform and opacity only, and on the review page really just colour.
- **Don't** let the injected card grow. It is 248px of someone else's page and every addition to it is taken from a site the user came to read.
