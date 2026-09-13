import { describe, expect, it } from 'vitest';
import { FETCH_WINDOW_DAYS, dashboardSearches, titleSearch } from './searches';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const REPOS = ['acme/widgets', 'acme/gears'];

describe('dashboardSearches', () => {
  it('asks for nothing at all until a repository is opted in', () => {
    // The whole point of opting in is that a dashboard nobody has configured
    // does not go and read eighty-six pull requests to find out.
    expect(dashboardSearches([], NOW)).toBeNull();
  });

  it('scopes every search to the opted-in repositories', () => {
    const searches = dashboardSearches(REPOS, NOW);

    for (const query of Object.values(searches ?? {})) {
      expect(query).toContain('repo:acme/widgets');
      expect(query).toContain('repo:acme/gears');
    }
  });

  it('bounds every search to the fetch window', () => {
    // 90 days before 2026-09-13 is 2026-06-15.
    const searches = dashboardSearches(REPOS, NOW);

    for (const query of Object.values(searches ?? {})) {
      expect(query).toContain('updated:>=2026-06-15');
    }
  });

  it('keeps the four questions it was already asking', () => {
    const searches = dashboardSearches(REPOS, NOW);

    expect(searches?.requested).toContain('review-requested:@me');
    expect(searches?.mine).toContain('author:@me');
    expect(searches?.involved).toContain('involves:@me');
    expect(searches?.involved).toContain('-author:@me');
    expect(searches?.reviewed).toContain('reviewed-by:@me');
  });

  it('still asks for open pull requests, most recently moved first', () => {
    const searches = dashboardSearches(REPOS, NOW);

    for (const query of Object.values(searches ?? {})) {
      expect(query).toContain('is:pr');
      expect(query).toContain('is:open');
      expect(query).toContain('sort:updated-desc');
    }
  });

  it('is ninety days, and says so in one place', () => {
    expect(FETCH_WINDOW_DAYS).toBe(90);
  });
});

describe('titleSearch', () => {
  it('asks for nothing when there is nothing to look for', () => {
    expect(titleSearch('', REPOS)).toBeNull();
    expect(titleSearch('   ', REPOS)).toBeNull();
  });

  it('asks for nothing when no repository is opted in', () => {
    expect(titleSearch('cache', [])).toBeNull();
  });

  it('looks in the title, inside the opted-in repositories', () => {
    const query = titleSearch('cache', REPOS);

    expect(query).toContain('in:title');
    expect(query).toContain('repo:acme/widgets');
    expect(query).toContain('repo:acme/gears');
  });

  it('carries no date bound, because that is what it is for', () => {
    // The search exists to reach the pull requests the window excludes.
    expect(titleSearch('cache', REPOS)).not.toContain('updated:');
  });

  it('reaches closed and merged pull requests too', () => {
    // A pull request somebody is trying to find again is usually one that
    // already landed.
    expect(titleSearch('cache', REPOS)).not.toContain('is:open');
  });

  it('quotes what was typed, so a colon cannot smuggle in a qualifier', () => {
    // Verified against live GitHub on 2026-09-13: unquoted, typing
    // `repo:someone/else` into this box escapes the scope and returns that
    // repository's pull requests. Quoted, it does not.
    const query = titleSearch('repo:someone/else', REPOS);

    expect(query).toContain('"repo:someone/else"');
    expect(query).toContain('repo:acme/widgets');
  });

  it('drops a quote character rather than letting it close the quoting', () => {
    // GitHub documents no escape inside a quoted term, so an embedded quote
    // would end the phrase early and hand the rest of the text to the parser
    // as qualifiers.
    const query = titleSearch('say "hello" repo:x/y', REPOS);

    expect(query).toContain('"say hello repo:x/y"');
  });

  it('trims what was typed', () => {
    expect(titleSearch('  cache  ', REPOS)).toContain('"cache"');
  });

  it('keeps a multi-word phrase together', () => {
    expect(titleSearch('firebase CLI', REPOS)).toContain('"firebase CLI"');
  });
});
