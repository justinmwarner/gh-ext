/**
 * The failures that are not about a missing token.
 *
 * This page used to have three cases and a shrug. Anything that was not a rate
 * limit or a not-found became "Something went wrong. The background worker
 * could not put this pull request together." over a line reading `GitHub
 * request failed: 404` — which is not an explanation, it is the absence of one.
 * Whether a reviewer should wait, change a setting, or go and find an
 * organisation owner was left for them to guess.
 *
 * It now renders a diagnosis the worker made from real evidence (see
 * `lib/github/diagnosis.ts`), and it does three things with it that the old
 * page could not:
 *
 * **It names the cause.** Nine of them, each with a different next move.
 *
 * **It shows its working.** "What we saw" lists the facts the conclusion came
 * from. Every inference here can be wrong, and a reviewer who can see the
 * evidence can get past a wrong one; a reviewer given only a verdict cannot.
 *
 * **It always offers the token.** The old page gated that button behind a
 * regular expression over the error text, which `GitHub request failed: 404`
 * did not match — so the one screen most likely to be a token problem was also
 * the one that hid the way to fix it.
 *
 * A diagnosis is optional on the wire, so the kind-based reading is kept as a
 * fallback for failures that never reached the classifier.
 */

import type { Diagnosis, PrRef, ProtocolError } from '@/lib/messages';
import { FullPage } from './FullPage';
import { OpenInGitHub } from './OpenInGitHub';
import { openOptions } from './openOptions';

/** GitHub's own list of the tokens this extension asks for. */
const TOKEN_SETTINGS = 'https://github.com/settings/personal-access-tokens';

const STATUS_PAGE = 'https://www.githubstatus.com';

interface Explanation {
  title: string;
  /** The paragraphs, in order. */
  body: string[];
  /** Whether the token is a plausible cause, and so worth leading with. */
  tokenMayBeAtFault: boolean;
  /** A link straight to whatever fixes this, when one exists. */
  fix: { href: string; label: string } | null;
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

/**
 * The hedge, or the absence of one.
 *
 * `confidence` exists so this page can state a proved thing plainly and mark an
 * inferred one as inferred. Dressing a guess up as a fact is how a reviewer
 * ends up regenerating a perfectly good token.
 */
const hedge = (diagnosis: Diagnosis, sure: string, guess: string): string =>
  diagnosis.confidence === 'confirmed' ? sure : guess;

/**
 * The one sentence worth saying about a token that has been proved to work.
 *
 * Empty when the probe could not name the account. Blank rather than a hedge,
 * because "your token may belong to someone" is not a sentence.
 */
const whoseToken = (login: string | null): string =>
  login === null ? '' : ` Your token itself is fine — GitHub says it belongs to @${login}.`;

/**
 * What to change, on the page where it is changed.
 *
 * Deliberately the same words `DeniedNotice` uses for a partial failure, which
 * is why the table they both read from lives in `lib/github/permissions.ts`.
 */
function permissionRemedy(diagnosis: Diagnosis): string {
  const { permission, section } = diagnosis;
  if (permission === null) {
    return "On the token's page, check that this repository is still granted and that the Pull requests, Contents, Checks, Commit statuses and Metadata permissions are set.";
  }
  const where = section === null ? "On the token's page" : `On the token's page, under ${section}`;
  return `${where}, set ${permission} to Read-only and try again.`;
}

function fromDiagnosis(pr: PrRef, error: ProtocolError, diagnosis: Diagnosis): Explanation {
  const repo = `${pr.owner}/${pr.repo}`;

  switch (diagnosis.cause) {
    case 'offline':
      return {
        title: 'Can’t reach GitHub',
        body: [
          'The request never left this machine — GitHub was never asked, so nothing here is about your token or this pull request.',
          'That is usually the network being down, or something in between blocking the request: a VPN, a corporate proxy, or another extension.',
        ],
        tokenMayBeAtFault: false,
        fix: null,
      };

    case 'github-down':
      return {
        title: 'GitHub is having trouble',
        body: [
          'GitHub answered, but with a failure of its own. Nothing about your token, this repository or this pull request is wrong, and there is nothing to change here.',
        ],
        tokenMayBeAtFault: false,
        fix: { href: STATUS_PAGE, label: 'GitHub status' },
      };

    case 'no-token':
      return {
        title: 'No token saved yet',
        body: [
          'A Better Reviewer reads pull requests with a GitHub token of your own. There is not one saved on this machine, so there is nothing to read this pull request with.',
        ],
        tokenMayBeAtFault: true,
        fix: null,
      };

    case 'token-rejected':
      return {
        title: 'GitHub rejected your token',
        body: [
          'GitHub will not accept the saved token at all, which it does for two reasons: the token has expired, or it has been revoked. Fine-grained tokens always have an expiry date.',
          'Nothing about this repository is in question — GitHub declined before it got that far.',
        ],
        tokenMayBeAtFault: true,
        fix: { href: TOKEN_SETTINGS, label: 'Your tokens on GitHub' },
      };

    case 'sso-required':
      return {
        title: 'This organisation needs SSO authorisation',
        body: [
          hedge(
            diagnosis,
            `The organisation that owns ${repo} enforces SAML single sign-on, and this token has not been authorised for it.`,
            `GitHub’s reply mentions SAML single sign-on, so the organisation that owns ${repo} most likely enforces it and this token has not been authorised for it.`,
          ),
          `The token is not the problem and does not need replacing — it needs authorising, once, for this organisation.${whoseToken(diagnosis.login)}`,
        ],
        tokenMayBeAtFault: false,
        fix:
          diagnosis.fixUrl === null
            ? { href: TOKEN_SETTINGS, label: 'Your tokens on GitHub' }
            : { href: diagnosis.fixUrl, label: 'Authorise this token' },
      };

    case 'token-lacks-repo':
      return {
        title: `Your token can’t see ${repo}`,
        body: [
          hedge(
            diagnosis,
            `GitHub would not return ${repo} for this token.${whoseToken(diagnosis.login)}`,
            `GitHub would not return ${repo}. By far the likeliest reason is that your token does not grant access to it.`,
          ),
          // The two live possibilities, and GitHub reports them identically —
          // a token awaiting approval 404s exactly like one never granted. A
          // page that named only the first would send half the people who
          // land here to re-grant a repository that is already granted.
          'A fine-grained token grants repositories one at a time, so this one may simply not be on its list. If the repository belongs to an organisation, an owner may also still need to approve the token — GitHub shows that as Pending owner approval and reports it exactly like no access at all.',
        ],
        tokenMayBeAtFault: true,
        fix: { href: TOKEN_SETTINGS, label: 'Your tokens on GitHub' },
      };

    case 'token-lacks-permission':
      return {
        title:
          diagnosis.permission === null
            ? 'Your token is missing a permission'
            : `Your token is missing the ${diagnosis.permission} permission`,
        body: [
          hedge(
            diagnosis,
            `${repo} resolved for this token, so the repository is granted — but something this page reads from it is not.${whoseToken(diagnosis.login)}`,
            `GitHub refused part of this read. That is what a token missing one permission looks like, rather than one missing the repository.`,
          ),
          permissionRemedy(diagnosis),
        ],
        tokenMayBeAtFault: true,
        fix: { href: TOKEN_SETTINGS, label: 'Your tokens on GitHub' },
      };

    case 'pr-not-found':
      return {
        title: `No pull request #${pr.number} in ${repo}`,
        body: [
          `Your token can see ${repo} — GitHub returned the repository — but there is no pull request #${pr.number} in it.${whoseToken(diagnosis.login)}`,
          'So this is not a permissions problem. The number is wrong, the pull request has been deleted, or it belongs to a different repository.',
        ],
        // Genuinely not the token. The button is still offered below, because
        // being wrong about this must not strand anyone, but it is not led with.
        tokenMayBeAtFault: false,
        fix: null,
      };

    case 'rate-limited':
      return {
        title: 'GitHub rate limit reached',
        body: [
          whenQuotaRefills(error.resetAt),
          'The quota belongs to the token, so this is nothing to do with this repository or this pull request.',
        ],
        tokenMayBeAtFault: false,
        fix: null,
      };

    default:
      return {
        title: 'Something went wrong',
        body: [
          'The background worker could not put this pull request together, and what GitHub said does not match anything we know how to explain.',
          'The evidence below is everything we saw, unedited.',
        ],
        tokenMayBeAtFault: false,
        fix: null,
      };
  }
}

/**
 * The reading for a failure that never reached the classifier.
 *
 * `kind` is all there is here, so this is the old page, kept honest about how
 * little it knows. It should be rare: the only failures that skip the
 * classifier are the ones raised before any request was attempted.
 */
function fromKind(pr: PrRef, error: ProtocolError): Explanation {
  if (error.kind === 'rate-limit') {
    return {
      title: 'GitHub rate limit reached',
      body: [whenQuotaRefills(error.resetAt)],
      tokenMayBeAtFault: false,
      fix: null,
    };
  }
  if (error.kind === 'not-found') {
    return {
      title: 'This pull request is out of reach',
      body: [
        `${pr.owner}/${pr.repo}#${pr.number} either does not exist or your token does not have access to it.`,
        'Which of the two it is was not established, because this failure did not reach the part of the worker that asks.',
      ],
      tokenMayBeAtFault: true,
      fix: { href: TOKEN_SETTINGS, label: 'Your tokens on GitHub' },
    };
  }
  return {
    title: 'Something went wrong',
    body: ['The background worker could not put this pull request together.'],
    tokenMayBeAtFault: false,
    fix: null,
  };
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
  const diagnosis = error.diagnosis;
  const { title, body, tokenMayBeAtFault, fix } =
    diagnosis === undefined
      ? fromKind(pr, error)
      : fromDiagnosis(pr, error, diagnosis);
  const evidence = diagnosis?.observed ?? [];

  return (
    <FullPage
      title={title}
      actions={
        <>
          {/* Offered on every failure without exception. It used to be gated
              on a regular expression over the error text, which meant the
              screens most likely to be a token problem — the ones whose only
              text was `GitHub request failed: 404` — were exactly the screens
              that hid it. Demoted rather than removed where the token is not
              the likely cause, because being wrong about that should cost a
              reviewer one extra glance, not the remedy. */}
          <button
            type="button"
            className={tokenMayBeAtFault ? 'button primary' : 'button'}
            onClick={openOptions}
          >
            Update token
          </button>
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
      {body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {fix !== null && (
        <p>
          <a href={fix.href} target="_blank" rel="noreferrer noopener">
            {fix.label}
          </a>
        </p>
      )}

      {/* The evidence, not the verdict. Everything above this is an inference
          and some of it will be wrong; this is the part that stays true, and
          the part worth quoting to whoever administers the organisation. */}
      {evidence.length > 0 ? (
        <section className="evidence">
          <h2>What we saw</h2>
          <ul>
            {evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : (
        // Only when there is no evidence block. The worker's raw message is
        // there to be the one specific thing on the page, and once the
        // evidence above quotes GitHub directly it is the same sentence twice
        // — in the reading where it does not contradict itself outright,
        // having been written before anything was established.
        <p className="detail">{error.message}</p>
      )}
    </FullPage>
  );
}
