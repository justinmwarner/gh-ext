/**
 * The read documents.
 *
 * Two things are checked here that only the GitHub API would otherwise catch —
 * at runtime, on a large pull request nobody tested with. That every fragment a
 * document spreads is also defined in that document, because GraphQL rejects
 * the whole request otherwise. And that the pagination queries carry the very
 * same node selection as the first page, because a merged list assembled from
 * two different selections is half-populated and nothing says so.
 */

import { describe, expect, it } from 'vitest';
import {
  FILES_PAGE_QUERY,
  FILE_FIELDS,
  PULL_REQUEST_QUERY,
  REQUESTED_REVIEWER_FIELDS,
  REVIEW_THREADS_PAGE_QUERY,
  REVIEW_THREAD_FIELDS,
} from './queries';

const DOCUMENTS = {
  PULL_REQUEST_QUERY,
  FILES_PAGE_QUERY,
  REVIEW_THREADS_PAGE_QUERY,
};

const namesFrom = (document: string, pattern: RegExp): string[] => [
  ...new Set([...document.matchAll(pattern)].map((match) => match[1] ?? '')),
];

const spreadsIn = (document: string): string[] =>
  namesFrom(document, /\.\.\.([A-Za-z_][A-Za-z0-9_]*)/g);

const definitionsIn = (document: string): string[] =>
  namesFrom(document, /fragment\s+([A-Za-z_][A-Za-z0-9_]*)\s+on\s/g);

/** Named spreads only — `... on Type` is inline and carries no fragment name. */
const undefinedSpreads = (document: string): string[] => {
  const defined = new Set(definitionsIn(document));
  return spreadsIn(document).filter((name) => name !== 'on' && !defined.has(name));
};

describe('undefinedSpreads', () => {
  it('finds a spread with no matching definition', () => {
    // The check has to be able to fail, or the cases below prove nothing.
    expect(undefinedSpreads('query Q { a { ...Missing } }')).toEqual(['Missing']);
  });

  it('is not fooled by an inline `... on Type` spread', () => {
    expect(undefinedSpreads('query Q { a { ... on User { login } } }')).toEqual([]);
  });
});

describe('the read documents', () => {
  for (const [name, document] of Object.entries(DOCUMENTS)) {
    it(`${name} defines every fragment it spreads`, () => {
      expect(undefinedSpreads(document)).toEqual([]);
    });
  }

  it('paginates files with the very same node selection as the first page', () => {
    expect(spreadsIn(PULL_REQUEST_QUERY)).toContain('FileFields');
    expect(spreadsIn(FILES_PAGE_QUERY)).toContain('FileFields');
    expect(PULL_REQUEST_QUERY).toContain(FILE_FIELDS);
    expect(FILES_PAGE_QUERY).toContain(FILE_FIELDS);
  });

  it('paginates review threads with the very same node selection', () => {
    expect(spreadsIn(PULL_REQUEST_QUERY)).toContain('ReviewThreadFields');
    expect(spreadsIn(REVIEW_THREADS_PAGE_QUERY)).toContain('ReviewThreadFields');
    expect(PULL_REQUEST_QUERY).toContain(REVIEW_THREAD_FIELDS);
    expect(REVIEW_THREADS_PAGE_QUERY).toContain(REVIEW_THREAD_FIELDS);
  });

  it('selects totalCount on the thread comment page it does not follow', () => {
    // comments(first: 50) is not paginated, so the shortfall has to be visible.
    expect(REVIEW_THREAD_FIELDS).toMatch(/comments\(first: 50\) \{\s*totalCount/);
  });

  it('spreads every member of the RequestedReviewer union it knows about', () => {
    // Selecting only `... on User` is what made teams and bots vanish.
    for (const member of ['User', 'Bot', 'Mannequin', 'Team', 'EnterpriseTeam']) {
      expect(REQUESTED_REVIEWER_FIELDS).toContain(`... on ${member} {`);
    }
    // __typename is what lets a sixth member degrade instead of disappearing.
    expect(REQUESTED_REVIEWER_FIELDS).toMatch(/on RequestedReviewer \{\s*__typename/);
    expect(PULL_REQUEST_QUERY).toContain(REQUESTED_REVIEWER_FIELDS);
  });

  it('asks for the cursors it intends to follow', () => {
    expect(PULL_REQUEST_QUERY).toMatch(/files\(first: 100\) \{\s*totalCount\s*pageInfo/);
    expect(PULL_REQUEST_QUERY).toMatch(
      /reviewThreads\(first: 100\) \{\s*totalCount\s*pageInfo/,
    );
    expect(FILES_PAGE_QUERY).toContain('files(first: 100, after: $after)');
    expect(REVIEW_THREADS_PAGE_QUERY).toContain('reviewThreads(first: 100, after: $after)');
  });
});
