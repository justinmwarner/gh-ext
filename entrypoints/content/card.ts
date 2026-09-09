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
 * Identifies the host element on the page.
 *
 * The only part of this component visible from outside the shadow root, which
 * is the point: it is how `sync` asks "is the card already up" and how the end
 * to end suite finds it.
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

  for (const [x, y, width, fill] of MARK_BARS) {
    const bar = doc.createElementNS(NS, 'rect');
    bar.setAttribute('x', String(x));
    bar.setAttribute('y', String(y));
    bar.setAttribute('width', String(width));
    bar.setAttribute('height', '14');
    bar.setAttribute('rx', '7');
    bar.setAttribute('fill', fill);
    svg.append(bar);
  }
  return svg;
}

/**
 * Primer's palette, hard-coded.
 *
 * Reading GitHub's CSS custom properties would track their themes exactly, but
 * those properties are defined on `:root` in the page and do not cross into a
 * shadow root, so every one would have to be read and copied on every theme
 * change. These six values have been stable across Primer's light and dark
 * defaults for years, and being one shade off is a far smaller problem than a
 * card that inherits nothing and renders as unstyled HTML.
 */
const STYLES = `
  :host {
    all: initial;
  }
  * {
    box-sizing: border-box;
  }
  .layer {
    font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
      Helvetica, Arial, sans-serif;
    color: light-dark(#1f2328, #e6edf3);
  }
  [hidden] {
    display: none !important;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 232px;
    padding: 14px;
    border: 1px solid light-dark(#d1d9e0, #3d444d);
    border-radius: 12px;
    background: light-dark(#ffffff, #151b23);
    box-shadow: 0 8px 24px light-dark(rgba(31, 35, 40, 0.16), rgba(1, 4, 9, 0.6));
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
    box-shadow: 0 0 0 1px light-dark(transparent, rgba(240, 246, 252, 0.14));
  }
  /* Sentence case, and quieter than the button. This is a label saying whose
     card this is, not the thing the reviewer came for. It used to be uppercase
     and letter-spaced, which made the least important element the loudest. */
  .name {
    font-size: 13px;
    font-weight: 500;
    color: light-dark(#59636e, #9198a1);
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
    outline: 2px solid light-dark(#0969da, #4493f8);
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
    background: transparent;
    color: light-dark(#59636e, #9198a1);
  }
  .collapse:hover {
    background: light-dark(#eff2f5, #262c36);
    color: light-dark(#1f2328, #e6edf3);
  }
  .cta {
    padding: 9px 16px;
    font-weight: 600;
    transition: background 120ms ease-out;
    color: #ffffff;
    background: light-dark(#1f883d, #238636);
    border-color: light-dark(rgba(31, 35, 40, 0.15), rgba(240, 246, 252, 0.1));
  }
  .cta:hover {
    background: light-dark(#1a7f37, #29903b);
  }
  .status {
    margin: 0;
    font-size: 12px;
    color: light-dark(#cf222e, #f85149);
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px 7px 8px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 999px;
    transition: color 120ms ease-out, box-shadow 120ms ease-out;
    border-color: light-dark(#d1d9e0, #3d444d);
    background: light-dark(#ffffff, #151b23);
    color: light-dark(#59636e, #9198a1);
    box-shadow: 0 4px 12px light-dark(rgba(31, 35, 40, 0.12), rgba(1, 4, 9, 0.5));
  }
  .pill:hover {
    color: light-dark(#1f2328, #e6edf3);
  }
  /* Entrance. The default state is the visible one and the animation only
     plays from hidden to it, so a browser that never runs it — a headless
     render, an extension that blocks animation — still shows the card. */
  .card,
  .pill {
    animation: rise 260ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card,
    .pill {
      animation: none;
    }
    .cta,
    .collapse,
    .pill {
      transition: none;
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
  cta.textContent = CTA;

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

  collapse.addEventListener('click', () => {
    setCollapsed(true);
    options.onCollapsedChange(true);
  });

  pill.addEventListener('click', () => {
    setCollapsed(false);
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
