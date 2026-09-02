/**
 * Finding the viewer's open PENDING review.
 *
 * GitHub allows one per pull request and refuses to open a second. Both of the
 * ways this extension writes a comment start by opening one, so a reviewer who
 * already had a review open — started in another tab, or in GitHub's own UI, or
 * left behind by an earlier version of this extension — could do neither.
 *
 * The query asks two ways because it is not established that
 * `viewerLatestReview` reports a review that has not been given yet. Reading it
 * has to work whichever way answers, and has to survive both answering with
 * different things.
 */

import { describe, expect, it } from 'vitest';
import { readPendingReviewId } from './pending-review-lookup';

const wrap = (pullRequest: unknown) => ({ repository: { pullRequest } });

describe('readPendingReviewId', () => {
  it('reads it from the reviews connection', () => {
    const id = readPendingReviewId(
      wrap({
        viewerLatestReview: null,
        reviews: { nodes: [{ id: 'PRR_open', state: 'PENDING' }] },
      }),
    );

    expect(id).toBe('PRR_open');
  });

  it('reads it from viewerLatestReview when that is the field that answers', () => {
    const id = readPendingReviewId(
      wrap({ viewerLatestReview: { id: 'PRR_open', state: 'PENDING' }, reviews: null }),
    );

    expect(id).toBe('PRR_open');
  });

  it('agrees with itself when both answer', () => {
    const id = readPendingReviewId(
      wrap({
        viewerLatestReview: { id: 'PRR_open', state: 'PENDING' },
        reviews: { nodes: [{ id: 'PRR_open', state: 'PENDING' }] },
      }),
    );

    expect(id).toBe('PRR_open');
  });

  it('ignores a review the viewer already submitted', () => {
    // The overwhelmingly common case: a finished review is not an open one, and
    // treating it as one would queue every later comment onto something that
    // has already been sent.
    const id = readPendingReviewId(
      wrap({
        viewerLatestReview: { id: 'PRR_done', state: 'APPROVED' },
        reviews: { nodes: [] },
      }),
    );

    expect(id).toBeNull();
  });

  it('ignores a non-pending review that turns up in the connection', () => {
    const id = readPendingReviewId(
      wrap({ viewerLatestReview: null, reviews: { nodes: [{ id: 'PRR_x', state: 'COMMENTED' }] } }),
    );

    expect(id).toBeNull();
  });

  it('takes the last of several, which is the most recent', () => {
    // `reviews(last: 20)` is oldest-first. There should never be two, but if
    // GitHub ever returns two the newer one is the one still being written.
    const id = readPendingReviewId(
      wrap({
        viewerLatestReview: null,
        reviews: {
          nodes: [
            { id: 'PRR_older', state: 'PENDING' },
            { id: 'PRR_newer', state: 'PENDING' },
          ],
        },
      }),
    );

    expect(id).toBe('PRR_newer');
  });

  it('returns null rather than throwing on anything unexpected', () => {
    // Parsed JSON off the network, and this runs on a failure path. Throwing
    // here would replace a recoverable error with an unrecoverable one.
    for (const junk of [undefined, null, 'nope', 42, {}, wrap(null), wrap({})]) {
      expect(readPendingReviewId(junk)).toBeNull();
    }
  });

  it('ignores an id that is not a usable string', () => {
    // Entering Pending with an empty id sends every later comment to
    // `pullRequestReviewId: ''`, which is worse than not finding one at all.
    expect(
      readPendingReviewId(wrap({ viewerLatestReview: { id: '', state: 'PENDING' } })),
    ).toBeNull();
    expect(
      readPendingReviewId(wrap({ reviews: { nodes: [{ id: 7, state: 'PENDING' }] } })),
    ).toBeNull();
  });
});
