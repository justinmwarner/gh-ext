/**
 * Working out what actually went wrong, from what GitHub actually said.
 *
 * The worker used to hand the review page three facts — a coarse kind, a
 * sentence, and a reset time — and everything else was inferred on the far
 * side by matching the sentence against a regular expression. That is how a
 * token with no access to a repository, an organisation enforcing SAML, a
 * laptop with no network and a 502 from GitHub all arrived on screen as
 * "Something went wrong", over the text `GitHub request failed: 404`.
 *
 * The evidence to tell them apart was there the whole time and was being
 * thrown away: the status code, the sentence in the error body, two headers
 * that name the remedy outright, and — on the GraphQL side — a `type` and a
 * `path` per refusal. This module is where that evidence is read as evidence.
 *
 * Two rules it holds to:
 *
 * **Say what was seen, not only what was concluded.** Every diagnosis carries
 * `observed`, the facts it reasoned from, so that when the conclusion is wrong
 * the reviewer can see why and is not left arguing with a verdict.
 *
 * **Distinguish proof from inference.** `confidence` is `confirmed` only when
 * the evidence settles it. Everything else says `likely`, and the page hedges
 * in words rather than stating a guess as fact.
 *
 * Pure: no DOM, no `chrome.*`, no network. The probe that gathers half the
 * evidence is performed by the worker and its *result* is passed in.
 */

import type { DeniedField } from './graphql-errors';
import { type Section, areaOf, permissionFromHeader, summarizeAreas } from './permissions';

/** A pull request's coordinates. Structural, to stay clear of `lib/messages`. */
interface Target {
  owner: string;
  repo: string;
  number: number;
}

/**
 * What we concluded. Ordered roughly from "not your fault" to "your token".
 *
 * These drive the words on screen and nothing else — routing between the setup
 * page, the unlock page and the error page is still `ProtocolErrorKind`'s job.
 */
export type Cause =
  /** The request never reached GitHub. */
  | 'offline'
  /** GitHub answered, but with its own failure. */
  | 'github-down'
  /** No token has been saved yet. */
  | 'no-token'
  /** A token exists and GitHub refused it outright. */
  | 'token-rejected'
  /** The organisation enforces SAML and this token is not authorised for it. */
  | 'sso-required'
  /** The token is valid but this repository is not among the ones it grants. */
  | 'token-lacks-repo'
  /** The repository is granted; some permission inside it is not. */
  | 'token-lacks-permission'
  /** The repository is reachable and this pull request number is not in it. */
  | 'pr-not-found'
  | 'rate-limited'
  | 'unknown';

/** What the failed response itself told us. */
export interface Evidence {
  /** The status GitHub answered with, or null if it never answered. */
  status: number | null;
  /** Which API refused. Null when the failure was not a request at all. */
  endpoint: 'graphql' | 'rest' | null;
  /** GitHub's own sentence, from a REST error body. */
  githubMessage: string | null;
  /** GraphQL's refusals, with their types and paths intact. */
  denied: readonly DeniedField[];
  /** `x-github-sso`, verbatim. */
  sso: string | null;
  /** `x-accepted-github-permissions`, verbatim. */
  acceptedPermissions: string | null;
  /** True when the transport itself failed — offline, DNS, blocked. */
  unreachable: boolean;
}

export const NO_EVIDENCE: Evidence = {
  status: null,
  endpoint: null,
  githubMessage: null,
  denied: [],
  sso: null,
  acceptedPermissions: null,
  unreachable: false,
};

/**
 * What one extra question to GitHub established, once something had already
 * failed.
 *
 * `null` on every field means the probe did not run or could not answer, which
 * is a legitimate outcome and not the same as a negative result. The whole
 * point of separating this from `Evidence` is that these answers cost a round
 * trip, so the classifier has to work without them too.
 */
export interface Probe {
  /** Who the token belongs to, when GitHub would say. */
  login: string | null;
  /** Whether the repository resolved at all for this token. */
  repository: 'visible' | 'invisible' | null;
  /** True when the probe's own request was refused with a 401. */
  tokenRejected: boolean;
}

export const NO_PROBE: Probe = { login: null, repository: null, tokenRejected: false };

export interface Diagnosis {
  cause: Cause;
  /** `confirmed` only when the evidence settles it. */
  confidence: 'confirmed' | 'likely';
  /** Who the token is, when the probe found out. Proof it is not the token itself. */
  login: string | null;
  /** The GitHub permission to change, when we can name it. */
  permission: string | null;
  /** Which list on the token page that permission is under. */
  section: Section | null;
  /** A link straight to the screen that fixes this, when GitHub gave one. */
  fixUrl: string | null;
  /** The facts this was reasoned from, in the order they were gathered. */
  observed: string[];
}

/** Text that means SAML, in a response that carried no header saying so. */
const SAML = /\bSAML\b|\bSSO\b|single sign-?on/i;

/**
 * The URL out of an `x-github-sso` header, or out of GitHub's own sentence.
 *
 * The header reads `required; url=https://github.com/orgs/acme/sso?...`, and
 * that URL is the single most specific remedy this extension can offer: it
 * opens the exact authorisation screen for the exact organisation. Worth
 * parsing carefully rather than sending someone to a settings index to hunt.
 */
function fixUrlFrom(sso: string | null, message: string | null): string | null {
  const fromHeader = sso === null ? null : /url=(\S+)/.exec(sso)?.[1];
  if (fromHeader) return fromHeader;
  // GraphQL has no header to carry it and puts the URL in the sentence instead.
  const fromMessage = message === null ? null : /https:\/\/\S+\/sso\S*/.exec(message)?.[0];
  return fromMessage ?? null;
}

/** Every sentence GitHub said, across both APIs. */
function githubSentences(evidence: Evidence): string[] {
  const lines = evidence.denied.map((entry) => entry.message);
  if (evidence.githubMessage !== null) lines.unshift(evidence.githubMessage);
  return lines;
}

function hasType(evidence: Evidence, type: string): boolean {
  return evidence.denied.some((entry) => entry.type === type);
}

/**
 * The permission to name, from whichever source has one.
 *
 * The REST header is preferred because GitHub wrote it for exactly this
 * purpose. The GraphQL path is the fallback, and is only as good as the table
 * in `permissions.ts` — but a named path with no known permission still beats
 * nothing, so the area is consulted before giving up.
 */
function namePermission(evidence: Evidence): { permission: string | null; section: Section | null } {
  const fromHeader = permissionFromHeader(evidence.acceptedPermissions);
  if (fromHeader) return { permission: fromHeader.permission, section: fromHeader.section };

  const summary = summarizeAreas(evidence.denied);
  if (summary.permissions.length > 0) {
    return { permission: summary.permissions[0] ?? null, section: summary.section };
  }
  return { permission: null, section: null };
}

/**
 * What we saw, written down.
 *
 * Deliberately transcription rather than interpretation — each line is one
 * thing that is true about the exchange. The conclusion is elsewhere; this is
 * the part that stays useful when the conclusion is wrong.
 */
function observe(target: Target | null, evidence: Evidence, probe: Probe): string[] {
  const seen: string[] = [];
  const where = evidence.endpoint === 'graphql' ? "GitHub's GraphQL API" : 'GitHub';

  if (evidence.unreachable) {
    seen.push('The request never reached GitHub.');
  } else if (evidence.status !== null) {
    seen.push(`${where} answered with HTTP ${evidence.status}.`);
  }

  for (const sentence of githubSentences(evidence)) {
    seen.push(`GitHub said: “${sentence}”`);
  }

  // Paths only when they name something. An unrecognised path is already in
  // the sentence above via `describeDenied`, and repeating it here as an
  // "area" the table could not place is noise.
  for (const entry of evidence.denied) {
    if (entry.path === null) continue;
    const area = areaOf(entry.path);
    if (area.permission !== null) {
      seen.push(`The refusal was raised on ${area.what}.`);
    }
  }

  if (evidence.acceptedPermissions !== null) {
    seen.push(`GitHub named the permission it wanted: ${evidence.acceptedPermissions}.`);
  }
  if (evidence.sso !== null) {
    seen.push('The response carried an SSO authorisation header.');
  }

  if (probe.tokenRejected) {
    seen.push('We asked GitHub who the token belongs to and it refused the token.');
  } else if (probe.login !== null) {
    seen.push(`We asked GitHub who the token belongs to: @${probe.login}.`);
  }

  // Only when there is a repository to name. The options page's token check
  // fails with no pull request in hand, and "undefined/undefined did not
  // resolve" is worse than saying nothing about a repository at all.
  const repo = target === null ? null : `${target.owner}/${target.repo}`;
  if (repo === null) return seen;
  if (probe.repository === 'visible') {
    seen.push(`${repo} resolved for this token, so the repository itself is reachable.`);
  } else if (probe.repository === 'invisible') {
    seen.push(`${repo} did not resolve for this token.`);
  }

  return seen;
}

/**
 * The evidence, as a conclusion.
 *
 * The order of these branches is the order of certainty, not the order of
 * likelihood. A transport failure explains everything below it, a 5xx explains
 * everything below that, and so on down — so each one is settled before the
 * next is considered, and nothing is ever blamed on a token when something
 * more fundamental already accounts for it.
 */
function conclude(
  evidence: Evidence,
  probe: Probe,
): Pick<Diagnosis, 'cause' | 'confidence'> {
  // Nothing reached GitHub, so nothing about the token can be inferred.
  if (evidence.unreachable) return { cause: 'offline', confidence: 'confirmed' };

  if (evidence.status !== null && evidence.status >= 500) {
    return { cause: 'github-down', confidence: 'confirmed' };
  }

  // Before the token checks: SAML is refused with the same 403 as a missing
  // permission, and sending someone to add permissions to a token that is
  // simply not authorised for the organisation wastes the one trip they make.
  const saml = evidence.sso !== null || githubSentences(evidence).some((s) => SAML.test(s));
  if (saml) {
    return { cause: 'sso-required', confidence: evidence.sso !== null ? 'confirmed' : 'likely' };
  }

  // The probe asked GitHub directly and GitHub would not accept the token at
  // all, which settles it regardless of what the original request said.
  if (probe.tokenRejected || evidence.status === 401) {
    return { cause: 'token-rejected', confidence: 'confirmed' };
  }

  const forbidden = evidence.status === 403 || hasType(evidence, 'FORBIDDEN');
  const missing =
    evidence.status === 404 || evidence.status === 410 || hasType(evidence, 'NOT_FOUND');

  // With a probe result the guessing stops. The repository either resolved for
  // this token or it did not, and each answer rules out half the possibilities.
  if (probe.repository === 'invisible') {
    return { cause: 'token-lacks-repo', confidence: 'confirmed' };
  }
  if (probe.repository === 'visible') {
    // The repository is reachable, so whatever failed is inside it: either a
    // permission covering part of it, or a pull request number that is not there.
    if (forbidden || evidence.acceptedPermissions !== null) {
      return { cause: 'token-lacks-permission', confidence: 'confirmed' };
    }
    if (missing) return { cause: 'pr-not-found', confidence: 'confirmed' };
  }

  // No probe result. The status still narrows it to one answer worth printing,
  // but it is an inference and says so.
  if (forbidden) return { cause: 'token-lacks-permission', confidence: 'likely' };
  if (missing) return { cause: 'token-lacks-repo', confidence: 'likely' };

  return { cause: 'unknown', confidence: 'likely' };
}

/**
 * Everything above, as one value fit to cross `sendMessage`.
 *
 * `target` is only used to write the repository into the observed lines — the
 * conclusion never depends on it, which is why it may be null. A failure with
 * no pull request behind it (the options page checking a token) is still worth
 * diagnosing.
 */
export function diagnose(
  target: Target | null,
  evidence: Evidence = NO_EVIDENCE,
  probe: Probe = NO_PROBE,
): Diagnosis {
  const { cause, confidence } = conclude(evidence, probe);
  const { permission, section } = namePermission(evidence);

  return {
    cause,
    confidence,
    login: probe.login,
    // Named only where it is the remedy. A permission on an offline diagnosis
    // is a leftover header, and printing it would send someone to change a
    // setting that was never the problem.
    permission: cause === 'token-lacks-permission' ? permission : null,
    section: cause === 'token-lacks-permission' ? section : null,
    fixUrl: cause === 'sso-required' ? fixUrlFrom(evidence.sso, githubSentences(evidence)[0] ?? null) : null,
    observed: observe(target, evidence, probe),
  };
}

/**
 * The diagnosis for a failure that never got as far as a request.
 *
 * `rate-limited` and `no-token` are settled before any of the reasoning above
 * applies — the worker already knows which it has — so they are stated rather
 * than inferred.
 */
export function statedDiagnosis(cause: Cause, observed: string[] = []): Diagnosis {
  return {
    cause,
    confidence: 'confirmed',
    login: null,
    permission: null,
    section: null,
    fixUrl: null,
    observed,
  };
}
