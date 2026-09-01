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

interface Explanation {
  title: string;
  body: string;
}

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
      };
    case 'not-found':
      return {
        title: 'This pull request is out of reach',
        body:
          `${pr.owner}/${pr.repo}#${pr.number} either does not exist or your token ` +
          'cannot see it. A fine-grained token has to grant access to each ' +
          'repository individually.',
      };
    default:
      return {
        title: 'Something went wrong',
        body: 'The background worker could not put this pull request together.',
      };
  }
}

export function ErrorState({ pr, error }: { pr: PrRef; error: ProtocolError }) {
  const { title, body } = explain(pr, error);

  return (
    <FullPage title={title} actions={<OpenInGitHub pr={pr} />}>
      <p>{body}</p>
      {/* The worker's own message, verbatim. It is the only part of this page
          that says anything specific about what actually failed. */}
      <p className="detail">{error.message}</p>
    </FullPage>
  );
}
