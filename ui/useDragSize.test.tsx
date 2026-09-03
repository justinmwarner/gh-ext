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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type DragBounds, useDragSize } from './useDragSize';

function Harness(bounds: DragBounds) {
  const drag = useDragSize(bounds);
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
