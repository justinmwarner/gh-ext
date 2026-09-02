import { describe, expect, it } from 'vitest';
import { MAX_PAGES, type Connection, collectConnection } from './pagination';

const page = <T>(nodes: (T | null)[], cursor: string | null): Connection<T> => ({
  nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});

const never = async (): Promise<Connection<string>> => {
  throw new Error('should not have asked for another page');
};

describe('collectConnection', () => {
  it('returns the first page untouched when there is no next page', async () => {
    const result = await collectConnection(page(['a', 'b'], null), never);

    expect(result).toEqual({ nodes: ['a', 'b'], truncated: false });
  });

  it('treats a missing connection as empty rather than throwing', async () => {
    expect(await collectConnection<string>(null, never)).toEqual({
      nodes: [],
      truncated: false,
    });
    expect(await collectConnection<string>(undefined, never)).toEqual({
      nodes: [],
      truncated: false,
    });
  });

  it('drops the nulls GraphQL leaves in a nodes list', async () => {
    const result = await collectConnection(page(['a', null, 'b'], null), never);

    expect(result.nodes).toEqual(['a', 'b']);
  });

  it('follows cursors until hasNextPage is false and concatenates in order', async () => {
    const asked: string[] = [];
    const result = await collectConnection(page(['a'], 'c1'), async (cursor) => {
      asked.push(cursor);
      return cursor === 'c1' ? page(['b', 'c'], 'c2') : page(['d'], null);
    });

    expect(asked).toEqual(['c1', 'c2']);
    expect(result).toEqual({ nodes: ['a', 'b', 'c', 'd'], truncated: false });
  });

  it('stops at the page cap and reports truncation', async () => {
    let fetched = 0;
    const result = await collectConnection(
      page(['a'], 'more'),
      async () => {
        fetched += 1;
        return page(['x'], 'more');
      },
      3,
    );

    // Three pages in total: the first, plus two follow-ups.
    expect(fetched).toBe(2);
    expect(result).toEqual({ nodes: ['a', 'x', 'x'], truncated: true });
  });

  it('has a cap even when the caller does not name one', async () => {
    let fetched = 0;
    const result = await collectConnection(page(['a'], 'more'), async () => {
      fetched += 1;
      return page(['x'], 'more');
    });

    expect(fetched).toBe(MAX_PAGES - 1);
    expect(result.truncated).toBe(true);
  });

  it('reports truncation when a page promises more but hands back no cursor', async () => {
    // hasNextPage true with a null endCursor leaves nothing to ask for.
    // Looping on it would spin; pretending it was the end would lose the tail.
    const result = await collectConnection(
      { nodes: ['a'], pageInfo: { hasNextPage: true, endCursor: null } },
      never,
    );

    expect(result).toEqual({ nodes: ['a'], truncated: true });
  });

  it('reports truncation when a follow-up page comes back empty', async () => {
    const result = await collectConnection(page(['a'], 'c1'), async () => null);

    expect(result).toEqual({ nodes: ['a'], truncated: true });
  });
});
