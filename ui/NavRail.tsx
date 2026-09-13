/**
 * The rail the two standalone pages share.
 *
 * The review page has its own — `ViewSwitcher` — built around its three views,
 * with these same two destinations pinned below them. The options page and the
 * dashboard have no views at all, so what they need is that strip without the
 * tablist: the same two names, in the same order, with a mark saying which one
 * you are on.
 *
 * It exists because the two pages were reachable from the review page and not
 * from each other. A reviewer on the options page ticking repositories had no
 * way back to the list they were configuring except the browser's Back button,
 * and the dashboard could not reach options at all.
 *
 * The icons come from `navIcons.tsx` rather than being redrawn, so the two
 * rails cannot drift apart.
 */

import { DASHBOARD_HASH } from '@/lib/github/pr-url';
import { OptionsIcon, PullRequestsIcon } from './navIcons';
import { extensionUrl } from './extensionUrl';
import { openOptions } from './openOptions';
import './NavRail.css';

export type NavPage = 'dashboard' | 'options';

/** The dashboard's own document, which is the review page at its list route. */
const DASHBOARD_PATH = `/review.html${DASHBOARD_HASH}`;

export function NavRail({ current }: { current: NavPage }) {
  return (
    <nav className="navrail" aria-label="Pages">
      <ul className="navrail-list">
        <li>
          {current === 'dashboard' ? (
            <span className="view-tab navrail-item" aria-current="page">
              <span className="view-icon">
                <PullRequestsIcon />
              </span>
              <span className="view-label">Pull requests</span>
            </span>
          ) : (
            // An absolute URL, not `#/prs`: from options.html a bare fragment
            // would set this page's own hash and go nowhere.
            <a className="view-tab navrail-item" href={extensionUrl(DASHBOARD_PATH)}>
              <span className="view-icon">
                <PullRequestsIcon />
              </span>
              <span className="view-label">Pull requests</span>
            </a>
          )}
        </li>
        <li>
          {current === 'options' ? (
            <span className="view-tab navrail-item" aria-current="page">
              <span className="view-icon">
                <OptionsIcon />
              </span>
              <span className="view-label">Options</span>
            </span>
          ) : (
            // `runtime.openOptionsPage` rather than a link, which is what
            // `ViewSwitcher` does and for the same reason: it reveals an
            // options tab that is already open instead of making a second one.
            <button type="button" className="view-tab navrail-item" onClick={openOptions}>
              <span className="view-icon">
                <OptionsIcon />
              </span>
              <span className="view-label">Options</span>
            </button>
          )}
        </li>
      </ul>
    </nav>
  );
}
