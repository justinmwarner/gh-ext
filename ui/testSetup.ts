/**
 * Per-test teardown for the `ui` suite.
 *
 * Testing Library registers its own `afterEach(cleanup)` only when Vitest is
 * running with globals, and this project is not. Without this file each test
 * renders on top of the DOM the previous one left behind, and `getByRole`
 * starts reporting that it found two of everything.
 */

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

/**
 * `ResizeObserver`, which jsdom does not implement.
 *
 * Both Pierre packages virtualize against a scrollport they measure, and
 * `CodeView.setup` constructs a `ResizeObserver` unconditionally. Without this
 * the component throws on mount and nothing about the surrounding wiring can be
 * tested at all.
 *
 * It is deliberately inert. jsdom reports every element as zero-sized, so a
 * real implementation would have nothing truthful to report; anything that
 * depends on measured layout is out of reach here and is not asserted on.
 */
if (!('ResizeObserver' in globalThis)) {
  class InertResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: InertResizeObserver,
    writable: true,
    configurable: true,
  });
}
