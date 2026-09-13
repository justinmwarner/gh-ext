/**
 * The two glyphs both rails draw.
 *
 * Extracted rather than copied. The review page's `ViewSwitcher` and the
 * standalone pages' `NavRail` show the same two destinations, and two copies
 * of a path definition is how one of them quietly stops matching the other.
 *
 * Drawn rather than imported from an icon package, like every other glyph
 * here: this project takes no dependency it can avoid, and these are 16px of
 * path data.
 */

/** A gear. */
export function OptionsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9.05 1.2a.75.75 0 0 1 .72.54l.35 1.2c.3.13.58.29.85.47l1.2-.34a.75.75 0 0 1 .85.35l1.05 1.82a.75.75 0 0 1-.13.91l-.9.85a5.5 5.5 0 0 1 0 .98l.9.85a.75.75 0 0 1 .13.91l-1.05 1.82a.75.75 0 0 1-.85.35l-1.2-.34c-.27.18-.55.34-.85.47l-.35 1.2a.75.75 0 0 1-.72.54H6.95a.75.75 0 0 1-.72-.54l-.35-1.2a5.4 5.4 0 0 1-.85-.47l-1.2.34a.75.75 0 0 1-.85-.35L1.93 9.98a.75.75 0 0 1 .13-.91l.9-.85a5.5 5.5 0 0 1 0-.98l-.9-.85a.75.75 0 0 1-.13-.91l1.05-1.82a.75.75 0 0 1 .85-.35l1.2.34c.27-.18.55-.34.85-.47l.35-1.2a.75.75 0 0 1 .72-.54ZM8 5.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z"
      />
    </svg>
  );
}

/**
 * GitHub's own pull request shape: a branch leaving a line, and a node on each.
 *
 * Borrowed rather than invented, which is the rule for every control here —
 * DESIGN.md asks that a reviewer would not look at a new component twice, and
 * this is the one glyph in the product every reviewer already knows the
 * meaning of.
 */
export function PullRequestsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4.25 2.5a1.75 1.75 0 0 1 .75 3.332v4.336a1.75 1.75 0 1 1-1.5 0V5.832A1.75 1.75 0 0 1 4.25 2.5Zm0 1.5a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5Zm0 7.5a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5Zm7.5-1.332V6.75a2.25 2.25 0 0 0-2.25-2.25H8.31l.72-.72a.75.75 0 0 0-1.06-1.06L5.97 4.72a.75.75 0 0 0 0 1.06l2 2a.75.75 0 0 0 1.06-1.06l-.72-.72H9.5a.75.75 0 0 1 .75.75v3.418a1.75 1.75 0 1 0 1.5 0Zm-.75 1.332a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5Z"
      />
    </svg>
  );
}
