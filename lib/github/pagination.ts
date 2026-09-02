/**
 * Walking a GraphQL connection to its end, or admitting that it did not.
 *
 * `files` and `reviewThreads` both cap at 100 nodes per page, and a pull
 * request with 150 changed files is ordinary. Reading only the first page loses
 * the tail with no error and no gap in the UI — the reviewer cannot tell "no
 * more comments" from "we dropped them" — so this module either finishes the
 * walk or says so in `truncated`.
 *
 * Pure: it is handed a page and a way to ask for the next one, and knows
 * nothing about GitHub, transports or documents.
 */

/**
 * The most pages of any one connection this will read.
 *
 * At 100 nodes a page that is 2000 files or threads. The cap exists so a
 * pathological or misbehaving connection — one that keeps saying `hasNextPage`
 * — cannot spin the worker or burn the hour's quota. Hitting it is reported,
 * never silently absorbed.
 */
export const MAX_PAGES = 20;

export interface PageInfo {
  hasNextPage?: boolean | null;
  endCursor?: string | null;
}

/** A connection, as loosely as GraphQL may actually return one. */
export interface Connection<T> {
  nodes?: (T | null)[] | null;
  pageInfo?: PageInfo | null;
}

export interface Paged<T> {
  nodes: T[];
  /** True when nodes are known to be missing from the end of the list. */
  truncated: boolean;
}

/** GraphQL nulls out individual nodes it could not resolve. */
function liveNodes<T>(connection: Connection<T> | null | undefined): T[] {
  const nodes = connection?.nodes ?? [];
  return nodes.filter((node): node is T => node !== null && node !== undefined);
}

/**
 * Concatenate every page of a connection, starting from one already in hand.
 *
 * `truncated` is true whenever the walk stopped with pages still outstanding:
 * because the cap was reached, because a page promised more without handing
 * back a cursor, or because a follow-up page came back empty. All three are the
 * same fact to a caller — the list is short — and none of them is an error, so
 * none of them throws.
 */
export async function collectConnection<T>(
  first: Connection<T> | null | undefined,
  nextPage: (cursor: string) => Promise<Connection<T> | null | undefined>,
  maxPages: number = MAX_PAGES,
): Promise<Paged<T>> {
  const nodes = liveNodes(first);
  let info = first?.pageInfo ?? null;
  let pages = 1;

  while (info?.hasNextPage === true) {
    const cursor = info.endCursor;
    // Nothing to ask for, and nothing to be gained by asking again.
    if (typeof cursor !== 'string' || cursor === '') return { nodes, truncated: true };
    if (pages >= maxPages) return { nodes, truncated: true };

    const page = await nextPage(cursor);
    pages += 1;
    // A page that did not resolve at all ends the walk; the caller is told the
    // list is short rather than handed a silently complete-looking one.
    if (page === null || page === undefined) return { nodes, truncated: true };

    nodes.push(...liveNodes(page));
    info = page.pageInfo ?? null;
  }

  return { nodes, truncated: false };
}
