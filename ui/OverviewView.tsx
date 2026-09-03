/**
 * The Overview view: everything about the change that is not the change.
 *
 * What it claims to do, what it is being merged into, whether CI agrees, and
 * who else has looked. All four were previously squeezed into a rail 296px
 * wide or scattered across the top bar, where the branch pair sat beside the
 * title as though it described the pull request rather than one fact about it.
 *
 * Two columns: the description gets the reading measure it needs, and the
 * facts about the change stand beside it rather than under it. Each list keeps
 * its top-bar summary at its head — the chip and the avatars are a glance, the
 * list is the answer, and having them apart meant looking in two places.
 *
 * What is *outstanding* is deliberately not here. It has a view of its own,
 * because it is the thing a reviewer returns to most and it used to sit below
 * a description of arbitrary length.
 */

import { type ReactNode, useMemo } from 'react';
import type { PrPayload } from '@/lib/messages';
import { type CheckContext, checksSummary } from './checks';
import { htmlToParagraphs } from './prBody';
import { ChecksChip } from './ChecksChip';
import { ReviewerAvatars } from './ReviewerAvatars';
import { prBranches, prPermalink, prReviewers } from './prNode';
import { reviewerLabel, reviewerTone } from './reviewerLabel';

export interface OverviewViewProps {
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
    return <p className="placeholder">Nothing has run on this commit.</p>;
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

/**
 * What is being merged into what.
 *
 * Both names or neither. GitHub can null either side, and "main ←" reads as a
 * branch pair with one branch in it rather than as a missing field.
 */
function Branches({ payload }: { payload: PrPayload }) {
  const { base, head } = prBranches(payload.pullRequest);

  if (base === null || head === null) {
    return <p className="placeholder">GitHub did not say which branches.</p>;
  }

  return (
    <p className="overview-branches" title={`Merging ${head} into ${base}`}>
      <code>{base}</code>
      <span className="branch-arrow" aria-hidden="true">
        ←
      </span>
      <code>{head}</code>
    </p>
  );
}

/** A heading with its one-glance summary on the same line. */
function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="overview-head">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function OverviewView({ payload }: OverviewViewProps) {
  return (
    <div className="overview">
      <div className="overview-main">
        <section className="overview-section">
          <SectionHead title="Description" />
          <Description payload={payload} />
        </section>
      </div>

      <aside className="overview-meta">
        <section className="overview-section">
          <SectionHead title="Branches" />
          <Branches payload={payload} />
        </section>

        <section className="overview-section">
          <SectionHead title="Checks">
            <ChecksChip checks={payload.checks} />
          </SectionHead>
          <Checks payload={payload} />
        </section>

        <section className="overview-section">
          <SectionHead title="Reviewers">
            <ReviewerAvatars reviewers={prReviewers(payload.pullRequest)} />
          </SectionHead>
          <Reviewers payload={payload} />
        </section>
      </aside>
    </div>
  );
}
