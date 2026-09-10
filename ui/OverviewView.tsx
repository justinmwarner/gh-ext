/**
 * The Overview view: everything about the change that is not the change.
 *
 * What it claims to do, how it got there, what it is being merged into,
 * whether CI agrees, and who else has looked. Most of it was previously
 * squeezed into a rail 296px wide or scattered across the top bar, where the
 * branch pair sat beside the title as though it described the pull request
 * rather than one fact about it.
 *
 * The commit log is here because the numbered strip above the diff cannot hold
 * it. That strip says nothing but a number, deliberately — a row of subjects
 * is unscannable and the reviewer up there is stepping along a history they
 * are already reading. This is where the numbers get their subjects back, so
 * "which commit should I read" can be answered before you are inside one.
 *
 * Two columns, and only one of them is prose. The left is the description and
 * nothing else, at a reading measure. The right is everything the reviewer
 * *picks from or checks* — branches, checks, reviewers, commits — which is why
 * the commit log is over there despite its rows being sentences. Each list
 * keeps its one-glance summary at its head: the chip and the avatars are the
 * glance, the list is the answer, and having them apart meant looking in two
 * places.
 *
 * What is *outstanding* is deliberately not here. It has a view of its own,
 * because it is the thing a reviewer returns to most and it used to sit below
 * a description of arbitrary length.
 */

import { type ReactNode, useMemo } from 'react';
import type { PrPayload } from '@/lib/messages';
import type { PrCommit } from '@/lib/github/types';
import { type CheckContext, checksSummary } from './checks';
import { htmlToParagraphs } from './prBody';
import { ChecksChip } from './ChecksChip';
import { CommitLog } from './CommitLog';
import { ReviewerAvatars } from './ReviewerAvatars';
import { branchUrl } from './githubUrl';
import { prBranches, prHeadRepo, prPermalink, prReviewers } from './prNode';
import { reviewerLabel, reviewerTone } from './reviewerLabel';

export interface OverviewViewProps {
  payload: PrPayload;
  /** Scope the diff to one commit and take the reviewer to it. */
  onReviewCommit: (commit: PrCommit) => void;
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
 * One branch name, as a link where there is somewhere honest to point.
 *
 * `href` null keeps the name and drops the link rather than dropping the name.
 * Which branch a pull request is merging into is a fact worth having on screen
 * whether or not it can be opened, and a fork whose repository has since been
 * deleted is exactly the case where the name is all that is left of it.
 */
function Branch({ name, href }: { name: string; href: string | null }) {
  if (href === null) return <code>{name}</code>;
  return (
    <a className="branch-link" href={href}>
      <code>{name}</code>
    </a>
  );
}

/**
 * What is being merged into what.
 *
 * Both names or neither. GitHub can null either side, and "main ←" reads as a
 * branch pair with one branch in it rather than as a missing field.
 *
 * The base branch is always in the repository the route names, so it always
 * links. The head branch may not be: a pull request from a fork has its branch
 * somewhere else, and `prHeadRepo` is what refuses to guess — pointing a fork's
 * branch at the base repository is a 404 when nothing of that name is there,
 * and someone else's code when something is.
 */
function Branches({ payload }: { payload: PrPayload }) {
  const { base, head } = prBranches(payload.pullRequest);

  if (base === null || head === null) {
    return <p className="placeholder">GitHub did not say which branches.</p>;
  }

  const from = prHeadRepo(payload.pullRequest);
  const headRepo =
    from.kind === 'same' ? payload.ref : from.kind === 'fork' ? from : null;

  // `branchUrl` can answer null on its own account, which `Branch` handles the
  // same way it handles a fork nobody can name: the name stays, the link goes.
  return (
    <p className="overview-branches" title={`Merging ${head} into ${base}`}>
      <Branch name={base} href={branchUrl(payload.ref, base)} />
      <span className="branch-arrow" aria-hidden="true">
        ←
      </span>
      <Branch name={head} href={headRepo === null ? null : branchUrl(headRepo, head)} />
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

export function OverviewView({ payload, onReviewCommit }: OverviewViewProps) {
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

        {/* Last in this column, and no longer under the description.
            It sat there because a commit subject is a sentence and wanted the
            reading measure. What that missed is what the list is *for*: it is
            not read, it is picked from — the reviewer is choosing which commit
            to look at next, and choosing is what this column is already full
            of. Under the description it also pushed itself off the bottom of
            any pull request with a description of ordinary length.

            Under Reviewers rather than above them because the three above it
            are each a handful of lines and this one is not; a list that can run
            to fifty rows in the middle would bury them. */}
        <section className="overview-section">
          <SectionHead title="Commits">
            <span className="overview-count">{payload.commits.length}</span>
          </SectionHead>
          <CommitLog
            commits={payload.commits}
            pr={payload.ref}
            onReview={onReviewCommit}
          />
        </section>
      </aside>
    </div>
  );
}
