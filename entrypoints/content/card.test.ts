/**
 * The card, as a piece of DOM.
 *
 * What is worth pinning here is everything the reviewer can reach: the button
 * reports the click, collapsing reports the change so it can be stored, the
 * pill brings the card back, and none of it leaks into the page it is sitting
 * on. The shadow boundary in particular — a card that renders as unstyled HTML
 * inside github.com is worse than no card.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_HOST_ID, type CardHandle, githubColorScheme, mountCard } from './card';

let mounted: CardHandle | null = null;

const open = (collapsed = false) => {
  const onOpen = vi.fn();
  const onCollapsedChange = vi.fn();
  mounted = mountCard(document, { collapsed, onOpen, onCollapsedChange });
  return { card: mounted, onOpen, onCollapsedChange };
};

/** Everything the card owns lives under the shadow root, so this reaches it. */
const find = <T extends HTMLElement = HTMLElement>(
  card: CardHandle,
  selector: string,
): T => {
  const element = card.root.querySelector<T>(selector);
  if (!element) throw new Error(`no ${selector} in the card`);
  return element;
};

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.documentElement.removeAttribute('data-color-mode');
});

describe('mounting', () => {
  it('attaches one identifiable host to the body', () => {
    const { card } = open();
    expect(document.getElementById(CARD_HOST_ID)).toBe(card.host);
  });

  it('clears a stale host wearing its id rather than joining it', () => {
    // Either a double injection or something else on github.com owning the id.
    // Two elements with one id means `CARD_HOST_ID` resolves to whichever came
    // first, which is how the e2e locator and `sync` would both find the wrong
    // one.
    const impostor = document.createElement('div');
    impostor.id = CARD_HOST_ID;
    document.body.append(impostor);

    const { card } = open();
    expect(document.querySelectorAll(`#${CARD_HOST_ID}`)).toHaveLength(1);
    expect(document.getElementById(CARD_HOST_ID)).toBe(card.host);
  });

  it('puts everything behind a shadow boundary', () => {
    open();
    // The whole reason for the shadow root: github.com's stylesheet cannot
    // reach in, and a page script cannot find the card by querying its own
    // document. A `.card` visible from here would mean neither held.
    expect(document.querySelector('.card')).toBeNull();
    expect(document.querySelector('button')).toBeNull();
  });

  it('pins itself to the bottom-right corner, above the page', () => {
    const { card } = open();
    expect(card.host.style.position).toBe('fixed');
    expect(card.host.style.zIndex).toBe('2147483647');
  });

  it('offers the review with the wording the rest of the extension uses', () => {
    const { card } = open();
    expect(find(card, '.cta').textContent).toBe('Start a Better Review');
  });

  it('points at where the button is about to send you', () => {
    // Drawn rather than typed, which is what keeps the assertion above about
    // the label and not about the decoration: a `→` character would be in
    // `textContent` and every match on the button's words would have to know it.
    const { card } = open();
    expect(card.root.querySelector('.cta .arrow')).not.toBeNull();
  });

  it('draws the mark as three bars that can be staggered', () => {
    // The bars animate in one after another, added then removed then
    // unchanged, which the stylesheet times off these classes. Unnumbered,
    // all three arrive at once and the mark is a logo rather than a diff.
    const { card } = open();
    expect(card.root.querySelectorAll('.card .mark .bar').length).toBe(3);
    expect(card.root.querySelector('.card .mark .bar-1')).not.toBeNull();
    expect(card.root.querySelector('.card .mark .bar-3')).not.toBeNull();
  });

  it('leaves nothing behind when destroyed', () => {
    const { card } = open();
    card.destroy();
    expect(document.getElementById(CARD_HOST_ID)).toBeNull();
  });
});

describe('the button', () => {
  it('reports a click', () => {
    const { card, onOpen } = open();
    find<HTMLButtonElement>(card, '.cta').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('clears a previous failure before trying again', () => {
    // Otherwise last time's error sits under the button contradicting a click
    // that may well be about to succeed.
    const { card } = open();
    card.setStatus('Could not open the review.');
    expect(find(card, '.status').hidden).toBe(false);

    find<HTMLButtonElement>(card, '.cta').click();
    expect(find(card, '.status').hidden).toBe(true);
  });
});

describe('collapsing', () => {
  it('starts expanded by default', () => {
    const { card } = open();
    expect(find(card, '.card').hidden).toBe(false);
    expect(find(card, '.pill').hidden).toBe(true);
  });

  it('honours a stored collapsed state on the first paint', () => {
    // Read before mounting rather than applied after, so the card does not
    // appear expanded and then visibly collapse a frame later.
    const { card } = open(true);
    expect(find(card, '.card').hidden).toBe(true);
    expect(find(card, '.pill').hidden).toBe(false);
  });

  it('swaps the card for the pill and reports the change', () => {
    const { card, onCollapsedChange } = open();
    find<HTMLButtonElement>(card, '.collapse').click();

    expect(find(card, '.card').hidden).toBe(true);
    expect(find(card, '.pill').hidden).toBe(false);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('brings the card back from the pill', () => {
    const { card, onCollapsedChange } = open(true);
    find<HTMLButtonElement>(card, '.pill').click();

    expect(find(card, '.card').hidden).toBe(false);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('hands the keyboard to whatever replaced the button that was pressed', () => {
    const { card } = open();
    const collapse = find<HTMLButtonElement>(card, '.collapse');
    collapse.focus();
    collapse.click();
    // Collapsing hides the focused button, and a hidden element cannot hold
    // focus. Without the handover the keyboard lands on <body> — at the top of
    // github.com, not on the pill sitting where the card just was.
    expect(card.root.activeElement).toBe(find(card, '.pill'));

    find<HTMLButtonElement>(card, '.pill').click();
    // Expanding is the half that matters: the reviewer opened it to press this.
    expect(card.root.activeElement).toBe(find(card, '.cta'));
  });

  it('does not take the keyboard when another tab collapses it', () => {
    const { card } = open();
    const cta = find<HTMLButtonElement>(card, '.cta');
    cta.focus();
    // The storage listener calls this directly. A background tab pulling focus
    // because the card was collapsed in a foreground one would be worse than
    // the problem the handover above solves.
    card.setCollapsed(true);
    expect(card.root.activeElement).toBe(cta);
  });

  it('never hides both, so there is always a way in', () => {
    const { card } = open();
    for (const collapsed of [true, false, true]) {
      card.setCollapsed(collapsed);
      expect(find(card, '.card').hidden && find(card, '.pill').hidden).toBe(false);
    }
  });

  it('does not report a change it was told about from elsewhere', () => {
    // `setCollapsed` is how another tab's choice arrives. Echoing it back
    // would write storage in a loop.
    const { card, onCollapsedChange } = open();
    card.setCollapsed(true);
    expect(onCollapsedChange).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  it('is hidden until there is something to say', () => {
    const { card } = open();
    expect(find(card, '.status').hidden).toBe(true);
  });

  it('shows and clears', () => {
    const { card } = open();
    card.setStatus('Could not open the review.');
    expect(find(card, '.status').textContent).toBe('Could not open the review.');

    card.setStatus(null);
    expect(find(card, '.status').hidden).toBe(true);
    expect(find(card, '.status').textContent).toBe('');
  });

  it('announces itself, so it is not only a colour', () => {
    const { card } = open();
    expect(find(card, '.status').getAttribute('role')).toBe('status');
  });
});

describe('githubColorScheme', () => {
  it('follows the OS when GitHub says nothing', () => {
    expect(githubColorScheme(document)).toBe('light dark');
  });

  it.each(['light', 'dark'])('matches the page when GitHub is pinned to %s', (mode) => {
    // A reviewer who has pinned GitHub to dark on a light desktop expects the
    // card to match the page it is sitting on, not the desktop.
    document.documentElement.dataset.colorMode = mode;
    expect(githubColorScheme(document)).toBe(mode);
  });

  it('falls back to the OS for auto or anything unrecognized', () => {
    document.documentElement.dataset.colorMode = 'auto';
    expect(githubColorScheme(document)).toBe('light dark');

    document.documentElement.dataset.colorMode = 'sepia';
    expect(githubColorScheme(document)).toBe('light dark');
  });

  it('is applied to the host at mount', () => {
    document.documentElement.dataset.colorMode = 'dark';
    const { card } = open();
    expect(card.host.style.colorScheme).toBe('dark');
  });

  it('can be changed after the reviewer switches theme', () => {
    const { card } = open();
    card.setColorScheme('dark');
    expect(card.host.style.colorScheme).toBe('dark');
  });
});
