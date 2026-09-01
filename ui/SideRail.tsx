/**
 * The left rail: an Overview disclosure on top, the file tree below it.
 *
 * Both are empty this task. The frame is here so the tasks that fill them have
 * a place to land, and so the layout is settled before there is content to
 * argue with.
 */

export function SideRail({ width }: { width: number }) {
  return (
    <aside className="rail" style={{ width: `${width}px` }}>
      <details className="overview" open>
        <summary>Overview</summary>
        <p className="placeholder">
          The description, per-check statuses, reviewer states and unresolved
          threads go here.
        </p>
      </details>

      <nav className="filetree" aria-label="Changed files">
        <p className="placeholder">The file tree goes here.</p>
      </nav>
    </aside>
  );
}
