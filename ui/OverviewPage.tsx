/**
 * The rail's Overview page: what the diff column cannot show about the change.
 *
 * Three things, in the order a reviewer wants them: what this change claims to
 * do, whether CI agrees, and who else has looked.
 *
 * What is *outstanding* used to be a fourth section here, and it has moved to
 * the Conversations page. It is the thing a reviewer returns to most, and it
 * sat below a description of arbitrary length.
 */

import { useMemo } from 'react';
import type { PrPayload } from '@/lib/messages';
import { type CheckContext, checksSummary } from './checks';
import { htmlToParagraphs } from './prBody';
import { prPermalink, prReviewers } from './prNode';
import { reviewerLabel, reviewerTone } from './reviewerLabel';

export interface OverviewPageProps {
  payload: PrPayload;
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

export function OverviewPage({ payload }: OverviewPageProps) {
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
    </div>
  );
}
