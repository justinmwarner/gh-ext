/**
 * The numbered commit strip.
 *
 * A pull request's commits are a sequence, and a sequence wants to be shown as
 * one. Numbers rather than subjects because the subjects are long, of wildly
 * varying length, and mostly say the same thing as each other — a strip of them
 * is unscannable, and the thing a reviewer is actually doing here is stepping
 * along a history rather than reading it.
 *
 * What a number cannot say, the details line says: whichever commit the pointer
 * or the keyboard is on is spelled out in one fixed place. Fixed on purpose. A
 * tooltip that follows the pointer makes the eye chase it, and the whole point
 * of a strip is that you sweep along it.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PrCommit } from '@/lib/github/types';
import { WHOLE_DIFF } from '@/lib/review/diffScope';
import type { DiffScope } from '@/lib/review/diffScope';
import { CommitTabs } from './CommitTabs';

const commit = (n: number): PrCommit => ({
  oid: `${n}`.repeat(40),
  abbreviatedOid: `${n}`.repeat(7),
  messageHeadline: `Commit number ${n}`,
  committedDate: `2026-09-0${n}T10:00:00Z`,
  authorLogin: `dev${n}`,
  authorName: `Dev ${n}`,
  parentOid: n === 1 ? 'base' : `${n - 1}`.repeat(40),
});

const COMMITS = [commit(1), commit(2), commit(3)];

function mount(scope: DiffScope = WHOLE_DIFF, commits = COMMITS) {
  const onScope = vi.fn<(scope: DiffScope) => void>();
  const view = render(
    <CommitTabs commits={commits} scope={scope} onScope={onScope} />,
  );
  return { ...view, onScope };
}

const tabs = () => screen.getAllByRole('button');
const tab = (name: string) => screen.getByRole('button', { name });
const details = () => screen.getByTestId('commit-details').textContent ?? '';

/**
 * Held rather than passed: user-event models modifiers as keyboard state.
 *
 * One `setup()` instance for both calls, because the direct API builds a fresh
 * one per call and a modifier held on one instance is not held on the next.
 */
const withModifier = async (element: HTMLElement, modifier: string): Promise<void> => {
  const user = userEvent.setup();
  await user.keyboard(`{${modifier}>}`);
  await user.click(element);
  await user.keyboard(`{/${modifier}}`);
};

const shiftClick = (element: HTMLElement) => withModifier(element, 'Shift');
const ctrlClick = (element: HTMLElement) => withModifier(element, 'Control');
const metaClick = (element: HTMLElement) => withModifier(element, 'Meta');

describe('the strip', () => {
  it('numbers the commits from one, oldest first', () => {
    // The order GitHub returns and the order the branch reads in, so the
    // numbers match what a reviewer sees anywhere else.
    mount();

    expect(tabs().map((t) => t.textContent)).toEqual(['All', '1', '2', '3']);
  });

  it('names each tab properly, since a digit is not a name', () => {
    mount();

    expect(tab('Commit 2, 2222222').textContent).toBe('2');
  });

  it('carries the commit on a title as well, for a plain hover', () => {
    mount();

    expect(tab('Commit 2, 2222222').getAttribute('title')).toContain(
      'Commit number 2',
    );
  });

  it('shows nothing at all when the commits could not be read', () => {
    // A strip of one "All" tab is a control that appears broken.
    const { container } = mount(WHOLE_DIFF, []);

    expect(container.querySelector('.commit-tabs')).toBeNull();
  });
});

describe('what is selected', () => {
  it('presses All for the whole pull request', () => {
    mount();

    expect(tab('All').getAttribute('aria-pressed')).toBe('true');
  });

  it('presses the one commit the diff is scoped to', () => {
    mount({ kind: 'commits', from: COMMITS[1]!.oid, to: COMMITS[1]!.oid });

    expect(tab('Commit 2, 2222222').getAttribute('aria-pressed')).toBe('true');
    expect(tab('All').getAttribute('aria-pressed')).toBe('false');
  });

  it('presses every commit in a range, not just its ends', () => {
    // The reviewer is looking at all of them. Pressing only the ends would say
    // the two ends were selected and the middle was not.
    mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[2]!.oid });

    expect(tabs().filter((t) => t.getAttribute('aria-pressed') === 'true')).toHaveLength(3);
  });

  it('presses nothing when the preset is what is narrowing', () => {
    // "Since my last review" is a scope no number on this strip describes.
    mount({ kind: 'since-review' });

    expect(tabs().every((t) => t.getAttribute('aria-pressed') === 'false')).toBe(true);
  });
});

describe('choosing', () => {
  it('scopes to one commit when its number is clicked', async () => {
    const { onScope } = mount();

    await userEvent.click(tab('Commit 2, 2222222'));

    expect(onScope).toHaveBeenCalledWith({
      kind: 'commits',
      from: COMMITS[1]!.oid,
      to: COMMITS[1]!.oid,
    });
  });

  it('goes back to the whole thing from All', async () => {
    const { onScope } = mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid });

    await userEvent.click(tab('All'));

    expect(onScope).toHaveBeenCalledWith(WHOLE_DIFF);
  });

  it('extends to a range on a shift-click', async () => {
    const { onScope } = mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid });

    await shiftClick(tab('Commit 3, 3333333'));

    expect(onScope).toHaveBeenCalledWith({
      kind: 'commits',
      from: COMMITS[0]!.oid,
      to: COMMITS[2]!.oid,
    });
  });

  it('orders a backwards shift-click the way the history runs', async () => {
    // Shift-clicking an earlier commit than the anchor still means the span
    // between them, and a range whose ends are reversed is an empty diff.
    const { onScope } = mount({ kind: 'commits', from: COMMITS[2]!.oid, to: COMMITS[2]!.oid });

    await shiftClick(tab('Commit 1, 1111111'));

    expect(onScope).toHaveBeenCalledWith({
      kind: 'commits',
      from: COMMITS[0]!.oid,
      to: COMMITS[2]!.oid,
    });
  });

  it('extends on a control-click too', async () => {
    // Shift is the convention for a range and control for a set, but there are
    // no disjoint sets here — the diff between two commits is the span between
    // them — so both mean the same thing rather than one of them meaning
    // nothing.
    const { onScope } = mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid });

    await ctrlClick(tab('Commit 3, 3333333'));

    expect(onScope).toHaveBeenCalledWith({
      kind: 'commits',
      from: COMMITS[0]!.oid,
      to: COMMITS[2]!.oid,
    });
  });

  it('extends on a command-click, which is what a Mac sends', async () => {
    const { onScope } = mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid });

    await metaClick(tab('Commit 3, 3333333'));

    expect(onScope).toHaveBeenCalledWith({
      kind: 'commits',
      from: COMMITS[0]!.oid,
      to: COMMITS[2]!.oid,
    });
  });

  it('treats a shift-click with nothing selected as an ordinary one', async () => {
    const { onScope } = mount();

    await shiftClick(tab('Commit 2, 2222222'));

    expect(onScope).toHaveBeenCalledWith({
      kind: 'commits',
      from: COMMITS[1]!.oid,
      to: COMMITS[1]!.oid,
    });
  });
});

describe('the details line', () => {
  it('spells out whichever commit the pointer is on', async () => {
    mount();

    await userEvent.hover(tab('Commit 3, 3333333'));

    expect(details()).toContain('Commit number 3');
    expect(details()).toContain('3333333');
    expect(details()).toContain('dev3');
  });

  it('does the same for the keyboard, which has no pointer', async () => {
    mount();

    act(() => tab('Commit 2, 2222222').focus());

    expect(details()).toContain('Commit number 2');
  });

  it('falls back to the commit that is selected', () => {
    // With nothing hovered the line still has something true to say, and it is
    // the thing the column is actually showing.
    mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid });

    expect(details()).toContain('Commit number 1');
  });

  it('says what a range is, rather than one end of it', () => {
    mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[2]!.oid });

    expect(details()).toContain('3 commits');
  });

  it('describes the range it just made, not the tab that made it', async () => {
    // Clicking leaves focus on the tab, and focus is one of the things the line
    // follows. Left alone that meant a freshly made range was described by one
    // of its ends for as long as focus stayed there — which is exactly when the
    // reviewer wants to know what the range is.
    const { onScope, rerender } = mount({
      kind: 'commits',
      from: COMMITS[0]!.oid,
      to: COMMITS[0]!.oid,
    });

    await shiftClick(tab('Commit 3, 3333333'));
    // The pointer is still on the tab, and the line legitimately follows the
    // pointer. This is about what it says once the pointer has gone.
    await userEvent.unhover(tab('Commit 3, 3333333'));
    rerender(
      <CommitTabs
        commits={COMMITS}
        scope={{ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[2]!.oid }}
        onScope={onScope}
      />,
    );

    expect(details()).toContain('3 commits');
  });

  it('goes back to the selection when the pointer leaves', async () => {
    mount({ kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid });

    await userEvent.hover(tab('Commit 3, 3333333'));
    await userEvent.unhover(tab('Commit 3, 3333333'));

    expect(details()).toContain('Commit number 1');
  });
});

describe('the keyboard', () => {
  it('keeps one tab in the tab order rather than all of them', () => {
    // A two-hundred-commit pull request is two hundred tab stops otherwise.
    mount();

    expect(tabs().filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('steps along the strip with the arrow keys', async () => {
    mount();

    tab('All').focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(document.activeElement?.textContent).toBe('1');
  });

  it('jumps to the ends with Home and End', async () => {
    mount();

    tab('All').focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('3');

    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.textContent).toBe('All');
  });
});
