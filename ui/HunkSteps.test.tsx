/**
 * The counter on a file's sticky header.
 *
 * Two rules are worth holding a test to, because both are decisions rather
 * than renderings. A card with one section gets nothing at all — a "1 of 1" on
 * every single-hunk card is chrome on the majority of cards in most pull
 * requests. And the arrows appear only on the card the reviewer is actually
 * on: they step the global list, the same one `J` steps, so on any other card
 * they would jump somewhere that has nothing to do with the header they were
 * pressed from.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HunkStop } from '@/lib/review/hunkNav';
import { HunkSteps } from './HunkSteps';
import { HunkNavContext, createHunkCursorStore } from './hunkCursor';

const at = (path: string, line: number): HunkStop => ({ path, side: 'additions', line });

/** Three sections in a.ts, one in b.ts. */
const STOPS: readonly HunkStop[] = [
  at('a.ts', 10),
  at('a.ts', 50),
  at('a.ts', 90),
  at('b.ts', 4),
];

function mount(
  path: string,
  state: { stops?: readonly HunkStop[]; index?: number } = {},
  step = vi.fn(),
) {
  const store = createHunkCursorStore();
  store.set({ stops: state.stops ?? STOPS, index: state.index ?? -1 });
  render(
    <HunkNavContext.Provider value={{ store, step }}>
      <HunkSteps path={path} />
    </HunkNavContext.Provider>,
  );
  return { step };
}

describe('HunkSteps', () => {
  it('says nothing about a file with a single changed section', () => {
    mount('b.ts', { index: 3 });
    expect(screen.queryByRole('button', { name: /next change/i })).toBeNull();
    expect(screen.queryByText(/change/i)).toBeNull();
  });

  it('says nothing about a file with no changed sections at all', () => {
    mount('never.ts');
    expect(screen.queryByText(/change/i)).toBeNull();
  });

  it('counts within the file rather than within the review', () => {
    // b.ts's stop is index 3 globally and the first of its own file. A counter
    // reading the global index would say "4".
    mount('a.ts', { index: 2 });
    expect(screen.getByText('Change 3 of 3')).toBeTruthy();
  });

  it('names the section the reviewer is on as they move through the file', () => {
    mount('a.ts', { index: 0 });
    expect(screen.getByText('Change 1 of 3')).toBeTruthy();
  });

  it('offers the count without the arrows on a file the reviewer is not on', () => {
    // The arrows step the global list. On a card that is not the current one
    // they would move the review somewhere unrelated to the header pressed.
    mount('a.ts', { index: 3 });

    expect(screen.getByText('3 changes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /next change/i })).toBeNull();
  });

  it('steps forward and back through the global list', async () => {
    const user = userEvent.setup();
    const { step } = mount('a.ts', { index: 1 });

    await user.click(screen.getByRole('button', { name: /next change/i }));
    expect(step).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: /previous change/i }));
    expect(step).toHaveBeenCalledWith(-1);
  });

  it('teaches the keyboard rather than replacing it', () => {
    mount('a.ts', { index: 1 });
    expect(screen.getByRole('button', { name: /next change/i }).title).toContain('J');
    expect(screen.getByRole('button', { name: /previous change/i }).title).toContain('K');
  });

  it('stops at the ends of the review', () => {
    mount('a.ts', { index: 0 });
    expect(
      screen.getByRole('button', { name: /previous change/i }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: /next change/i }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
