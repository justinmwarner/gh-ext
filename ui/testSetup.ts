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
import { DEFAULT_THEMES, getThemes, preloadHighlighter } from '@pierre/diffs';

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
/**
 * `Element.prototype.scrollTo`, which jsdom also does not implement.
 *
 * `CodeView` calls it while reconciling its virtual scroll, so any test that
 * moves the review — a keyboard jump, a thread jump from the rail — throws
 * inside the library before it reaches anything worth asserting.
 *
 * Inert for the same reason as the observer above: jsdom reports every element
 * as zero-sized, so there is no honest scrolling to simulate, and nothing here
 * asserts on scroll position.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

/**
 * `Element.prototype.scrollIntoView`, which jsdom does not implement either.
 *
 * The file tree calls it to keep the row for the file the column scrolled to
 * on screen. Inert here for the same reason as the two above: jsdom performs
 * no layout, so there is nothing to scroll and nothing worth asserting about
 * where it ended up. That claim is checked in a real browser instead.
 */
if (
  typeof Element !== 'undefined' &&
  typeof Element.prototype.scrollIntoView !== 'function'
) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

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

/**
 * A `browser.storage.onChanged` nobody has subscribed to.
 *
 * The review page listens for the token changing, so it can load the pull
 * request the moment the reviewer pastes one instead of leaving them on a
 * setup screen that promised it would. That listener is registered on mount,
 * which means every component test that renders the page reaches for
 * `browser` — a global jsdom has no reason to have.
 *
 * Inert, and only installed when nothing else has provided one, so a test that
 * wants to drive real change events can stub its own and keep it.
 */
if (!('browser' in globalThis)) {
  Object.defineProperty(globalThis, 'browser', {
    value: {
      storage: {
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    },
    writable: true,
    configurable: true,
  });
}

/**
 * The shared highlighter, loaded before any test mounts a viewer.
 *
 * `@pierre/diffs` 1.4.0 made `CodeView.isReady` wait for it. With
 * `disableWorkerPool` — which this project always sets, and which leaves the
 * viewer with no worker manager at all — 1.3.6 answered `true` on the spot and
 * projected the custom headers synchronously. 1.4.1 renders *nothing* until
 * `preloadHighlighter` has resolved and the themes are attached, and then
 * re-renders itself, which is a better first paint and a worse test fixture:
 * the first viewer mounted in a fresh module registry projects its headers one
 * macrotask late and every later one is synchronous. That makes "is this test
 * the first in its file?" something the assertions depend on, and the failure
 * it produces — a card that is simply not there — says nothing about why.
 *
 * Warming it here is the same job as the polyfills above: hand jsdom the thing
 * the library expects a browser to have done already. No theme is named for
 * the same reason `DiffColumn` names none, and `preferredHighlighter` is left
 * unset so this takes the WebAssembly-free path the extension itself takes.
 * Whether the real page paints promptly is a browser question, and
 * `e2e/review.spec.ts` waits for a card before it asserts anything.
 */
await preloadHighlighter({ themes: getThemes(DEFAULT_THEMES), langs: [] });
