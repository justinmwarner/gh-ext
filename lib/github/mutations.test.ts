/**
 * The mutation documents.
 *
 * Checked here because GitHub reports a wrong input or payload field name as
 * **HTTP 200 with an `errors` array**, not as a failure — so a typo in one of
 * these strings does not look like a broken request, it looks like a comment
 * that quietly did not save. Section 7 of the API reference describes the only
 * other check that catches it, and that one needs a network and a token.
 *
 * Two families of assertion:
 *
 * - The input field names, spelled out one at a time, because the schema is not
 *   consistent about them and consistency is exactly what a reader assumes.
 * - That every comment selection carries the same fields, so a comment coming
 *   back from a mutation can be merged into state beside one that came from the
 *   read query without half its fields arriving undefined.
 */

import { describe, expect, it } from 'vitest';
import {
  ADD_REPLY,
  ADD_THREAD,
  DELETE_COMMENT,
  UPDATE_COMMENT,
} from './mutations';
import { REVIEW_THREAD_FIELDS } from './queries';

/** The mutation documents that hand back a comment to be shown. */
const COMMENT_BEARING = { ADD_THREAD, ADD_REPLY, UPDATE_COMMENT };

describe('editing a comment', () => {
  it('names the comment by the input field the update mutation actually takes', () => {
    // `pullRequestReviewCommentId` here and a bare `id` on the delete beside
    // it. The asymmetry is the schema's, introspected 2026-09-05; guessing
    // either way round costs a silent 200.
    expect(UPDATE_COMMENT).toContain('$pullRequestReviewCommentId: ID!');
    expect(UPDATE_COMMENT).toContain(
      'pullRequestReviewCommentId: $pullRequestReviewCommentId',
    );
  });

  it('sends the whole body, because the mutation replaces rather than patches', () => {
    expect(UPDATE_COMMENT).toContain('$body: String!');
  });

  it('reads the edited comment back off the payload field that carries it', () => {
    expect(UPDATE_COMMENT).toContain('pullRequestReviewComment {');
  });
});

describe('deleting a comment', () => {
  it('names the comment by `id`, which is not what the update beside it takes', () => {
    // Introspected 2026-09-05: `DeletePullRequestReviewCommentInput` has
    // exactly `clientMutationId` and `id`. Sending
    // `pullRequestReviewCommentId` is a validation error GitHub answers 200 to.
    expect(DELETE_COMMENT).toContain('$id: ID!');
    expect(DELETE_COMMENT).toContain('input: { id: $id }');
    expect(DELETE_COMMENT).not.toContain('pullRequestReviewCommentId');
  });

  it('does not select the comment it just destroyed', () => {
    // The payload offers `pullRequestReviewComment`, and selecting it would
    // invite a caller to merge a deleted comment back into state.
    expect(DELETE_COMMENT).not.toContain('pullRequestReviewComment');
  });
});

describe('the comment selections', () => {
  for (const [name, document] of Object.entries(COMMENT_BEARING)) {
    it(`${name} asks whether the viewer may edit and delete what it returns`, () => {
      // Without these two the comment a reviewer has just written comes back
      // with both flags falsy, so the affordance to fix a typo in it is absent
      // until the page is reloaded — which is the moment it is wanted most.
      expect(document).toContain('viewerCanUpdate');
      expect(document).toContain('viewerCanDelete');
    });
  }

  it('matches the read query, so a mutated comment merges beside a fetched one', () => {
    // Not a spelling check: a thread merged from a mutation payload sits in the
    // same list as one from PULL_REQUEST_QUERY, and a field selected by only
    // one of them arrives undefined on half the rows.
    for (const field of ['id', 'body', 'createdAt', 'url', 'viewerCanUpdate', 'viewerCanDelete']) {
      expect(REVIEW_THREAD_FIELDS).toContain(field);
      expect(ADD_THREAD).toContain(field);
      expect(ADD_REPLY).toContain(field);
    }
  });
});
