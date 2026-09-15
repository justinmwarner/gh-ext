/**
 * The one piece of state this feature adds, and the reason it is not `useState`.
 *
 * `handleScroll` in `DiffColumn` already re-renders the shell when the *file*
 * under the top of the viewport changes, and the comment there says why it
 * guards that: scroll fires at frame rate. Hunk boundaries are crossed far more
 * often than file boundaries, so a cursor held in React state would reintroduce
 * exactly the cost that guard exists to avoid.
 *
 * So the tests that matter here are about what does *not* happen: a `set` that
 * changes nothing notifies nobody, and a subscriber re-renders only when a
 * field actually moved.
 */

import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HunkStop } from '@/lib/review/hunkNav';
import {
  type HunkCursorStore,
  HunkNavContext,
  createHunkCursorStore,
  useHunkCursor,
} from './hunkCursor';

const STOPS: readonly HunkStop[] = [
  { path: 'a.ts', side: 'additions', line: 10 },
  { path: 'a.ts', side: 'additions', line: 50 },
];

describe('createHunkCursorStore', () => {
  it('starts knowing nothing, which is what an unscrolled column knows', () => {
    expect(createHunkCursorStore().get()).toEqual({
      stops: [],
      index: -1,
      path: null,
      below: 0,
    });
  });

  it('tells its subscribers when a field moves', () => {
    const store = createHunkCursorStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ index: 3 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get().index).toBe(3);
  });

  it('says nothing when the new value is the value it already had', () => {
    // The whole point. Most scroll frames land inside the section the previous
    // frame was already in.
    const store = createHunkCursorStore();
    store.set({ index: 3, path: 'a.ts' });

    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ index: 3, path: 'a.ts' });
    store.set({});

    expect(listener).not.toHaveBeenCalled();
  });

  it('compares the stop list by identity rather than by contents', () => {
    // It is memoized upstream and rebuilt only when something real moved, so
    // identity is exactly the question "did this change" — and comparing a
    // thousand hunks element by element on a scroll frame is not free.
    const store = createHunkCursorStore();
    store.set({ stops: STOPS });

    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ stops: STOPS });
    expect(listener).not.toHaveBeenCalled();

    store.set({ stops: [...STOPS] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops talking to a listener that has unsubscribed', () => {
    const store = createHunkCursorStore();
    const listener = vi.fn();
    const drop = store.subscribe(listener);

    drop();
    store.set({ index: 9 });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('useHunkCursor', () => {
  /** Counts renders, so "did not re-render" is an assertion rather than a hope. */
  function Probe({ onRender }: { onRender: () => void }) {
    const state = useHunkCursor();
    onRender();
    return <span data-testid="index">{state.index}</span>;
  }

  const mount = (store: HunkCursorStore, onRender: () => void) =>
    render(
      <HunkNavContext.Provider
        value={{ store, step: () => {} }}
      >
        <Probe onRender={onRender} />
      </HunkNavContext.Provider>,
    );

  it('re-renders the subscriber when the cursor moves', () => {
    const store = createHunkCursorStore();
    const onRender = vi.fn();
    const view = mount(store, onRender);

    act(() => store.set({ index: 4 }));

    expect(view.getByTestId('index').textContent).toBe('4');
  });

  it('does not re-render the subscriber when nothing moved', () => {
    const store = createHunkCursorStore();
    const onRender = vi.fn();
    mount(store, onRender);

    const before = onRender.mock.calls.length;
    act(() => store.set({ index: -1 }));

    expect(onRender.mock.calls.length).toBe(before);
  });

  it('reads an empty state outside a provider rather than throwing', () => {
    // The card header is rendered through Pierre's slot machinery and the
    // options page mounts a diff of its own. Neither should have to know this
    // context exists in order not to crash.
    const onRender = vi.fn();
    const view = render(<Probe onRender={onRender} />);

    expect(view.getByTestId('index').textContent).toBe('-1');
  });
});
