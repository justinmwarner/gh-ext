/**
 * The banner for a pull request whose lists were cut short.
 *
 * `files` and `reviewThreads` are followed page by page, but not without limit
 * — a connection that keeps promising more must not be allowed to spin the
 * worker. When that cap engages the page really is missing rows, and the one
 * thing it must not do is look complete: a reviewer cannot tell "this file has
 * no comments" from "we stopped reading" unless they are told.
 *
 * So the banner names which list is short and puts GitHub's own page one click
 * away, which is where the rest of it is.
 */

import type { PrRef, PrTruncation } from '@/lib/messages';
import { OpenInGitHub } from './OpenInGitHub';

export function TruncationNotice({
  truncated,
  pr,
  href,
}: {
  truncated: PrTruncation;
  pr: PrRef;
  href?: string | null;
}) {
  const short: string[] = [];
  if (truncated.files) short.push('changed files');
  if (truncated.threads) short.push('review comments');
  if (short.length === 0) return null;

  return (
    // `alert`, not a quiet note: this changes what the rest of the page means.
    <div className="notice truncation-notice" role="alert">
      <span>
        This pull request is large enough that the {short.join(' and ')} below
        {short.length === 1 ? ' is' : ' are'} incomplete. Nothing here is wrong,
        but there is more of it on GitHub.
      </span>
      <OpenInGitHub pr={pr} href={href} />
    </div>
  );
}
