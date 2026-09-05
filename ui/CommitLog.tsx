/**
 * The pull request's commits, with their subjects, on the Overview.
 *
 * The numbered strip above the diff is deliberately mute: a strip of subjects
 * is unscannable, and what a reviewer is doing up there is stepping along a
 * history they are already reading. This is the other half of that trade — the
 * one place the numbers get their subjects back, so a reviewer can decide
 * *which* commit to read before they are inside it. The numbering is the same
 * on both surfaces, or the two controls are lying about each other.
 *
 * Two things a row does, and they are two controls on purpose. Choosing the
 * row scopes the diff to that commit and takes you to it; the link opens it on
 * GitHub. One click that did both would make "let me read this properly" mean
 * "leave the page", and neither is guessable from the other.
 */

import type { PrCommit } from '@/lib/github/types';
import type { PrRef } from '@/lib/messages';
import { commitUrl } from './githubUrl';
import { shortDate } from './timestamp';

export interface CommitLogProps {
  /** Oldest first, the order GitHub returns and the branch reads in. */
  commits: readonly PrCommit[];
  pr: PrRef;
  /** Scope the diff to this commit and go and look at it. */
  onReview: (commit: PrCommit) => void;
}

const author = (commit: PrCommit): string =>
  commit.authorLogin ?? commit.authorName ?? 'unknown author';

export function CommitLog({ commits, pr, onReview }: CommitLogProps) {
  // A pull request has at least one commit, so an empty list is never the
  // honest answer — it means the lookup came back with nothing, which is a
  // different thing and the reviewer should not have to guess which.
  if (commits.length === 0) {
    return (
      <p className="placeholder">This pull request’s commits could not be read.</p>
    );
  }

  return (
    <ol className="commit-log" aria-label="Commits">
      {commits.map((commit, index) => (
        <li className="commit-log-row" key={commit.oid}>
          <button
            type="button"
            className="commit-log-open"
            // Named rather than merely labelled: "2" is the whole of what a
            // screen reader would otherwise get, and it says nothing about
            // which change it is.
            aria-label={`Review commit ${index + 1}, ${commit.abbreviatedOid}, ${commit.messageHeadline}`}
            onClick={() => onReview(commit)}
          >
            <span className="commit-log-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="commit-log-headline">{commit.messageHeadline}</span>
            <span className="commit-log-meta">
              <code>{commit.abbreviatedOid}</code>
              {' · '}
              {author(commit)}
              {' · '}
              {shortDate(commit.committedDate)}
            </span>
          </button>

          <a
            className="commit-log-link"
            href={commitUrl(pr, commit.oid)}
            aria-label={`Open commit ${commit.abbreviatedOid} on GitHub`}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                d="M6 3h7v7M13 3 6.5 9.5M11 10.5V13H3V5h2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </li>
      ))}
    </ol>
  );
}
