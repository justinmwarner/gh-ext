/**
 * The failures that are not about authentication.
 *
 * Three of them, kept apart because the reviewer's next move differs: wait, ask
 * for repository access, or try again. Collapsing them into one apology would
 * make every one of those decisions guesswork.
 */

import type { PrRef, ProtocolError } from '@/lib/messages';
import { FullPage } from './FullPage';
import { OpenInGitHub } from './OpenInGitHub';
import { openOptions } from './openOptions';

interface Explanation {
  title: string;
  body: string;
  /** Whether the token is a plausible cause, and so worth offering to change. */
  tokenMayBeAtFault: boolean;
}

/**
 * Does this failure smell like the token?
 *
 * A missing or rejected token arrives as `kind: 'auth'` and never reaches this
 * page. What does reach it are the failures GitHub reports as something else:
 * a fine-grained token that simply does not grant the repository comes back as
 * a plain "not found", and a permission or SSO problem arrives inside a
 * GraphQL error message with no distinguishing code at all.
 *
 * String-matching an error message is not something to do lightly, so it only
 * decides whether to *offer* a settings button. A false positive costs a button
 * nobody needed; a false negative strands the reviewer on a dead end with the
 * one thing that would fix it two menus away.
 */
const TOKEN_SHAPED =
  /token|credential|permission|scope|forbidden|unauthori[sz]ed|not accessible|saml|sso/i;

/**
 * When the quota refills, in words.
 *
 * `resetAt` is null whenever GitHub sent no usable reset header, which happens.
 * Saying so is better than any of the things a naive formatter would print
 * instead — `undefined`, `Invalid Date`, or 1 January 1970.
 */
function whenQuotaRefills(resetAt: number | null): string {
  if (resetAt === null || !Number.isFinite(resetAt)) {
    return 'GitHub did not say when the quota refills, so the only thing to do is wait and reload.';
  }
  return `The quota refills at ${new Date(resetAt).toLocaleString()}.`;
}

function explain(pr: PrRef, error: ProtocolError): Explanation {
  switch (error.kind) {
    case 'rate-limit':
      return {
        title: 'GitHub rate limit reached',
        body: whenQuotaRefills(error.resetAt),
        // Waiting is the remedy. A new token would not refill the quota, and
        // offering one here would send the reviewer somewhere useless.
        tokenMayBeAtFault: false,
      };
    case 'not-found':
      return {
        title: 'This pull request is out of reach',
        body:
          `${pr.owner}/${pr.repo}#${pr.number} either does not exist or your token ` +
          'cannot see it. A fine-grained token has to grant access to each ' +
          'repository individually, and an organisation owner may still need to ' +
          'approve it.',
        // By far the likelier of the two, and the only one the reviewer can act on.
        tokenMayBeAtFault: true,
      };
    default:
      return {
        title: 'Something went wrong',
        body: 'The background worker could not put this pull request together.',
        tokenMayBeAtFault: TOKEN_SHAPED.test(error.message),
      };
  }
}

export function ErrorState({
  pr,
  error,
  retry,
}: {
  pr: PrRef;
  error: ProtocolError;
  /** Ask the worker again. Every failure here is one that may have passed. */
  retry: () => void;
}) {
  const { title, body, tokenMayBeAtFault } = explain(pr, error);

  return (
    <FullPage
      title={title}
      actions={
        <>
          {tokenMayBeAtFault && (
            <button type="button" className="button primary" onClick={openOptions}>
              Check your token
            </button>
          )}
          {/* Offered for every failure, because every one of them can stop
              being true without this page hearing about it — a quota refills,
              an owner approves the token, a network comes back. Telling
              someone to wait and then giving them nothing to press is how a
              recoverable state reads as a dead end. */}
          <button type="button" className="button" onClick={retry}>
            Try again
          </button>
          <OpenInGitHub pr={pr} />
        </>
      }
    >
      <p>{body}</p>
      {tokenMayBeAtFault && (
        <p>
          If you expected access to this repository, the token is the first
          thing to check — it may not grant this repository, may have expired,
          or may be waiting on an organisation owner's approval.
        </p>
      )}
      {/* The worker's own message, verbatim. It is the only part of this page
          that says anything specific about what actually failed. */}
      <p className="detail">{error.message}</p>
    </FullPage>
  );
}
