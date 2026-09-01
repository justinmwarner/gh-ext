/**
 * The review page opened without a pull request in the hash.
 *
 * Reachable by typing the extension URL by hand, by a stale bookmark, or by a
 * hash this version no longer parses. None of those deserve a blank white page.
 */

import { FullPage } from './FullPage';

export function NoRouteState() {
  return (
    <FullPage title="No pull request here">
      <p>
        This page shows one pull request at a time, and the address does not name
        one.
      </p>
      <p>
        Open a pull request on github.com and use the <strong>Fast review</strong>{' '}
        button to come back with something to read.
      </p>
    </FullPage>
  );
}
