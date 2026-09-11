/**
 * The card that offers a review, and everything it knows about looking right.
 *
 * Plain DOM in a shadow root. Plain because a title, a button and a pill do not
 * justify pulling React into a script that runs on every github.com page; in a
 * shadow root because this thing lives inside someone else's stylesheet, and
 * `.btn` on github.com is not ours to inherit from or to redefine.
 *
 * It touches no `browser.*` API and knows nothing about pull requests. It is
 * handed callbacks and told what to display, which is what lets the whole of it
 * be tested in jsdom.
 */

/**
 * The same palette the review page and the options page use, as text.
 *
 * `?raw` rather than a normal import because this stylesheet is not going into
 * the document — it goes into a shadow root on somebody else's page, as the
 * text content of a <style> element. The file declares `:root, :host` for
 * exactly this: `:root` matches on the two extension pages, `:host` matches
 * here, and neither selector does any harm in the other place.
 */
import TOKENS from '@/ui/tokens.css?raw';

/**
 * Identifies the host element on the page.
 *
 * The only part of this component visible from outside the shadow root, which
 * is the point: it is how a fresh mount clears a stale host of its own, and how
 * the end to end suite finds the card.
 *
 * Not how `sync` decides whether to mount. That asks the handle it is holding
 * whether its host is still connected, which is a different and stricter
 * question than whether *something* on the page carries this id.
 */
export const CARD_HOST_ID = 'a-better-reviewer-card';

export interface CardOptions {
  /** Whether to come up collapsed. Read from storage before the first mount. */
  collapsed: boolean;
  /** The reviewer pressed the button. */
  onOpen(): void;
  /** The reviewer collapsed or expanded the card, and it should be remembered. */
  onCollapsedChange(collapsed: boolean): void;
}

export interface CardHandle {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  setCollapsed(collapsed: boolean): void;
  /** Show a short failure under the button, or clear it with null. */
  setStatus(text: string | null): void;
  /** Follow GitHub's theme after the reviewer changes it mid-session. */
  setColorScheme(scheme: string): void;
  destroy(): void;
}

const NAME = 'A Better Reviewer';
const CTA = 'Start a Better Review';

/**
 * The extension's icon, inline.
 *
 * The same geometry as `store/icon.svg` and therefore the same thing the
 * reviewer sees in their toolbar and on the store listing. Drawn rather than
 * loaded from `web_accessible_resources`, because making an extension file
 * fetchable by the page would let github.com probe for it and fingerprint the
 * install — the same reason the review page is not web-accessible.
 *
 * Colours are fixed rather than themed. It is a logo: it does not change
 * because the page did, any more than the toolbar icon does.
 */
/** The bars, as [x, y, width, fill] in the icon's 128-unit grid. */
const MARK_BARS: [number, number, number, string][] = [
  [24, 34, 80, '#3fb950'],
  [24, 58, 52, '#f85149'],
  [24, 82, 66, '#8b949e'],
];

/**
 * The extension's icon, drawn as DOM.
 *
 * The same geometry as `store/icon.svg`, so the card carries the mark the
 * reviewer already knows from their toolbar and the store listing.
 *
 * Drawn rather than loaded from a file, because making an extension resource
 * fetchable by the page would let github.com probe for it and fingerprint the
 * install — the same reason the review page is not web-accessible. Built node
 * by node rather than assigned as `innerHTML`, because a review linter flags
 * every `innerHTML` and this one would buy nothing.
 *
 * The colours do not follow the page theme. It is a logo: it no more changes
 * with GitHub's theme than the toolbar icon does.
 */
function createMark(doc: Document): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'mark');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const tile = doc.createElementNS(NS, 'rect');
  tile.setAttribute('width', '128');
  tile.setAttribute('height', '128');
  tile.setAttribute('rx', '28');
  tile.setAttribute('fill', '#0d1117');
  svg.append(tile);

  MARK_BARS.forEach(([x, y, width, fill], index) => {
    const bar = doc.createElementNS(NS, 'rect');
    // Numbered so the stylesheet can stagger them. The bars are an added line,
    // a removed line and an unchanged one, and drawing them in that order is
    // the mark writing itself as a diff — which is the one place this card can
    // say what it does without adding a word of copy.
    bar.setAttribute('class', `bar bar-${index + 1}`);
    bar.setAttribute('x', String(x));
    bar.setAttribute('y', String(y));
    bar.setAttribute('width', String(width));
    bar.setAttribute('height', '14');
    bar.setAttribute('rx', '7');
    bar.setAttribute('fill', fill);
    svg.append(bar);
  });
  return svg;
}

/**
 * The arrow on the button.
 *
 * Drawn rather than typed, so `.cta` still reports its label and nothing else:
 * a `→` character would land in `textContent` and turn every assertion about
 * what the button says into an assertion about how it is decorated.
 *
 * It is doing work, not ornament. This button does not submit anything or open
 * a menu — it hands the reviewer to another tab — and an arrow is the shortest
 * way to say that before it is pressed.
 */
function createArrow(doc: Document): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'arrow');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = doc.createElementNS(NS, 'path');
  path.setAttribute('d', 'M2.5 8h10M8.5 4l4 4-4 4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/**
 * The card's own chrome. The palette it draws from is `TOKENS`, above.
 *
 * Reading GitHub's own CSS custom properties would track their themes exactly,
 * and it would work: custom properties inherit through a shadow boundary, so
 * `--color-canvas-default` from their `:root` is legible in here, and the
 * `all: initial` below does not clear it (`all` is defined to reset every
 * property except custom ones). It is not done because those names are
 * GitHub's private interface. They are unversioned and can be renamed in any
 * deploy, and the failure mode is a card that resolves nothing and renders as
 * unstyled HTML on every pull request page until someone notices. Primer's
 * *values* have been stable across its light and dark defaults for years;
 * Primer's variable names have not. Being one shade off is the far smaller
 * problem, and it is the one this takes.
 *
 * What is *not* Primer is the lit edge, the bloom and the sweep. github.com is
 * a page of grey rectangles by design, and a grey rectangle in the corner of it
 * reads as one more piece of GitHub's chrome — or, worse, as the cookie banner
 * it is shaped like. These say the card came from somewhere else, which is the
 * one thing it has to communicate before anybody reads a word of it.
 *
 * Every animation here plays once, on arrival, and then the card is still. A
 * loop in the corner of a page somebody is trying to read is not delight, it is
 * a thing to be closed.
 */
const STYLES = `
  ${TOKENS}

  :host {
    all: initial;
  }
  * {
    box-sizing: border-box;
  }
  .layer {
    font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
      Helvetica, Arial, sans-serif;
    color: var(--fg-default);
  }
  [hidden] {
    display: none !important;
  }

  /* The card and the pill are one material at two sizes, so collapsing reads as
     the same object folding up rather than as a swap for a second component.

     The edge is a gradient, which needs two backgrounds and a transparent
     border: the surface clipped to the padding box, the edge to the border box,
     showing through the border the first one does not paint. */
  .card,
  .pill {
    position: relative;
    border: 1px solid transparent;
    background:
      linear-gradient(
          160deg,
          light-dark(#ffffff, #1b222c),
          light-dark(#f3f6fa, #10161e)
        )
        padding-box,
      /* Lit at the top-left and neutral the rest of the way round. A border
         coloured all the way round reads as a status — green means something
         specific three inches away, in the diff this card opens. */
        linear-gradient(
          140deg,
          light-dark(rgba(31, 136, 61, 0.7), rgba(63, 185, 80, 0.8)),
          light-dark(rgba(9, 105, 218, 0.45), rgba(68, 147, 248, 0.5)) 26%,
          var(--border-default) 56%,
          var(--border-default)
        )
        border-box;
    box-shadow:
      0 10px 28px light-dark(rgba(31, 35, 40, 0.14), rgba(1, 4, 9, 0.62)),
      /* The brand's green, under the neutral shadow rather than instead of it:
         enough to tint the page beneath the card, not enough to be a glow. */
      0 4px 18px -8px light-dark(rgba(31, 136, 61, 0.4), rgba(63, 185, 80, 0.36));
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 248px;
    padding: 14px;
    border-radius: 14px;
    /* For the two decorative layers below, which are sized to the whole card
       and would otherwise square off its corners. */
    overflow: hidden;
  }

  /* Colour bloomed in from the corners rather than laid over the whole surface,
     so the card is still white in light mode and still near-black in dark —
     it is lit, not tinted. */
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(
        120% 100% at 4% -12%,
        light-dark(rgba(31, 136, 61, 0.13), rgba(63, 185, 80, 0.17)),
        transparent 62%
      ),
      radial-gradient(
        90% 80% at 104% 112%,
        light-dark(rgba(9, 105, 218, 0.09), rgba(68, 147, 248, 0.13)),
        transparent 58%
      );
  }

  /* One pass of light across the card as it arrives. It rests off the left edge
     and returns there, so a browser that never runs the animation shows nothing
     at all rather than a band parked across the button.

     Three stops rather than one, and the middle one is the reason: a white core
     is the only thing that shows on the green button, and it is invisible on a
     white card — so the flanks are tinted, which is the reverse. In dark mode
     one pale band does both. */
  .card::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    transform: translateX(-140%);
    background: linear-gradient(
      104deg,
      transparent 34%,
      light-dark(rgba(31, 136, 61, 0.18), rgba(63, 185, 80, 0.14)) 44%,
      light-dark(rgba(255, 255, 255, 0.92), rgba(224, 238, 255, 0.24)) 50%,
      light-dark(rgba(9, 105, 218, 0.14), rgba(68, 147, 248, 0.14)) 56%,
      transparent 66%
    );
    animation: sweep 820ms 200ms cubic-bezier(0.33, 0, 0.15, 1);
  }

  /* Above the bloom. Without this the two radial layers paint over the header
     and the button, which are not positioned and so lose to anything that is. */
  .head,
  .cta,
  .status {
    position: relative;
    z-index: 1;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  /* The icon, at the size it stays legible. Its own rounding is part of the
     artwork, so it is not clipped or re-rounded here. */
  .mark {
    display: block;
    width: 22px;
    height: 22px;
    flex: none;
    /* 28/128 of the artwork's own corner radius, at 22px. Matched so the ring
       below sits on the tile's edge rather than outside it. */
    border-radius: 5px;
    /* The tile is near-black, and so is the card in dark mode: without this
       the tile vanishes and the mark reads as three bars floating in space.
       A hairline boundary rather than a lighter tile, so the logo itself is
       the same artwork on both themes. */
    box-shadow: 0 0 0 1px light-dark(transparent, rgba(230, 237, 243, 0.14));
  }
  /* The mark drawing itself: added, removed, unchanged, in that order and from
     the left, which is how the diff underneath renders too. The backwards fill
     holds each bar at zero through its delay; without it all three are full
     width for the first 120ms and then jump. */
  .bar {
    transform-box: fill-box;
    transform-origin: left center;
    animation: draw 440ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }
  .bar-1 {
    animation-delay: 120ms;
  }
  .bar-2 {
    animation-delay: 200ms;
  }
  .bar-3 {
    animation-delay: 280ms;
  }
  /* Sentence case, and quieter than the button. This is a label saying whose
     card this is, not the thing the reviewer came for. It used to be uppercase
     and letter-spaced, which made the least important element the loudest. */
  .name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-muted);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 6px;
    border: 1px solid transparent;
  }
  button:focus-visible {
    outline: 2px solid var(--accent-fg);
    outline-offset: 2px;
  }
  .collapse {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-muted);
    transition: background 140ms ease-out, color 140ms ease-out;
  }
  .collapse:hover {
    background: light-dark(rgba(31, 35, 40, 0.07), rgba(230, 237, 243, 0.1));
    color: var(--fg-default);
  }
  /* A pill, matching the collapsed state: the same shape growing and shrinking
     is what makes the two reads as one thing. Its own gradient runs top to
     bottom, so the button is lit from above while the card is lit from the
     corner, and the two do not fight. */
  .cta {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 18px;
    font-weight: 600;
    border-radius: 999px;
    color: #ffffff;
    /* The top stop is the success-emphasis token, not a lighter green, because
       the label is white at 14px/600 — not large text, so it answers to 4.5:1,
       and it sits across the whole band rather than at the bottom of it. The
       previous #2ea043 measured 3.37:1 against white; this measures 4.52:1
       light and 4.63:1 dark at the top edge, 5.08:1 and 5.86:1 at the bottom. */
    background: linear-gradient(180deg, var(--success-emphasis), light-dark(#1a7f37, #187433));
    border-color: light-dark(rgba(31, 35, 40, 0.16), rgba(230, 237, 243, 0.12));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      0 4px 12px -5px light-dark(rgba(31, 136, 61, 0.55), rgba(63, 185, 80, 0.4));
    transition:
      transform 150ms cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 150ms ease-out,
      filter 150ms ease-out;
  }
  /* No brightness() here. Lightening the fill is the one hover effect that
     costs the label contrast, and it costs enough to matter: 1.07 drops the top
     of the band to 4.02:1, and even 1.04 lands at 4.22:1. The button would be
     at its least readable exactly while being read. The lift, the deeper
     shadow and the brighter inset highlight below already say "hover" without
     touching the fill. The active state still darkens, which only helps. */
  .cta:hover {
    transform: translateY(-1px);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.28),
      0 8px 16px -6px light-dark(rgba(31, 136, 61, 0.6), rgba(63, 185, 80, 0.5));
  }
  /* Back down under the finger, and dimmer. A button that only ever rises has
     no bottom to it. */
  .cta:active {
    transform: translateY(0);
    filter: brightness(0.96);
  }
  /* Leans towards where it is about to send you. Small: the arrow is a hint
     about the destination, not an animation to watch. */
  .arrow {
    display: block;
    width: 15px;
    height: 15px;
    flex: none;
    opacity: 0.85;
    transition:
      transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 180ms ease-out;
  }
  .cta:hover .arrow {
    transform: translateX(3px);
    opacity: 1;
  }
  /* The same pass of light as the card's, on hover, so the gesture the card
     made on arrival is the one the button repeats when it is pointed at. */
  .cta::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    transform: translateX(-140%);
    background: linear-gradient(
      104deg,
      transparent 38%,
      rgba(255, 255, 255, 0.34) 50%,
      transparent 62%
    );
  }
  .cta:hover::after {
    animation: sweep 680ms cubic-bezier(0.33, 0, 0.15, 1);
  }
  .status {
    margin: 0;
    font-size: 12px;
    color: var(--danger-fg);
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px 7px 8px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 999px;
    color: var(--fg-muted);
    transition:
      transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
      color 140ms ease-out,
      box-shadow 160ms ease-out;
  }
  .pill:hover {
    transform: translateY(-1px);
    color: var(--fg-default);
    box-shadow:
      0 14px 30px light-dark(rgba(31, 35, 40, 0.16), rgba(1, 4, 9, 0.66)),
      0 6px 20px -8px light-dark(rgba(31, 136, 61, 0.5), rgba(63, 185, 80, 0.45));
  }
  /* Entrance. The default state is the visible one and the animation only
     plays from hidden to it, so a browser that never runs it — a headless
     render, an extension that blocks animation — still shows the card.
     It replays when the pill is expanded, which is the point: opening the card
     is the same arrival as the first one, and should look like it. */
  .card,
  .pill {
    animation: rise 420ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.96);
    }
  }
  @keyframes sweep {
    to {
      transform: translateX(140%);
    }
  }
  @keyframes draw {
    from {
      transform: scaleX(0);
      opacity: 0;
    }
  }
  /* Everything above is decoration on top of a card that is already legible, so
     switching it off leaves a complete card rather than a broken one. The
     gradients stay: they are not motion. */
  @media (prefers-reduced-motion: reduce) {
    .card,
    .pill,
    .bar,
    .card::after,
    .cta:hover::after {
      animation: none;
    }
    .cta,
    .collapse,
    .pill,
    .arrow {
      transition: none;
    }
    .cta:hover,
    .pill:hover {
      transform: none;
    }
    .cta:hover .arrow {
      transform: none;
    }
  }
`;

/**
 * The colour scheme the card should render in.
 *
 * GitHub puts `data-color-mode` on `<html>`, and a reviewer who has pinned
 * GitHub to dark while their OS is light expects the card to match the page it
 * is sitting on rather than the desktop. `auto`, an unrecognized value and a
 * missing attribute all fall back to following the OS, so this cannot break —
 * the worst case is the behaviour we would have had without reading it.
 */
export function githubColorScheme(doc: Document): string {
  const mode = doc.documentElement.dataset.colorMode;
  if (mode === 'light' || mode === 'dark') return mode;
  return 'light dark';
}

/**
 * Build the card and attach it to the document.
 *
 * The host is appended to `<body>` rather than inserted anywhere meaningful, so
 * it comes last in the tab order. That is the right place for it: this is an
 * offer, not a step in the page's own flow, and it should not sit between the
 * pull request title and its description for anyone navigating by keyboard.
 */
export function mountCard(doc: Document, options: CardOptions): CardHandle {
  const host = doc.createElement('div');
  host.id = CARD_HOST_ID;
  // Inline rather than in the sheet below: these position the host itself,
  // which lives in the page's tree where that stylesheet does not reach.
  host.style.position = 'fixed';
  host.style.insetBlockEnd = '16px';
  host.style.insetInlineEnd = '16px';
  // Above GitHub's own dialogs and sticky headers. This is the ceiling, and the
  // card is the only thing this extension puts on the page.
  host.style.zIndex = '2147483647';
  host.style.colorScheme = githubColorScheme(doc);

  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = STYLES;
  root.append(style);

  const layer = doc.createElement('div');
  layer.className = 'layer';

  const card = doc.createElement('div');
  card.className = 'card';

  const head = doc.createElement('div');
  head.className = 'head';

  const brand = doc.createElement('div');
  brand.className = 'brand';
  const name = doc.createElement('span');
  name.className = 'name';
  name.textContent = NAME;
  brand.append(createMark(doc), name);

  const collapse = doc.createElement('button');
  collapse.className = 'collapse';
  collapse.type = 'button';
  collapse.textContent = '×';
  collapse.setAttribute('aria-label', `Collapse ${NAME}`);

  const cta = doc.createElement('button');
  cta.className = 'cta';
  cta.type = 'button';
  cta.append(doc.createTextNode(CTA), createArrow(doc));

  const status = doc.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.hidden = true;

  const pill = doc.createElement('button');
  pill.className = 'pill';
  pill.type = 'button';
  pill.setAttribute('aria-label', `Expand ${NAME}`);
  const pillText = doc.createElement('span');
  pillText.textContent = NAME;
  pill.append(createMark(doc), pillText);

  head.append(brand, collapse);
  card.append(head, cta, status);
  layer.append(card, pill);
  root.append(layer);

  let collapsed = options.collapsed;

  function render(): void {
    card.hidden = collapsed;
    pill.hidden = !collapsed;
  }

  function setCollapsed(next: boolean): void {
    if (next === collapsed) return;
    collapsed = next;
    render();
  }

  /* Focus moves to whatever replaced the thing that was just pressed.
     Collapsing hides the button the keyboard is standing on, and a hidden
     element cannot hold focus — without these two lines it falls to <body>,
     which throws a screen reader's cursor to the top of github.com and loses
     Shift+Tab's place. Expanding is the worse half: the reviewer expands in
     order to press the button, so landing them on it is the whole point.

     In the click handlers rather than in `setCollapsed`, deliberately.
     `setCollapsed` is also how a collapse in one tab reaches every other one,
     and a background tab must not pull focus. The ring is `:focus-visible`, so
     a mouse press moves focus without drawing anything. */
  collapse.addEventListener('click', () => {
    setCollapsed(true);
    pill.focus();
    options.onCollapsedChange(true);
  });

  pill.addEventListener('click', () => {
    setCollapsed(false);
    cta.focus();
    options.onCollapsedChange(false);
  });

  cta.addEventListener('click', () => {
    // Cleared on every attempt, so a failure from one click does not sit under
    // the button contradicting the next one.
    setStatus(null);
    options.onOpen();
  });

  function setStatus(text: string | null): void {
    status.textContent = text ?? '';
    status.hidden = text === null;
  }

  render();
  // Anything already wearing our id goes first, so mounting twice cannot leave
  // two of these on the page and cannot leave `CARD_HOST_ID` resolving to the
  // wrong one. Costs a lookup once per mount.
  doc.getElementById(CARD_HOST_ID)?.remove();
  doc.body.append(host);

  return {
    host,
    root,
    setCollapsed,
    setStatus,
    setColorScheme: (scheme: string) => {
      host.style.colorScheme = scheme;
    },
    destroy: () => host.remove(),
  };
}
