/**
 * The left rail's Overview disclosure.
 *
 * Four things the diff column cannot show, in the order a reviewer wants them:
 * what this change claims to do, whether CI agrees, who else has looked, and
 * what is still outstanding.
 *
 * The last of those is not a convenience. A file's unanchorable-thread section
 * is rendered by `CodeView`'s custom header, so it exists only once the column
 * has drawn that file — and `files` is capped while `reviewThreads` is followed
 * separately, so some threads have no file card at all. This list is therefore
 * the only global index of open threads in the application, and it lists them
 * whether or not the column can scroll to them.
 */

import { useMemo } from 'react';
import type { PrPayload } from '@/lib/messages';
import { type CheckContext, checksSummary } from './checks';
import { htmlToParagraphs } from './prBody';
import { prPermalink, prReviewers } from './prNode';
import { reviewerLabel, reviewerTone } from './reviewerLabel';
import { useReviewSession } from './reviewSession';
import { unresolvedJumps } from './reviewThreads';

export interface OverviewProps {
  payload: PrPayload;
  /** The paths the diff column has cards for, in the order it shows them. */
  paths: readonly string[];
  onJumpToThread: (threadId: string, path: string) => void;
}

function Description({ payload }: { payload: PrPayload }) {
  const paragraphs = useMemo(
    () => htmlToParagraphs(payload.pullRequest['bodyHTML']),
    [payload.pullRequest],
  );
  const permalink = prPermalink(payload.pullRequest);

  if (paragraphs.length === 0) {
    return <p className="placeholder">No description.</p>;
  }

  return (
    <>
      {paragraphs.map((text, index) => (
        // Paragraph text, not markup: `bodyHTML` is reduced to words and handed
        // to React as a text child, which escapes it.
        <p className="overview-text" key={index}>
          {text}
        </p>
      ))}
      <p className="overview-note" role="note">
        {'Formatting is not shown here. '}
        {permalink !== null && <a href={permalink}>Read it on GitHub</a>}
      </p>
    </>
  );
}

function CheckRow({ context }: { context: CheckContext }) {
  return (
    <li className={`check check-${context.tone}`}>
      <span className="check-name">{context.name}</span>
      <span className={`chip chip-${context.tone}`}>{context.label}</span>
      {context.detail !== null && <span className="check-detail">{context.detail}</span>}
      {context.url !== null && (
        <a className="check-link" href={context.url}>
          Details
        </a>
      )}
    </li>
  );
}

function Checks({ payload }: { payload: PrPayload }) {
  const summary = useMemo(() => checksSummary(payload.checks), [payload.checks]);

  // Null is "no CI is configured on the head commit", which is neither an
  // error nor a check that has not finished.
  if (summary.kind === 'none' || summary.contexts.length === 0) {
    return <p className="placeholder">No checks on this commit.</p>;
  }

  return (
    <>
      <ul className="checks-list" aria-label="Checks">
        {summary.contexts.map((context) => (
          <CheckRow context={context} key={context.key} />
        ))}
      </ul>
      {summary.withheld > 0 && (
        <p className="overview-note" role="note">
          {`${summary.withheld} more checks were not returned by GitHub.`}
        </p>
      )}
    </>
  );
}

function Reviewers({ payload }: { payload: PrPayload }) {
  const reviewers = useMemo(() => prReviewers(payload.pullRequest), [payload.pullRequest]);

  if (reviewers.length === 0) {
    return <p className="placeholder">No reviewers yet.</p>;
  }

  return (
    <ul className="reviewer-states" aria-label="Reviewers">
      {reviewers.map((reviewer) => (
        <li
          // A team slug may equal a user login; the kind keeps the keys apart.
          key={`${reviewer.kind}:${reviewer.login}`}
          className={`reviewer-state reviewer-${reviewerTone(reviewer)}`}
        >
          {reviewerLabel(reviewer)}
        </li>
      ))}
    </ul>
  );
}

function Unresolved({
  paths,
  onJumpToThread,
}: {
  paths: readonly string[];
  onJumpToThread: OverviewProps['onJumpToThread'];
}) {
  const session = useReviewSession();
  const jumps = useMemo(
    () => unresolvedJumps(session.threads, paths),
    [session.threads, paths],
  );

  if (jumps.length === 0) {
    return <p className="placeholder">No unresolved comments.</p>;
  }

  return (
    <ul className="jump-list" aria-label="Unresolved comments">
      {jumps.map((jump) => (
        <li key={jump.threadId}>
          <button
            type="button"
            className="jump-entry"
            onClick={() => onJumpToThread(jump.threadId, jump.path)}
          >
            <span className="jump-path">{jump.path}</span>
            <span className="jump-position">{jump.position}</span>
            {jump.excerpt !== '' && <span className="jump-excerpt">{jump.excerpt}</span>}
            {!jump.inDiff && (
              // The column has no card to scroll to. Saying so is the whole
              // reason this entry is here rather than dropped.
              <span className="jump-absent">Not in this diff</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Overview({ payload, paths, onJumpToThread }: OverviewProps) {
  return (
    <div className="overview-body">
      <section className="overview-section">
        <h2>Description</h2>
        <Description payload={payload} />
      </section>

      <section className="overview-section">
        <h2>Checks</h2>
        <Checks payload={payload} />
      </section>

      <section className="overview-section">
        <h2>Reviewers</h2>
        <Reviewers payload={payload} />
      </section>

      <section className="overview-section">
        <h2>Unresolved comments</h2>
        <Unresolved paths={paths} onJumpToThread={onJumpToThread} />
      </section>
    </div>
  );
}
