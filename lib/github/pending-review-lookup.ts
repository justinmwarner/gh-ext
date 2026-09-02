/**
 * Reading `VIEWER_PENDING_REVIEW`.
 *
 * GitHub allows one PENDING review per pull request per person and refuses to
 * open a second — "User can only have one pending review per pull request".
 * Both ways this extension writes a comment begin by opening one, so a reviewer
 * who already had a review open could neither start a review nor post a single
 * comment. Finding the existing one and joining it is the whole fix.
 *
 * The query asks two ways (see its comment), so this reads two ways and takes
 * whichever answers. Everything is defensive: this runs on a failure path, and
 * throwing here would turn a recoverable error into an unrecoverable one.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A review's id, but only if it is pending and the id is usable. */
function pendingId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (value['state'] !== 'PENDING') return null;
  const id = value['id'];
  // An empty id is worse than none: it would send every later comment to
  // `pullRequestReviewId: ''` instead of opening a review of its own.
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * The viewer's open PENDING review, or null.
 *
 * `data` is whatever came back over `runtime.sendMessage`, which is to say
 * unknown. Anything unreadable is "no open review" — the caller then reports
 * the original failure, which is strictly better than a second one.
 */
export function readPendingReviewId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const repository = data['repository'];
  if (!isRecord(repository)) return null;
  const pullRequest = repository['pullRequest'];
  if (!isRecord(pullRequest)) return null;

  const reviews = pullRequest['reviews'];
  const nodes = isRecord(reviews) && Array.isArray(reviews['nodes']) ? reviews['nodes'] : [];
  // `reviews(last: 20)` is oldest-first. There should never be two pending
  // reviews, but if there are, the newer one is the one still being written.
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const id = pendingId(nodes[index]);
    if (id !== null) return id;
  }

  return pendingId(pullRequest['viewerLatestReview']);
}
