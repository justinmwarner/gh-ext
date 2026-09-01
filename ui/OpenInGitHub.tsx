/**
 * The escape hatch.
 *
 * Present on every state this page can get stuck in. Whatever went wrong here,
 * the reviewer still has a pull request to read, and GitHub's own page is one
 * click away.
 */

import type { PrRef } from '@/lib/messages';
import { pullRequestUrl } from './githubUrl';

export function OpenInGitHub({ pr, href }: { pr: PrRef; href?: string | null }) {
  return (
    <a
      className="button"
      // The permalink from the API when we have one — it survives a repository
      // rename — and the route otherwise, which is all an error state has.
      href={href ?? pullRequestUrl(pr)}
      target="_blank"
      rel="noopener noreferrer"
    >
      Open in GitHub
    </a>
  );
}
