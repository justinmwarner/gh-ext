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
