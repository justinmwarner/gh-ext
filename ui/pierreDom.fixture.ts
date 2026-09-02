/**
 * Reaching into what `@pierre/diffs` actually rendered.
 *
 * Test support only. Two things about this project cannot be checked from the
 * light DOM alone, and both are load-bearing:
 *
 * - **Whether an annotation is displayed at all.** React puts every annotation
 *   into a light-DOM `<div slot="annotation-…">` whether or not the row exists.
 *   If the line was not rendered there is no matching `<slot>` in the shadow
 *   root, the node is unassigned, and the browser draws nothing — silently.
 *   `assignedSlot` is the only honest test of "the reviewer can see this".
 * - **The gutter "+" affordance.** It is created on hover and lives in the
 *   shadow root, so driving it means dispatching composed pointer events at the
 *   real elements rather than clicking something in the page.
 *
 * `pointerType: 'mouse'` is not optional: `InteractionManager.handlePointerMove`
 * returns immediately for any other pointer type, and the "+" never appears.
 */

export type AnnotationSide = 'additions' | 'deletions';

const POINTER: PointerEventInit = {
  bubbles: true,
  composed: true,
  cancelable: true,
  pointerId: 1,
  pointerType: 'mouse',
};

/** The `<diffs-container>` for one file, found through the header we render. */
export function fileHost(path: string): HTMLElement {
  // No `CSS.escape` — jsdom does not implement the `CSS` interface, and every
  // path in these tests is an ordinary one.
  const card = document.querySelector(`[data-file-card="${path}"]`);
  const host = card?.closest('diffs-container');
  if (!(host instanceof HTMLElement)) {
    throw new Error(`no diff container rendered for ${path}`);
  }
  return host;
}

export function fileShadow(path: string): ShadowRoot {
  const root = fileHost(path).shadowRoot;
  if (root === null) throw new Error(`the diff for ${path} has no shadow root`);
  return root;
}

/** True once the diff for this file has rows to interact with. */
export function diffHasRendered(path: string): boolean {
  try {
    return fileShadow(path).querySelector('[data-column-number]') !== null;
  } catch {
    return false;
  }
}

/**
 * The light-DOM node holding one annotation, or null if none was emitted.
 *
 * A non-null result does **not** mean it is visible — check `assignedSlot`.
 */
export function annotationNode(
  path: string,
  side: AnnotationSide,
  lineNumber: number,
): HTMLElement | null {
  return fileHost(path).querySelector<HTMLElement>(
    `[slot="annotation-${side}-${lineNumber}"]`,
  );
}

/** Whether the shadow row for this annotation exists, so the reviewer sees it. */
export function annotationIsVisible(
  path: string,
  side: AnnotationSide,
  lineNumber: number,
): boolean {
  return annotationNode(path, side, lineNumber)?.assignedSlot != null;
}

const LINE_TYPES: Record<AnnotationSide, string[]> = {
  additions: ['change-addition', 'context'],
  deletions: ['change-deletion', 'context'],
};

/** The line-number cell for one line on one side. */
export function gutterCell(
  path: string,
  lineNumber: number,
  side: AnnotationSide,
): HTMLElement {
  const wanted = LINE_TYPES[side];
  for (const element of fileShadow(path).querySelectorAll('[data-column-number]')) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.getAttribute('data-column-number') !== String(lineNumber)) continue;
    if (wanted.includes(element.getAttribute('data-line-type') ?? '')) return element;
  }
  throw new Error(`no ${side} gutter cell for line ${lineNumber} of ${path}`);
}

function utilityButton(path: string): HTMLElement {
  const button = fileShadow(path).querySelector('[data-utility-button]');
  if (!(button instanceof HTMLElement)) {
    throw new Error(`the gutter utility button is not showing on ${path}`);
  }
  return button;
}

/** Hover a line's gutter, then click the "+" that appears there. */
export function clickGutterUtility(
  path: string,
  lineNumber: number,
  side: AnnotationSide,
): void {
  gutterCell(path, lineNumber, side).dispatchEvent(
    new PointerEvent('pointermove', POINTER),
  );
  const button = utilityButton(path);
  button.dispatchEvent(new PointerEvent('pointerdown', POINTER));
  button.dispatchEvent(new PointerEvent('pointerup', POINTER));
}

/**
 * The expand affordance on a hunk separator, if Pierre drew one.
 *
 * It only exists when the diff can grow: a patch-parsed diff is `isPartial`,
 * and Pierre renders no expander at all for one unless a `loadDiffFiles` loader
 * has been supplied. So "is this null" is the honest test of whether the
 * loader reached the renderer.
 */
export function hunkExpander(path: string): HTMLElement | null {
  const found = fileShadow(path).querySelector('[data-expand-button]');
  return found instanceof HTMLElement ? found : null;
}

/**
 * Press it.
 *
 * `InteractionManager` acts on a composed `click`, not on the pointer sequence
 * the gutter "+" needs, so this is an ordinary click that crosses the shadow
 * boundary.
 */
export function clickHunkExpander(path: string): void {
  const button = hunkExpander(path);
  if (button === null) {
    throw new Error(`no hunk expander is showing on ${path}`);
  }
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

export interface GutterPoint {
  lineNumber: number;
  side: AnnotationSide;
}

/** Press the "+" on one line and release on another — Pierre's drag-to-range. */
export function dragGutterUtility(
  path: string,
  from: GutterPoint,
  to: GutterPoint,
): void {
  gutterCell(path, from.lineNumber, from.side).dispatchEvent(
    new PointerEvent('pointermove', POINTER),
  );
  utilityButton(path).dispatchEvent(new PointerEvent('pointerdown', POINTER));

  const end = gutterCell(path, to.lineNumber, to.side);
  end.dispatchEvent(new PointerEvent('pointermove', POINTER));
  end.dispatchEvent(new PointerEvent('pointerup', POINTER));
}
