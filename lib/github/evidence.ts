/**
 * A caught error, read back as what GitHub actually said.
 *
 * The bridge between the classes the client throws and the `Evidence` the
 * classifier reasons over. It is here rather than in the worker for the reason
 * everything else in `lib/` is: this is the step where a 404 stops being a
 * number and starts being a diagnosis, and getting it wrong is invisible until
 * someone is staring at the wrong explanation. It tests in milliseconds under
 * Node, and did not when it lived in a service worker.
 *
 * Pure: no DOM, no `chrome.*`, no network.
 */

import {
  AuthError,
  GraphQLError,
  HttpError,
  MissingTokenError,
} from './client';
import { type Evidence, NO_EVIDENCE } from './diagnosis';
import { ProtocolFailure } from '../messages';

/**
 * A `fetch` that never got an answer, as opposed to one that got a bad answer.
 *
 * Browsers reject `fetch` with a bare `TypeError` for every transport failure —
 * offline, DNS, a corporate proxy, an extension blocking the request — and with
 * no distinguishing property whatsoever. So both halves are required: the type,
 * which rules out our own thrown errors, and the message, which rules out an
 * ordinary programming `TypeError` that has nothing to do with the network.
 * Anything failing the second test stays `unknown`, which is honest.
 */
const UNREACHABLE = /failed to fetch|network|load failed|err_/i;

export function isUnreachable(error: unknown): boolean {
  return error instanceof TypeError && UNREACHABLE.test(error.message);
}

/**
 * Everything a thrown error still knows about the exchange that produced it.
 *
 * `endpoint` is only ever claimed as `graphql` when there are GraphQL refusals
 * to prove it. An `HttpError` can come from either API — `graphql()` goes
 * through the same `request` the diff does — so labelling it by the class would
 * put "GitHub's GraphQL API answered with HTTP 404" on a REST failure.
 */
export function evidenceOf(error: unknown): Evidence {
  // Before `AuthError`, which it extends. Nothing was ever sent, so there is
  // no status and no response to describe.
  if (error instanceof MissingTokenError) return NO_EVIDENCE;

  if (error instanceof HttpError) {
    return { ...NO_EVIDENCE, status: error.status, ...error.facts };
  }
  if (error instanceof AuthError) {
    return { ...NO_EVIDENCE, status: 401, ...error.facts };
  }
  if (error instanceof GraphQLError) {
    // HTTP 200 is not a slip. A GraphQL refusal arrives on a successful
    // response, and saying so is the difference between a reviewer checking
    // their network and checking their token.
    return { ...NO_EVIDENCE, status: 200, endpoint: 'graphql', denied: error.denied };
  }
  if (error instanceof ProtocolFailure) {
    const denied = error.denied;
    return { ...NO_EVIDENCE, endpoint: denied.length > 0 ? 'graphql' : null, denied };
  }
  if (isUnreachable(error)) return { ...NO_EVIDENCE, unreachable: true };

  return NO_EVIDENCE;
}

/**
 * Whether one more request to GitHub could settle what this evidence cannot.
 *
 * The probe is only worth its round trip where the answer is genuinely open —
 * the access-shaped failures, and only those. A transport failure would fail
 * again, a 5xx is not about this token, a 401 is already decisive, and an SSO
 * header names the remedy outright. Spending a request on any of them buys
 * nothing and, on a throttled quota, costs the reviewer their next read.
 */
export function worthProbing(error: unknown, evidence: Evidence): boolean {
  if (evidence.unreachable) return false;
  if (evidence.status !== null && evidence.status >= 500) return false;
  if (evidence.status === 401 || evidence.sso !== null) return false;

  const accessShaped =
    evidence.status === 403 || evidence.status === 404 || evidence.status === 410;
  // Any fatal GraphQL refusal, not only the typed ones: GitHub often omits
  // `type` entirely, and a response that resolved nothing at all is the case
  // the probe exists for.
  const refused = evidence.denied.length > 0;
  // The commonest path of all, and the one that carries no denials: GitHub
  // answered the query and simply had no `repository.pullRequest` to give.
  const statedMissing =
    error instanceof ProtocolFailure && error.protocolKind === 'not-found';

  return accessShaped || refused || statedMissing;
}
