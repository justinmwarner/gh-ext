/**
 * A byte count, for a card rather than for a log.
 *
 * Rounded to whole kilobytes above a kilobyte, because nothing on a review page
 * is decided by the third digit of a file size, and grouped by the reviewer's
 * locale so that a six-figure size is readable at a glance.
 */
export const kb = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024).toLocaleString()} KB`;
