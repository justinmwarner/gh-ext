/**
 * The banner for a token that has stopped working mid-review.
 *
 * Fine-grained tokens expire — the options page recommends the shortest expiry
 * you can live with — and an organisation owner can revoke one at any moment.
 * Either way the page keeps rendering the pull request it already has, and
 * every mutation from that point on fails.
 *
 * Without this the failure appears as one sentence inside whichever control
 * happened to be pressed: "Posting this comment failed: GitHub rejected the
 * token", in the composer. That is true and useless. It reads as a problem
 * with the comment, so the reviewer retries the comment, then tries another
 * one, and nothing on screen connects the two or says the remedy is on a page
 * two menus away.
 *
 * Deliberately not a full-page state. The pull request on screen is still
 * readable and still worth reading, and replacing it would throw away a diff
 * the reviewer is midway through for a problem that does not affect reading.
 */

import { openOptions } from './openOptions';

export function TokenRejectedNotice({ retry }: { retry: () => void }) {
  return (
    <aside className="denied-notice" role="alert">
      <p>
        GitHub has rejected your token, so nothing can be posted, resolved or
        marked as viewed until it is replaced. The pull request below is what
        was already loaded, and is still safe to read.
      </p>
      <p>
        Fine-grained tokens expire, and an organisation owner can revoke one.
        Check whether yours is still valid, then reload this pull request.
      </p>
      <div className="denied-actions">
        <button type="button" className="button primary" onClick={openOptions}>
          Check your token
        </button>
        <button type="button" className="button" onClick={retry}>
          Reload this pull request
        </button>
      </div>
    </aside>
  );
}
