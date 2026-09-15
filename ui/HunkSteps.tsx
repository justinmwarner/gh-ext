/**
 * How many changed sections this file has, and where in them the reviewer is.
 *
 * On `FileCard`'s head row, which `stickyHeaders` pins for the whole length of
 * a long file — the only place in the layout that is both always visible and
 * unambiguously about one file. That is the whole reason this surface exists:
 * `J` and `K` have stepped between sections since the keyboard did, and a
 * reviewer who has never pressed `?` has no way to know it, nor any way to see
 * that the file they are scrolling has eleven more changes in it.
 *
 * **It subscribes rather than taking props.** `DiffColumn.renderHeader` is
 * memoized and `SlotPortals` watches its identity: a cursor threaded down as a
 * prop would rebuild every mounted card, thread and composer on every hunk
 * boundary, which is the exact cost the store exists to avoid. The path is the
 * only thing it needs from above, and that never changes for a given card.
 *
 * **Nothing at all on a single-section file.** A "1 of 1" on every card with
 * one hunk is chrome on most cards in most pull requests, and the row it would
 * sit on is the row a reviewer reads to decide whether to open the file.
 *
 * **Arrows only on the card the reviewer is on.** They step the global list —
 * the same one `J` steps, which runs off the end of one file into the next —
 * so on any other card they would move the review somewhere with no relation
 * to the header they were pressed from. Every other card keeps the count,
 * which is the half that is still true there.
 */

import { fileRun, positionInFile } from '@/lib/review/hunkNav';
import { useHunkCursor, useHunkNav } from './hunkCursor';

export function HunkSteps({ path }: { path: string }) {
  const { stops, index } = useHunkCursor();
  const nav = useHunkNav();

  const run = fileRun(stops, path);
  // One section is not a sequence, and nothing here would help a reviewer.
  if (run.count < 2) return null;

  const here = index >= run.start && index < run.start + run.count;
  const position = here ? positionInFile(stops, index) : null;

  if (position === null || nav === null) {
    return (
      <span className="hunk-steps" data-hunk-steps={path}>
        <span className="hunk-steps-count">{`${run.count} changes`}</span>
      </span>
    );
  }

  return (
    <span className="hunk-steps" data-hunk-steps={path}>
      <button
        type="button"
        className="hunk-step"
        aria-label="Previous change"
        // The shortcut is named in the tooltip rather than advertised
        // separately: a reviewer who reaches for the button is exactly the
        // reviewer who has not found the key yet.
        title="Previous change (K)"
        disabled={index <= 0}
        onClick={() => nav.step(-1)}
      >
        <span aria-hidden="true">▲</span>
      </button>

      {/* Not `aria-live`. It changes on every scroll frame that crosses a
          section, and a region that announces "Change 4 of 12" over and over
          while somebody scrolls is worse than silence. The buttons name
          themselves, and the count is there to be read. */}
      <span className="hunk-steps-count">
        {`Change ${position.n} of ${position.of}`}
      </span>

      <button
        type="button"
        className="hunk-step"
        aria-label="Next change"
        title="Next change (J)"
        disabled={index >= stops.length - 1}
        onClick={() => nav.step(1)}
      >
        <span aria-hidden="true">▼</span>
      </button>
    </span>
  );
}
