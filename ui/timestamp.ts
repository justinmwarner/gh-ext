/**
 * The instant, machine-readable; the words, however the reader's OS says them.
 *
 * Shared because two surfaces show the same comment's time — the thread in the
 * diff and the entry in the Conversations view — and two copies of a date
 * format is two ways for the same comment to claim two different times.
 */
export function formatTimestamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A commit's date, as a date and nothing else.
 *
 * ISO rather than the reader's locale, and shared for the same reason
 * `formatTimestamp` is: two surfaces list the same commit — the picker and the
 * Overview's log — and two date formats is two ways for one commit to look
 * like two.
 */
export function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(0, 10);
}
