/**
 * The numbered commit strip.
 *
 * A pull request's commits are a sequence, and a sequence wants to be shown as
 * one. Numbers rather than subjects because the subjects are long, of wildly
 * varying length, and mostly say the same thing as each other — a strip of them
 * is unscannable, and the thing a reviewer is actually doing here is stepping
 * along a history rather than reading it.
 *
 * What a number cannot say goes on the tab's title and its accessible name.
 * There used to be a line under the strip saying it as well; the row it needed
 * pushed the diff down and broke the strip's own edge, and what a reviewer
 * actually has to know — which commits are on screen — is said to the left of
 * the strip by whoever renders it.
 */

import { render, screen } from '@testing-library/react';
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

    expect(tabs().map((t) => t.textContent)).toEqual(['1', '2', '3', 'All']);
  });

  it('puts All at the end, where the strip cannot scroll it away', () => {
    // The numbers are what grows — a long pull request pushes them off the
    // right — and "back to everything" is the one control that has to survive
    // that, so it sits at the end and is pinned there.
    mount();

    expect(tabs().at(-1)?.textContent).toBe('All');
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

describe('the keyboard', () => {
  it('keeps one tab in the tab order rather than all of them', () => {
    // A two-hundred-commit pull request is two hundred tab stops otherwise.
    mount();

    expect(tabs().filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('steps along the strip with the arrow keys', async () => {
    mount();

    tab('Commit 1, 1111111').focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(document.activeElement?.textContent).toBe('2');
  });

  it('jumps to the ends with Home and End', async () => {
    mount();

    tab('Commit 2, 2222222').focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('All');

    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.textContent).toBe('1');
  });
});
