/**
 * The search strings, built from what the reviewer opted into.
 *
 * Three jobs, and all of them are about not reading the whole account:
 *
 * - **Scope.** Nothing is fetched until a repository is ticked. `null` rather
 *   than an unscoped query is what makes that true rather than aspirational —
 *   there is no string this module can return that reads everything.
 * - **A window.** `updated:>=` ninety days back. Measured against the
 *   developing account on 2026-09-13, that alone took the authored search from
 *   eighty-six results to two.
 * - **A way past the window.** {@link titleSearch} drops the date bound and the
 *   `is:open` filter, because the pull request somebody is hunting for is
 *   usually one that already landed.
 *
 * Pure: no DOM, no `chrome.*`, no network. Every qualifier here was executed
 * against live GitHub on 2026-09-13 — including the one that proves the
 * quoting in {@link titleSearch} is load-bearing rather than tidy.
 */

/**
 * How far back the dashboard reads.
 *
 * Fixed rather than a setting, on PRODUCT.md's "do less, completely". Ninety
 * days is long enough that nothing anybody is still waiting on falls outside
 * it, and the title search reaches whatever does.
 */
export const FETCH_WINDOW_DAYS = 90;

export type SearchName = 'requested' | 'mine' | 'involved' | 'reviewed';

/** `repo:a/b repo:c/d`. Multiple qualifiers are OR'd — verified 2026-09-13. */
const scopeOf = (repos: readonly string[]): string =>
  repos.map((repo) => `repo:${repo}`).join(' ');

/** `YYYY-MM-DD`, which is the only date format the search qualifiers take. */
function isoDay(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * The four questions, scoped and bounded, or null when nothing is opted in.
 *
 * Null is the contract that makes opting in mean something. A caller holding
 * one of these cannot accidentally read the whole account, because this module
 * will not build a query that does.
 *
 * The four are unchanged in substance: `involves:` still does not cover a
 * review request, so `requested` is still its own search, and two still
 * exclude `author:@me` so the merge has nothing to deduplicate.
 */
export function dashboardSearches(
  repos: readonly string[],
  now: number,
): Record<SearchName, string> | null {
  if (repos.length === 0) return null;

  const scope = scopeOf(repos);
  const since = `updated:>=${isoDay(now - FETCH_WINDOW_DAYS * 86_400_000)}`;
  const common = `is:pr is:open ${scope} ${since} sort:updated-desc`;

  return {
    requested: `${common} review-requested:@me`,
    mine: `${common} author:@me`,
    involved: `${common} involves:@me -author:@me`,
    reviewed: `${common} reviewed-by:@me -author:@me`,
  };
}

/**
 * What the reviewer typed, as a query that cannot mean anything else.
 *
 * The quoting is the whole of this function's risk. Search qualifiers are
 * `name:value` pairs separated by spaces, and the box takes free text — so
 * `repo:someone/else` typed here is, unquoted, a second scope. Executed
 * against live GitHub on 2026-09-13: unquoted it returned that repository's
 * pull requests alongside the scoped one; quoted it returned nothing from
 * outside the scope, and a quoted ordinary phrase still matched exactly what
 * the bare one did.
 *
 * An embedded `"` is dropped rather than escaped. GitHub documents no escape
 * inside a quoted term, so a quote would close the phrase early and hand
 * everything after it to the parser as qualifiers — which is the exact hole
 * the quoting exists to close.
 */
export function titleSearch(terms: string, repos: readonly string[]): string | null {
  const cleaned = terms.replaceAll('"', '').trim();
  if (cleaned === '' || repos.length === 0) return null;

  // No `is:open` and no `updated:` on purpose. This is the way to the pull
  // requests the window and the state filter leave out.
  return `is:pr ${scopeOf(repos)} in:title "${cleaned}" sort:updated-desc`;
}
