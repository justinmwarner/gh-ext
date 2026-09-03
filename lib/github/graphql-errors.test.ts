/**
 * Reading GraphQL's `errors` array.
 *
 * The case this exists for: a fine-grained token that grants the repository but
 * not one field inside it. GitHub answers 200 with `data` fully populated apart
 * from the denied subtree, and one error per denied object — seven check runs
 * produce seven copies of the same sentence. Joining the messages produced
 * exactly that, seven times, and said nothing about what had been refused.
 */

import { describe, expect, it } from 'vitest';
import { type DeniedField, describeDenied, mergeDenied, normalizeErrors } from './graphql-errors';

/** What GitHub actually returns for a token without the Checks permission. */
const checkRunDenials = Array.from({ length: 7 }, (_, index) => ({
  type: 'FORBIDDEN',
  path: [
    'repository',
    'pullRequest',
    'commits',
    'nodes',
    0,
    'commit',
    'statusCheckRollup',
    'contexts',
    'nodes',
    index,
  ],
  message: 'Resource not accessible by personal access token',
}));

describe('normalizeErrors', () => {
  it('collapses one denial per list element into a single fact', () => {
    // Seven identical sentences are not seven pieces of information.
    const denied = normalizeErrors(checkRunDenials);

    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      message: 'Resource not accessible by personal access token',
      count: 7,
      // GitHub's own classification, kept because "wait" and "get a different
      // token" are opposite remedies and the message does not distinguish them.
      type: 'FORBIDDEN',
    });
  });

  it('keeps the path, with list indices generalized', () => {
    // The index of the fourth denied check run is noise. The route to
    // `statusCheckRollup` is the entire diagnosis.
    const denied = normalizeErrors(checkRunDenials);

    expect(denied[0]?.path).toBe(
      'repository.pullRequest.commits.nodes.N.commit.statusCheckRollup.contexts.nodes.N',
    );
  });

  it('keeps distinct messages apart', () => {
    const denied = normalizeErrors([
      { message: 'Resource not accessible by personal access token', path: ['a'] },
      { message: 'Field mystery does not exist on PullRequest' },
    ]);

    expect(denied).toHaveLength(2);
    expect(denied.map((d: { message: string }) => d.message)).toEqual([
      'Resource not accessible by personal access token',
      'Field mystery does not exist on PullRequest',
    ]);
  });

  it('keeps the same message apart when it was raised at different paths', () => {
    const denied = normalizeErrors([
      { message: 'Resource not accessible by personal access token', path: ['checks'] },
      { message: 'Resource not accessible by personal access token', path: ['secrets'] },
    ]);

    expect(denied).toHaveLength(2);
  });

  it('reports a path-less error rather than dropping it', () => {
    const denied = normalizeErrors([{ message: 'Something broke' }]);

    expect(denied).toEqual([{ message: 'Something broke', path: null, count: 1, type: null }]);
  });

  it('survives anything that is not an error array', () => {
    // This is parsed JSON from the network. It is not typed by anything.
    expect(normalizeErrors(undefined)).toEqual([]);
    expect(normalizeErrors(null)).toEqual([]);
    expect(normalizeErrors('nope')).toEqual([]);
    expect(normalizeErrors([])).toEqual([]);
  });

  it('describes an entry with no usable message rather than dropping it', () => {
    const denied = normalizeErrors([{ path: ['a'] }, 42]);

    expect(denied).toHaveLength(2);
    for (const entry of denied) expect(entry.message).not.toBe('');
  });
});

describe('describeDenied', () => {
  it('names the count and the path', () => {
    const text = describeDenied(normalizeErrors(checkRunDenials));

    expect(text).toContain('Resource not accessible by personal access token');
    expect(text).toContain('7 fields');
    expect(text).toContain('statusCheckRollup');
  });

  it('adds nothing to a lone path-less error', () => {
    // The existing message for a genuinely broken query stays exactly as it was.
    const text = describeDenied(normalizeErrors([{ message: 'Field mystery does not exist' }]));

    expect(text).toBe('Field mystery does not exist');
  });

  it('joins several with a separator', () => {
    const text = describeDenied(
      normalizeErrors([{ message: 'first' }, { message: 'second' }]),
    );

    expect(text).toBe('first; second');
  });

  it('says something for an empty list rather than returning a blank string', () => {
    expect(describeDenied([])).not.toBe('');
  });
});

describe('mergeDenied', () => {
  const denial = (path: string | null, count: number): DeniedField => ({
    message: 'Resource not accessible by personal access token',
    path,
    count,
    type: null,
  });

  it('folds the same refusal from several responses into one', () => {
    // Reading one pull request is up to three round trips. A permission that
    // denies a field denies it in every one of them.
    const merged = mergeDenied([[denial('a.b', 7)], [denial('a.b', 4)]]);

    expect(merged).toEqual([denial('a.b', 11)]);
  });

  it('keeps refusals at different paths apart', () => {
    const merged = mergeDenied([[denial('a.b', 1)], [denial('c.d', 1)]]);

    expect(merged).toHaveLength(2);
  });

  it('does not mutate the lists it was given', () => {
    const first = denial('a.b', 7);
    mergeDenied([[first], [denial('a.b', 4)]]);

    expect(first.count).toBe(7);
  });

  it('is empty for the ordinary case', () => {
    expect(mergeDenied([])).toEqual([]);
    expect(mergeDenied([[], []])).toEqual([]);
  });
});
