/**
 * "3 more changes in this file", at the foot of the diff, and only when true.
 *
 * The failure this exists to prevent is specific: a reviewer reaches what
 * looks like the end of a file's changes, marks it viewed and moves on, and
 * the change they never saw was a screen further down. GitHub has the same
 * hole and so did this page.
 *
 * **It is about the current file, not about the review.** Scoping it to
 * "anything below anywhere" would be simpler and would never under-warn, and
 * it would also be lit for almost the entire review — which makes it chrome
 * rather than a signal, and a reviewer stops seeing it by the third file. The
 * rail beside the diff and the file tree carry the cross-file question; this
 * carries the one moment where a reviewer is about to be wrong.
 *
 * `below` is computed in `ui/hunkPosition.ts`, which over-reports rather than
 * under-reports whenever its probe cannot see. That direction is the whole
 * point: appearing once too often costs a glance, and failing to appear costs
 * the thing this was built for.
 */

import { useHunkCursor, useHunkNav } from './hunkCursor';

export function MoreBelow() {
  const { below } = useHunkCursor();
  const nav = useHunkNav();

  if (below <= 0 || nav === null) return null;

  return (
    <div className="more-below">
      {/*
        A button and nothing more — no `role="status"`, no `aria-live`.
        This appears, changes and disappears as the reviewer scrolls, and a
        live region would read "3 more changes in this file" over and over
        through every scroll. It is reachable in the tab order and it names
        itself, which is the honest way for it to be available.
      */}
      <button type="button" className="more-below-pill" onClick={() => nav.step(1)}>
        {below === 1 ? '1 more change in this file' : `${below} more changes in this file`}
        <span aria-hidden="true"> ↓</span>
      </button>
    </div>
  );
}
