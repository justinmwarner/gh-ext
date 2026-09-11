/**
 * The two things an `aria-modal` dialog owes the keyboard.
 *
 * Every overlay on this page already declared `aria-modal="true"` and drew a
 * backdrop over the whole viewport, so both assistive technology and the eye
 * were told the page behind was out of reach. The keyboard was not: Tab walked
 * out of the panel, under the scrim, into the top bar and the diff and the
 * footer, all of which were still operable. That contradiction is the bug —
 * either the dialog is modal or it is not, and these look modal.
 *
 * Trapping Tab here is what makes `aria-modal` true rather than aspirational.
 * The background is left alone rather than marked `inert`: `aria-modal` already
 * removes it from the accessibility tree, and `.shell` is a grid whose children
 * are the top bar, the body and the footer, so there is no single element to
 * mark without either restructuring that grid or threading a prop through three
 * components.
 *
 * The second half is giving the keyboard back. Closing an overlay used to drop
 * focus on `<body>`, so the next Tab restarted at the top of the document —
 * after a reviewer had pressed `/` from somewhere deep in a large diff. The two
 * overlays that got this right, `MenuButton` and `NoticeCenter`, both restore to
 * their trigger; these three had no trigger element to restore to, which is why
 * the previously focused node is captured instead.
 *
 * Focusing something *inside* the panel on mount is deliberately not done here.
 * The three callers disagree about what that should be — the search panel wants
 * its input, the other two want the panel itself — and that choice belongs to
 * them.
 */

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Everything that can hold focus, in tab order.
 *
 * The panel itself carries `tabIndex={-1}` so it can be focused on open without
 * becoming a tab stop, which is exactly what `:not([tabindex="-1"])` keeps out.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalFocus(panel: RefObject<HTMLElement | null>): void {
  /*
   * Captured during the first render, not in the effect below.
   *
   * Effects run in declaration order, and every caller declares its own
   * "focus something inside me" effect above this hook — so by the time an
   * effect here could read `document.activeElement`, the panel already has it
   * and the element worth returning to is lost. Rendering happens before any
   * of them. Writing a ref during render is sanctioned for exactly this kind
   * of lazy initialisation, and `undefined` distinguishes "not captured yet"
   * from a genuine `null` active element.
   */
  const returnTo = useRef<Element | null | undefined>(undefined);
  if (returnTo.current === undefined) returnTo.current = document.activeElement;

  useEffect(() => {
    const node = panel.current;
    if (node === null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;

      const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // `offsetParent` is null for anything `display: none`, which is how a
        // panel hides a row it is not currently offering.
        (element) => element.offsetParent !== null,
      );

      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing to move between, so the only correct answer is to stay.
        event.preventDefault();
        return;
      }

      // Focus can sit on the panel itself, which is not one of the stops. From
      // there Tab belongs at one end or the other rather than out of the dialog.
      const at = document.activeElement;
      if (event.shiftKey && (at === first || at === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && at === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // Only if it is still there. Choosing a search result unmounts the row
      // that was focused, and a file card can be gone by the time the picker
      // that changed the scope closes.
      const back = returnTo.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [panel]);
}
