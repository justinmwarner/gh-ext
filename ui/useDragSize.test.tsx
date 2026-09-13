/**
 * The one drag hook, on either axis.
 *
 * The rail and the tab panel resize the same way — pointer or arrow keys,
 * clamped to a range — and the only thing that differs is which coordinate the
 * pointer is read from and which pair of arrows steps. Two copies of this
 * would be two places to fix the next time a drag leaks a window listener.
 *
 * Nothing here mocks the events: the hook installs its listeners on `window`
 * precisely because a handle a few pixels wide loses the pointer constantly,
 * and a test that fired at the handle would never exercise that.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DragBounds, type DragMemory, useDragSize } from './useDragSize';

function Harness({ remember, ...bounds }: DragBounds & { remember?: DragMemory }) {
  const drag = useDragSize(bounds, remember);
  return (
    <div
      data-testid="handle"
      tabIndex={0}
      onPointerDown={drag.onPointerDown}
      onKeyDown={drag.onKeyDown}
    >
      {drag.size}
    </div>
  );
}

const X: DragBounds = { axis: 'x', min: 100, max: 300, initial: 200 };
const Y: DragBounds = { axis: 'y', min: 100, max: 300, initial: 200 };

const handle = () => screen.getByTestId('handle');
const size = () => Number(handle().textContent);

describe('useDragSize', () => {
  it('starts at the size it was given', () => {
    render(<Harness {...X} />);

    expect(size()).toBe(200);
  });

  it('clamps an initial size that is outside the range', () => {
    render(<Harness {...X} initial={9000} />);

    expect(size()).toBe(300);
  });

  it('steps with the horizontal arrows on the x axis', () => {
    render(<Harness {...X} />);

    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(size()).toBe(216);

    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(size()).toBe(200);
  });

  it('steps with the vertical arrows on the y axis', () => {
    render(<Harness {...Y} />);

    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(size()).toBe(216);

    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(size()).toBe(200);
  });

  it('leaves the other axis’s arrows to the browser', () => {
    // A vertical separator that swallowed ArrowUp would take page scrolling
    // with it for as long as it held focus.
    render(<Harness {...X} />);

    fireEvent.keyDown(handle(), { key: 'ArrowDown' });

    expect(size()).toBe(200);
  });

  it('jumps to either end on Home and End', () => {
    render(<Harness {...X} />);

    fireEvent.keyDown(handle(), { key: 'End' });
    expect(size()).toBe(300);

    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(size()).toBe(100);
  });

  it('follows the pointer along its own axis', () => {
    render(<Harness {...X} />);

    fireEvent.pointerDown(handle(), { clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 540, clientY: 999 });

    expect(size()).toBe(240);
  });

  it('reads the other coordinate on the y axis', () => {
    render(<Harness {...Y} />);

    fireEvent.pointerDown(handle(), { clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 999, clientY: 460 });

    expect(size()).toBe(160);
  });

  it('stops at the ends of the range rather than past them', () => {
    render(<Harness {...X} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 5000 });
    expect(size()).toBe(300);

    fireEvent.pointerMove(window, { clientX: -5000 });
    expect(size()).toBe(100);
  });

  it('lets go when the pointer is released', () => {
    render(<Harness {...X} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerUp(window, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 560 });

    expect(size()).toBe(200);
  });

  it('lets go when the pointer is cancelled out from under it', () => {
    render(<Harness {...X} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerMove(window, { clientX: 560 });

    expect(size()).toBe(200);
  });

  it('tears down a drag that was still in progress when it unmounted', () => {
    // The listeners are on `window`, so an unmount mid-drag leaves them there
    // to call `setState` on a component that no longer exists.
    const view = render(<Harness {...X} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    view.unmount();

    expect(() => fireEvent.pointerMove(window, { clientX: 560 })).not.toThrow();
  });
});

/**
 * Remembering a size between sessions.
 *
 * The hook owns *when* — a gesture's end, never its middle — and the caller
 * owns where. So everything here is about timing and about the two ways the
 * stored value must not win: it must not overrule a reviewer who has already
 * dragged, and it must not arrive unclamped.
 *
 * The storage itself is a pair of functions handed in, which is the point of
 * `DragMemory` being injected: none of this needs an extension.
 */
describe('useDragSize, with somewhere to remember', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A memory that answers with `stored` and records what it was told. */
  const memory = (stored: number | null = null) => {
    const write = vi.fn<(size: number) => void>();
    return { read: () => Promise.resolve(stored), write };
  };

  /** Let the read resolve, and let any pending write settle. */
  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('opens at the stored size rather than the default', async () => {
    render(<Harness {...X} remember={memory(260)} />);
    await settle();

    expect(size()).toBe(260);
  });

  it('opens at the default when nothing is stored yet', async () => {
    render(<Harness {...X} remember={memory(null)} />);
    await settle();

    expect(size()).toBe(200);
  });

  it('clamps a stored size from a wider monitor', async () => {
    // Unclamped it would draw a region that leaves no room for anything else
    // and cannot be grabbed to fix.
    render(<Harness {...X} remember={memory(9000)} />);
    await settle();

    expect(size()).toBe(300);
  });

  it('does not undo a drag that finished before the read landed', async () => {
    // Storage is asynchronous. A reviewer who grabs the handle in the first
    // moments of a page can beat it, and the stored value is stale by then.
    render(<Harness {...X} remember={memory(260)} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 540 });
    fireEvent.pointerUp(window, { clientX: 540 });
    await settle();

    expect(size()).toBe(240);
  });

  it('writes once when the drag ends, and not once per pointer event', async () => {
    // The whole reason the write is not in `onMove`: a drag is a few hundred
    // `pointermove` events, and a storage write on each is a write queue the
    // length of the drag.
    vi.useFakeTimers();
    const remember = memory();
    render(<Harness {...X} remember={remember} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 520 });
    fireEvent.pointerMove(window, { clientX: 540 });
    fireEvent.pointerMove(window, { clientX: 560 });

    act(() => {
      vi.runAllTimers();
    });
    expect(remember.write).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { clientX: 560 });
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).toHaveBeenCalledTimes(1);
    expect(remember.write).toHaveBeenCalledWith(260);
  });

  it('writes the size the drag actually ended on', async () => {
    vi.useFakeTimers();
    const remember = memory();
    render(<Harness {...X} remember={remember} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 5000 });
    fireEvent.pointerMove(window, { clientX: 530 });
    fireEvent.pointerUp(window, { clientX: 530 });
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).toHaveBeenCalledWith(230);
  });

  it('writes nothing for a press that moved nothing', async () => {
    // Clicking a handle is not a resize, and storing on it would turn every
    // stray click into a write.
    vi.useFakeTimers();
    const remember = memory();
    render(<Harness {...X} remember={remember} />);

    fireEvent.pointerDown(handle(), { clientX: 500 });
    fireEvent.pointerUp(window, { clientX: 500 });
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).not.toHaveBeenCalled();
  });

  it('writes a keyboard resize too, so the keyboard is not the poor relation', async () => {
    vi.useFakeTimers();
    const remember = memory();
    render(<Harness {...X} remember={remember} />);

    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).toHaveBeenCalledWith(216);
  });

  it('coalesces a held arrow key into one write', async () => {
    // A repeat is around thirty keystrokes a second and each one is a finished
    // gesture with no end to hook, so the end is inferred from the reviewer
    // stopping.
    vi.useFakeTimers();
    const remember = memory();
    render(<Harness {...X} remember={remember} />);

    for (let press = 0; press < 5; press += 1) {
      fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    }
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).toHaveBeenCalledTimes(1);
    expect(remember.write).toHaveBeenCalledWith(280);
  });

  it('writes the end of the range on End', async () => {
    vi.useFakeTimers();
    const remember = memory();
    render(<Harness {...X} remember={remember} />);

    fireEvent.keyDown(handle(), { key: 'End' });
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).toHaveBeenCalledWith(300);
  });

  it('does not write after the region has been unmounted', async () => {
    // The timer outlives the component otherwise, and the size it is holding
    // belongs to a review that is no longer on screen.
    vi.useFakeTimers();
    const remember = memory();
    const view = render(<Harness {...X} remember={remember} />);

    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    view.unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(remember.write).not.toHaveBeenCalled();
  });

  it('remembers nothing at all when no memory was given', () => {
    // The tab panel's height. It is an answer to what is in this pull request,
    // so there is nothing to carry to the next one.
    vi.useFakeTimers();
    render(<Harness {...Y} />);

    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(() => {
      act(() => {
        vi.runAllTimers();
      });
    }).not.toThrow();
    expect(size()).toBe(216);
  });
});
