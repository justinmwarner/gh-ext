/**
 * A diagnosis in one sentence, for the places that have room for one line.
 *
 * `ErrorState` has a whole page and uses all of it. The options page has a
 * status line under a button, and used to fill it with `${kind}: ${message}` —
 * so pressing **Check token** against an expired token answered
 * `unknown: GitHub request failed: 404`, which names neither the problem nor
 * the remedy and reads like a bug in the extension rather than a fact about
 * the token.
 *
 * Same diagnosis, same vocabulary, a twentieth of the space.
 */

import type { Diagnosis } from '@/lib/messages';

/** The account, when the probe named it. Proof the token itself is accepted. */
const who = (login: string | null): string => (login === null ? '' : ` (@${login})`);

/**
 * One line for a diagnosis, or null when there is nothing better to say than
 * whatever GitHub said — in which case the caller should fall back to the raw
 * message rather than print a generic apology over the top of it.
 */
export function summarizeDiagnosis(diagnosis: Diagnosis): string | null {
  switch (diagnosis.cause) {
    case 'offline':
      return 'Could not reach GitHub — the request never left this machine.';
    case 'github-down':
      return 'GitHub answered with a failure of its own. Nothing here needs changing.';
    case 'no-token':
      return 'No token saved yet.';
    case 'token-rejected':
      return 'GitHub rejected this token. Fine-grained tokens expire, and can be revoked.';
    case 'sso-required':
      return `This token needs to be authorised for the organisation’s SAML single sign-on${who(diagnosis.login)}.`;
    case 'token-lacks-repo':
      return `The token works${who(diagnosis.login)}, but it has no access to that repository.`;
    case 'token-lacks-permission':
      return diagnosis.permission === null
        ? 'The token reaches the repository but is missing a permission inside it.'
        : `The token is missing the ${diagnosis.permission} permission.`;
    case 'pr-not-found':
      return 'The repository is reachable, but that pull request is not in it.';
    case 'rate-limited':
      return 'Rate limited. The quota belongs to the token and refills on its own.';
    default:
      return null;
  }
}
