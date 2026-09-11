/**
 * Reading a thrown error back as evidence.
 *
 * This is the step where a 404 stops being a number and starts being a
 * diagnosis, so the tests here are mostly about what must survive the throw —
 * the headers, the sentence, the GraphQL `type` and `path` — and about not
 * spending a round trip on a question that is already answered.
 */

import { describe, expect, it } from 'vitest';
import {
  AuthError,
  GraphQLError,
  HttpError,
  MissingTokenError,
  type ResponseFacts,
} from './client';
import { NO_EVIDENCE } from './diagnosis';
import { evidenceOf, isUnreachable, worthProbing } from './evidence';
import type { DeniedField } from './graphql-errors';
import { ProtocolFailure } from '../messages';

const facts = (over: Partial<ResponseFacts> = {}): ResponseFacts => ({
  githubMessage: null,
  sso: null,
  acceptedPermissions: null,
  ...over,
});

const denial = (over: Partial<DeniedField> = {}): DeniedField => ({
  message: 'Resource not accessible by personal access token',
  path: null,
  count: 1,
  type: null,
  ...over,
});

describe('evidenceOf', () => {
  it('carries an HttpError’s status and all three facts through', () => {
    const error = new HttpError(403, {
      githubMessage: 'Resource not accessible by personal access token',
      sso: 'required; url=https://github.com/orgs/acme/sso',
      acceptedPermissions: 'checks=read',
    });

    expect(evidenceOf(error)).toEqual({
      ...NO_EVIDENCE,
      status: 403,
      githubMessage: 'Resource not accessible by personal access token',
      sso: 'required; url=https://github.com/orgs/acme/sso',
      acceptedPermissions: 'checks=read',
    });
  });

  it('reads an AuthError as the 401 it came from', () => {
    const error = new AuthError('GitHub rejected the token', facts({ githubMessage: 'Bad credentials' }));

    expect(evidenceOf(error).status).toBe(401);
    expect(evidenceOf(error).githubMessage).toBe('Bad credentials');
  });

  it('reads a missing token as no evidence at all, not as a 401', () => {
    // Nothing was ever sent. A status here would be an invention, and it would
    // put "GitHub answered with HTTP 401" on a screen where GitHub was never
    // asked anything.
    expect(evidenceOf(new MissingTokenError())).toEqual(NO_EVIDENCE);
  });

  it('records a GraphQL refusal as the HTTP 200 it actually arrived on', () => {
    // Saying 200 is the difference between a reviewer checking their network
    // and checking their token.
    const denied = [denial({ type: 'FORBIDDEN', path: 'repository.pullRequest.files' })];
    const evidence = evidenceOf(new GraphQLError(denied));

    expect(evidence.status).toBe(200);
    expect(evidence.endpoint).toBe('graphql');
    expect(evidence.denied).toEqual(denied);
  });

  it('does not call an HttpError a GraphQL failure', () => {
    // `graphql()` goes through the same request the diff does, so an HttpError
    // can come from either API. Labelling by the class would put "GitHub's
    // GraphQL API answered with HTTP 404" on a REST failure.
    expect(evidenceOf(new HttpError(404)).endpoint).toBeNull();
  });

  it('keeps the refusals a ProtocolFailure was raised with', () => {
    const denied = [denial({ type: 'NOT_FOUND', path: 'repository' })];
    const evidence = evidenceOf(new ProtocolFailure('not-found', 'No pull request', denied));

    expect(evidence.denied).toEqual(denied);
    expect(evidence.endpoint).toBe('graphql');
  });

  it('claims no endpoint for a ProtocolFailure GitHub said nothing about', () => {
    expect(evidenceOf(new ProtocolFailure('not-found', 'No pull request')).endpoint).toBeNull();
  });

  it('recognises a transport failure', () => {
    expect(evidenceOf(new TypeError('Failed to fetch')).unreachable).toBe(true);
  });

  it('reports nothing rather than guessing at an error it does not know', () => {
    expect(evidenceOf(new Error('something else entirely'))).toEqual(NO_EVIDENCE);
    expect(evidenceOf('a string')).toEqual(NO_EVIDENCE);
  });
});

describe('isUnreachable', () => {
  it.each(['Failed to fetch', 'NetworkError when attempting to fetch', 'Load failed'])(
    'recognises %p as the network, since that is all the browser gives us',
    (message) => {
      expect(isUnreachable(new TypeError(message))).toBe(true);
    },
  );

  it('does not call an ordinary programming mistake a network failure', () => {
    // `fetch` rejects with a bare TypeError, but so does calling undefined.
    // Telling someone their network is down over a bug in this extension is a
    // worse lie than "something went wrong".
    expect(isUnreachable(new TypeError('x.map is not a function'))).toBe(false);
  });

  it('does not treat our own errors as the network', () => {
    expect(isUnreachable(new HttpError(404))).toBe(false);
  });
});

describe('worthProbing', () => {
  const probe = (error: unknown) => worthProbing(error, evidenceOf(error));

  it.each([403, 404, 410])('spends a round trip on an access-shaped %d', (status) => {
    expect(probe(new HttpError(status))).toBe(true);
  });

  it('spends one on a stated not-found, which carries no denials at all', () => {
    // The commonest path there is: GitHub answered and simply had no
    // `repository.pullRequest` to give.
    expect(probe(new ProtocolFailure('not-found', 'No pull request acme/widgets#42'))).toBe(
      true,
    );
  });

  it('spends one on a GraphQL refusal even when GitHub sent no type', () => {
    expect(probe(new GraphQLError([denial()]))).toBe(true);
  });

  it('does not spend one when the request never reached GitHub', () => {
    // It would fail the same way.
    expect(probe(new TypeError('Failed to fetch'))).toBe(false);
  });

  it.each([500, 502, 503])('does not spend one on HTTP %d', (status) => {
    expect(probe(new HttpError(status))).toBe(false);
  });

  it('does not spend one on a 401, which is already decisive', () => {
    expect(probe(new AuthError('GitHub rejected the token'))).toBe(false);
  });

  it('does not spend one when the SSO header already names the remedy', () => {
    const sso = 'required; url=https://github.com/orgs/acme/sso';
    expect(probe(new HttpError(403, facts({ sso })))).toBe(false);
  });

  it('does not spend one on a failure with no evidence behind it', () => {
    // Including a missing token: there is nothing to ask GitHub with.
    expect(probe(new MissingTokenError())).toBe(false);
    expect(probe(new Error('something else entirely'))).toBe(false);
  });
});
