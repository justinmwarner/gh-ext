/**
 * The classifier.
 *
 * The failure it exists to stop: a token with no access to a repository, an
 * organisation enforcing SAML, a laptop with no network and a 502 from GitHub
 * all reaching the review page as "Something went wrong", over the text
 * `GitHub request failed: 404`. The evidence separating them was on the wire
 * the whole time and was being discarded.
 *
 * So most of these tests are one evidence shape and the conclusion it must
 * produce. The rest are about restraint: what must *not* be claimed when the
 * evidence does not support it.
 */

import { describe, expect, it } from 'vitest';
import {
  type Evidence,
  NO_EVIDENCE,
  NO_PROBE,
  type Probe,
  diagnose,
  statedDiagnosis,
} from './diagnosis';
import type { DeniedField } from './graphql-errors';

const pr = { owner: 'acme', repo: 'widgets', number: 42 };

const evidence = (over: Partial<Evidence> = {}): Evidence => ({ ...NO_EVIDENCE, ...over });
const probe = (over: Partial<Probe> = {}): Probe => ({ ...NO_PROBE, ...over });

const denial = (over: Partial<DeniedField> = {}): DeniedField => ({
  message: 'Resource not accessible by personal access token',
  path: null,
  count: 1,
  type: null,
  ...over,
});

describe('what the evidence alone settles', () => {
  it('calls a transport failure offline rather than blaming the token', () => {
    // `fetch` rejecting means GitHub was never asked. Nothing about the token
    // can be inferred, and the old page said "check your token" anyway.
    const result = diagnose(pr, evidence({ unreachable: true }));

    expect(result.cause).toBe('offline');
    expect(result.confidence).toBe('confirmed');
  });

  it.each([500, 502, 503])('calls HTTP %d GitHub’s problem, not the reviewer’s', (status) => {
    const result = diagnose(pr, evidence({ status }));

    expect(result.cause).toBe('github-down');
    expect(result.confidence).toBe('confirmed');
  });

  it('calls a 401 a rejected token', () => {
    const result = diagnose(pr, evidence({ status: 401 }));

    expect(result.cause).toBe('token-rejected');
    expect(result.confidence).toBe('confirmed');
  });
});

describe('SAML', () => {
  it('is confirmed by the header, and carries the URL that fixes it', () => {
    const result = diagnose(
      pr,
      evidence({
        status: 403,
        sso: 'required; url=https://github.com/orgs/acme/sso?authorization_request=ABC',
      }),
    );

    expect(result.cause).toBe('sso-required');
    expect(result.confidence).toBe('confirmed');
    expect(result.fixUrl).toBe(
      'https://github.com/orgs/acme/sso?authorization_request=ABC',
    );
  });

  it('is only likely when all we have is GitHub’s wording', () => {
    const result = diagnose(
      pr,
      evidence({
        status: 403,
        githubMessage:
          'You must grant SAML SSO authorization for this organization before using this token.',
      }),
    );

    expect(result.cause).toBe('sso-required');
    expect(result.confidence).toBe('likely');
  });

  it('is decided before the permission check, because both are a 403', () => {
    // Sending someone to add permissions to a token that is simply not
    // authorised for the organisation wastes the one trip they make.
    const result = diagnose(
      pr,
      evidence({
        status: 403,
        sso: 'required; url=https://github.com/orgs/acme/sso',
        acceptedPermissions: 'pull_requests=read',
      }),
    );

    expect(result.cause).toBe('sso-required');
  });
});

describe('what the probe settles', () => {
  it('names a repository the token cannot see, rather than hedging', () => {
    const result = diagnose(
      pr,
      evidence({ status: 404 }),
      probe({ login: 'warne', repository: 'invisible' }),
    );

    expect(result.cause).toBe('token-lacks-repo');
    expect(result.confidence).toBe('confirmed');
    expect(result.login).toBe('warne');
  });

  it('rules the repository out when GitHub returned it', () => {
    // The repository resolved, so a 404 can only be about the pull request.
    const result = diagnose(
      pr,
      evidence({ status: 404 }),
      probe({ login: 'warne', repository: 'visible' }),
    );

    expect(result.cause).toBe('pr-not-found');
    expect(result.confidence).toBe('confirmed');
  });

  it('calls a refusal inside a visible repository a missing permission', () => {
    const result = diagnose(
      pr,
      evidence({ status: 403 }),
      probe({ login: 'warne', repository: 'visible' }),
    );

    expect(result.cause).toBe('token-lacks-permission');
    expect(result.confidence).toBe('confirmed');
  });

  it('trusts its own rejection over whatever the first request said', () => {
    const result = diagnose(pr, evidence({ status: 404 }), probe({ tokenRejected: true }));

    expect(result.cause).toBe('token-rejected');
    expect(result.confidence).toBe('confirmed');
  });
});

describe('without a probe', () => {
  it('still names the likeliest cause for a 404, and marks it a guess', () => {
    const result = diagnose(pr, evidence({ status: 404 }));

    expect(result.cause).toBe('token-lacks-repo');
    expect(result.confidence).toBe('likely');
  });

  it('still names the likeliest cause for a 403, and marks it a guess', () => {
    const result = diagnose(pr, evidence({ status: 403 }));

    expect(result.cause).toBe('token-lacks-permission');
    expect(result.confidence).toBe('likely');
  });

  it('reads a GraphQL NOT_FOUND the same way as a 404', () => {
    const result = diagnose(
      pr,
      evidence({ status: 200, endpoint: 'graphql', denied: [denial({ type: 'NOT_FOUND' })] }),
    );

    expect(result.cause).toBe('token-lacks-repo');
  });

  it('reads a GraphQL FORBIDDEN the same way as a 403', () => {
    const result = diagnose(
      pr,
      evidence({ status: 200, endpoint: 'graphql', denied: [denial({ type: 'FORBIDDEN' })] }),
    );

    expect(result.cause).toBe('token-lacks-permission');
  });

  it('admits it does not know rather than inventing a cause', () => {
    const result = diagnose(pr, evidence({ status: 418, githubMessage: 'I am a teapot' }));

    expect(result.cause).toBe('unknown');
  });
});

describe('naming the permission to change', () => {
  it('prefers the header GitHub wrote for exactly this purpose', () => {
    const result = diagnose(pr, evidence({ status: 403, acceptedPermissions: 'checks=read' }));

    expect(result.permission).toBe('Checks');
    expect(result.section).toBe('Repository permissions');
  });

  it('falls back to the denied path when there is no header', () => {
    const result = diagnose(
      pr,
      evidence({
        status: 200,
        endpoint: 'graphql',
        denied: [
          denial({
            type: 'FORBIDDEN',
            path: 'repository.pullRequest.commits.nodes.N.commit.statusCheckRollup',
          }),
        ],
      }),
    );

    expect(result.permission).toBe('Checks');
  });

  it('does not name one on a cause a permission cannot fix', () => {
    // A leftover header on an offline diagnosis would send someone to change a
    // setting that was never the problem.
    const result = diagnose(
      pr,
      evidence({ unreachable: true, acceptedPermissions: 'checks=read' }),
    );

    expect(result.cause).toBe('offline');
    expect(result.permission).toBeNull();
  });
});

describe('what we saw', () => {
  it('records the status, GitHub’s sentence, and both probe answers', () => {
    const result = diagnose(
      pr,
      evidence({ status: 404, githubMessage: 'Not Found' }),
      probe({ login: 'warne', repository: 'invisible' }),
    );

    const seen = result.observed.join('\n');
    expect(seen).toMatch(/HTTP 404/);
    expect(seen).toMatch(/Not Found/);
    expect(seen).toMatch(/@warne/);
    expect(seen).toMatch(/acme\/widgets did not resolve/);
  });

  it('says the request never arrived, rather than reporting a status it never got', () => {
    const result = diagnose(pr, evidence({ unreachable: true }));

    expect(result.observed.join('\n')).toMatch(/never reached GitHub/);
    expect(result.observed.join('\n')).not.toMatch(/HTTP/);
  });

  it('names no repository when there is no pull request behind the failure', () => {
    // The options page checks a token with no pull request in hand.
    // "undefined/undefined did not resolve" is worse than saying nothing.
    const result = diagnose(null, evidence({ status: 401 }), probe({ login: 'warne' }));

    expect(result.observed.join('\n')).not.toMatch(/undefined/);
    expect(result.observed.join('\n')).toMatch(/@warne/);
  });

  it('carries no evidence at all for a stated cause', () => {
    expect(statedDiagnosis('rate-limited').observed).toEqual([]);
    expect(statedDiagnosis('rate-limited').confidence).toBe('confirmed');
  });
});

describe('staying serializable', () => {
  it('survives the round trip through `sendMessage`', () => {
    // Everything here crosses `runtime.sendMessage`, which is JSON. A `Date`,
    // a `Map` or an `undefined` in here arrives on the review page as
    // something else entirely.
    const result = diagnose(
      pr,
      evidence({ status: 403, acceptedPermissions: 'pull_requests=read' }),
      probe({ login: 'warne', repository: 'visible' }),
    );

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
