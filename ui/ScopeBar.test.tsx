/**
 * The row above the diff, which is now one row.
 *
 * It says three things and they belong together: how much changed, which
 * commits are on screen, and how to change that. They used to be spread over
 * three rows and two surfaces — a summary in the Files view's own bar, a strip
 * with a caption under it, and a pair of buttons off to the side — which cost
 * the diff three rows of chrome and left the strip unable to meet the content
 * it opens onto.
 *
 * So: sentence on the left, tabs in the middle, everything else behind a kebab
 * on the right. What is asserted here is which of those a given state puts on
 * screen, because the failure this bar exists to prevent is a reviewer reading
 * a narrowed diff believing it is the whole one.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PrCommit } from '@/lib/github/types';
import type { DiffScope, ResolvedScope } from '@/lib/review/diffScope';
import { BOTH_SIDES, WHOLE_DIFF } from '@/lib/review/diffScope';
import { ScopeBar, type ScopeBarProps } from './ScopeBar';

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

const NARROWED: ResolvedScope = {
  kind: 'narrowed',
  range: { base: 'base', head: COMMITS[0]!.oid },
  label: 'commit 1111111',
  sides: BOTH_SIDES,
};

function mount(overrides: Partial<ScopeBarProps> = {}) {
  const props: ScopeBarProps = {
    scope: { kind: 'whole' },
    commits: COMMITS,
    chosen: WHOLE_DIFF,
    onScope: vi.fn<(scope: DiffScope) => void>(),
    changed: { files: 3, additions: 42, deletions: 7 },
    commitCount: COMMITS.length,
    commitsTruncated: false,
    sinceReviewAvailable: true,
    sinceReviewActive: false,
    busy: false,
    requestError: null,
    onOpenPicker: vi.fn(),
    onSinceReview: vi.fn(),
    onShowAll: vi.fn(),
    ...overrides,
  };
  return { ...render(<ScopeBar {...props} />), props };
}

const bar = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('.scope-bar');
  if (found === null) throw new Error('the scope bar is not on the page');
  return found;
};

const status = (): string => document.querySelector('.scope-status')?.textContent ?? '';

/** Open the kebab and hand back the item, which is where the controls live. */
const menuItem = async (name: RegExp): Promise<HTMLElement> => {
  const user = userEvent.setup();
  const kebab = screen.getByRole('button', { name: /commit options/i });
  if (kebab.getAttribute('aria-expanded') !== 'true') await user.click(kebab);
  const found = [
    ...screen.getByRole('menu').querySelectorAll<HTMLElement>('.menu-item'),
  ].find((item) => name.test(item.textContent ?? ''));
  if (found === undefined) throw new Error(`no menu item matching ${String(name)}`);
  return found;
};

describe('what it says is on screen', () => {
  it('says how much changed', () => {
    mount();

    expect(status()).toContain('3 files changed');
    expect(status()).toContain('+42');
    expect(status()).toContain('7');
  });

  it('says "file" for one of them', () => {
    mount({ changed: { files: 1, additions: 1, deletions: 0 } });

    expect(status()).toContain('1 file changed');
  });

  it('does not repeat itself when the whole pull request is showing', () => {
    // The pressed "All" tab already says this. A sentence beside it reading
    // "showing all 3 commits" is the same fact twice, in the row that has the
    // least width to spare.
    mount();

    expect(status()).not.toMatch(/showing/i);
  });

  it('names the commits when the column is narrowed to them', () => {
    // The failure this bar exists to prevent: a scoped diff and the whole one
    // render identically, and "nobody changed that" is a different sentence
    // from "nobody changed that in this commit".
    mount({
      scope: NARROWED,
      chosen: { kind: 'commits', from: COMMITS[0]!.oid, to: COMMITS[0]!.oid },
    });

    expect(status()).toContain('commit 1111111');
  });

  it('says a comparison is on its way rather than looking finished', () => {
    mount({ busy: true, scope: NARROWED });

    expect(status()).toContain('Comparing');
  });

  it('goes back to naming the whole thing when a comparison fails', () => {
    // A failed comparison leaves the *whole* diff on screen, so a bar still
    // reading "showing commit 1111111" would be describing something the
    // reviewer is not looking at.
    mount({ scope: NARROWED, requestError: 'No commit a…a' });

    expect(bar().getAttribute('data-scope')).toBe('failed');
    expect(status()).not.toContain('commit 1111111');
  });
});

describe('the controls', () => {
  it('keeps the row to tabs by putting the rest behind one kebab', () => {
    // The strip is the control the reviewer uses; the other three are
    // occasional. Left on the row they take the width the numbers need and
    // break the strip's own edge.
    mount();

    expect(screen.getByRole('button', { name: /commit options/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /choose commits/i })).toBeNull();
  });

  it('opens the picker from the menu', async () => {
    const { props } = mount();

    await userEvent.click(await menuItem(/choose commits/i));

    expect(props.onOpenPicker).toHaveBeenCalledOnce();
  });

  it('makes the preset a checkbox, because it is a state and not an action', async () => {
    mount({ sinceReviewActive: true, scope: NARROWED });

    expect((await menuItem(/since my last review/i)).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('says why the preset is off rather than hiding it', async () => {
    // A control that appears and disappears with the pull request is one the
    // reviewer has to rediscover.
    mount({ sinceReviewAvailable: false });

    const item = await menuItem(/since my last review/i);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toMatch(/not reviewed|no earlier/i);
  });

  it('offers no way back while there is nothing to come back from', async () => {
    mount();

    await expect(menuItem(/show all commits/i)).rejects.toThrow();
  });

  it('offers the way back as soon as the column is narrowed', async () => {
    const { props } = mount({ scope: NARROWED });

    await userEvent.click(await menuItem(/show all commits/i));

    expect(props.onShowAll).toHaveBeenCalledOnce();
  });

  it('refuses the picker when GitHub sent no commits to pick from', async () => {
    mount({ commits: [], commitCount: 0 });

    const item = await menuItem(/choose commits/i);
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the notes', () => {
  it('says the commit list is short when GitHub did not send all of it', () => {
    mount({ commitsTruncated: true });

    expect(screen.getByRole('status').textContent).toMatch(/not the whole history/i);
  });

  it('says a lost commit is lost', () => {
    mount({ scope: { kind: 'lost', message: 'That commit is no longer here.' } });

    expect(screen.getByRole('status').textContent).toContain('no longer here');
  });

  it('raises a failed comparison rather than leaving it to be noticed', () => {
    mount({ scope: NARROWED, requestError: 'No commit a…a' });

    expect(screen.getByRole('alert').textContent).toContain('No commit a…a');
  });
});
