/**
 * No token, or a token GitHub refused.
 *
 * Both arrive as `kind: 'auth'` and both have the same remedy, so they are one
 * state rather than two near-identical ones separated by string-matching an
 * error message. The worker's own words go in the detail line, which is where
 * "No GitHub token configured" and "Bad credentials" actually differ.
 *
 * This is the first screen a new install shows. It leads with what to do.
 */

import type { PrRef, ProtocolError } from '@/lib/messages';
import { FullPage } from './FullPage';
import { OpenInGitHub } from './OpenInGitHub';
import { openOptions } from './openOptions';

export function SetupState({ pr, error }: { pr: PrRef | null; error: ProtocolError }) {
  return (
    <FullPage
      title="Connect your GitHub account"
      actions={
        <>
          <button type="button" className="button primary" onClick={openOptions}>
            Open options
          </button>
          {pr !== null && <OpenInGitHub pr={pr} />}
        </>
      }
    >
      <p>
        Fast GitHub Review reads pull requests with a GitHub token of your own —
        nothing goes anywhere else. Paste a fine-grained personal access token on
        the options page and this pull request will load.
      </p>
      <p>
        The token needs read access to the repositories you review, plus write
        access to pull requests if you want to leave comments.
      </p>
      <p className="detail">{error.message}</p>
    </FullPage>
  );
}
