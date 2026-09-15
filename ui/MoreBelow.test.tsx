/**
 * The pill that says the file is not finished yet.
 *
 * The one rule worth a test is when it stays silent. It speaks only about the
 * file the reviewer is on, and only while that file still has changes under
 * the fold — a pill lit for the whole review is a badge a reviewer stops
 * seeing by the third file, and the moment it exists for is the long file
 * whose last change sits a screen below where the changes appeared to stop.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MoreBelow } from './MoreBelow';
import { HunkNavContext, createHunkCursorStore } from './hunkCursor';

function mount(below: number, step = vi.fn()) {
  const store = createHunkCursorStore();
  store.set({ below, path: 'a.ts' });
  render(
    <HunkNavContext.Provider value={{ store, step }}>
      <MoreBelow />
    </HunkNavContext.Provider>,
  );
  return { store, step };
}

describe('MoreBelow', () => {
  it('stays silent once the file has nothing left below the fold', () => {
    mount(0);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('counts what is left in this file', () => {
    mount(3);
    expect(screen.getByRole('button').textContent).toContain('3 more changes in this file');
  });

  it('says it in the singular for the last one', () => {
    // "1 more changes" is the kind of thing a reviewer notices and nobody fixes.
    mount(1);
    expect(screen.getByRole('button').textContent).toContain('1 more change in this file');
    expect(screen.getByRole('button').textContent).not.toContain('changes');
  });

  it('goes to the next change when pressed', async () => {
    const user = userEvent.setup();
    const { step } = mount(2);

    await user.click(screen.getByRole('button'));
    expect(step).toHaveBeenCalledWith(1);
  });

  it('goes quiet the moment the last change passes the fold', () => {
    const { store } = mount(1);
    expect(screen.queryByRole('button')).not.toBeNull();

    act(() => store.set({ below: 0 }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not announce itself, because it changes on every scroll', () => {
    // An `aria-live` region here would read "3 more changes in this file" over
    // and over while somebody scrolls. It is a button: reachable, nameable,
    // and silent until asked.
    mount(3);
    const pill = screen.getByRole('button');
    expect(pill.closest('[aria-live]')).toBeNull();
    expect(pill.getAttribute('role')).toBeNull();
  });
});
