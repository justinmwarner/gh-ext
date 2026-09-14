/**
 * The shape of a diff, while the diff itself is being fetched.
 *
 * One case only: the reviewer pressed a commit tab and the compare between
 * those two commits has not come back. Everything on screen is derived from
 * one file list, and until that request answers the only list available is the
 * whole pull request's — so the page used to draw *that*, in full, and then
 * replace it. Pressing "commit 3" flashed all nineteen files and then showed
 * the two that commit touched, which reads as the control having done the
 * wrong thing and corrected itself.
 *
 * **`LoadingState` is not the precedent here, and says why itself.** Its
 * argument — "nothing at all, until the wait is long enough that silence would
 * read as a broken page" — is about the payload, which a content script has
 * usually prefetched before the review page opens, so the wait is often a
 * single frame and a spinner drawn and torn down inside it is a glitch. A
 * compare is always a round trip, and always displaces something already
 * drawn. Those are the two conditions a skeleton is actually for, so this one
 * appears immediately and takes no quiet window.
 *
 * What it draws is the rail and the column, at their real widths, in the
 * proportions a file list has: a few rows on the left, a card header and some
 * lines of diff on the right. Not because the guess will be right — it will
 * not be — but because the alternative is the page collapsing to nothing and
 * springing back, which costs more than an approximate placeholder does.
 *
 * The pulse is `background-color` and nothing else. DESIGN.md allows colour,
 * transform and opacity, "and on the review page really just colour"; a
 * skeleton that animated width or opacity would be the one piece of the
 * product breaking a rule the rest of it keeps. `prefers-reduced-motion` turns
 * it off and leaves the shapes, which are the informative part.
 */

/** Enough rows to read as a list rather than as an accident. */
const ROWS = 9;

/** Varied so the rail reads as file names, not as a bar chart. */
const RAIL_WIDTHS = [72, 58, 81, 64, 45, 76, 52, 68, 60];

/** A header, then hunks: the silhouette of one card in the column. */
const LINES = [96, 88, 62, 91, 70, 84, 55, 78, 93, 66, 87, 59];

export function DiffSkeleton() {
  return (
    <div
      className="diff-skeleton"
      role="status"
      // Named rather than left to the rows' text, because it has none. This is
      // the only thing a reviewer using a screen reader is told between
      // pressing the tab and the diff arriving, so it says which wait it is —
      // `LoadingState` is already "Loading the pull request".
      aria-label="Loading the diff"
    >
      <div className="skeleton-rail" aria-hidden="true">
        {RAIL_WIDTHS.slice(0, ROWS).map((width, at) => (
          <div className="skeleton-row" key={at}>
            <span className="skeleton-box skeleton-tick" />
            <span className="skeleton-box skeleton-name" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>

      <div className="skeleton-column" aria-hidden="true">
        <div className="skeleton-card">
          <div className="skeleton-header">
            <span className="skeleton-box skeleton-title" />
            <span className="skeleton-box skeleton-counts" />
          </div>
          {LINES.map((width, at) => (
            <div className="skeleton-line" key={at}>
              <span className="skeleton-box skeleton-gutter" />
              <span className="skeleton-box skeleton-code" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
