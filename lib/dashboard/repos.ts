/**
 * Which repositories the dashboard watches, and which ones it had to admit it
 * could not see.
 *
 * Two lists, kept apart on purpose.
 *
 * **Discovered** is GitHub's answer to "where have I opened a pull request" —
 * `repositoriesContributedTo(contributionTypes: [PULL_REQUEST])`, which returns
 * private repositories too. It arrives complete, so the reviewer subtracts from
 * it rather than starting empty and having to remember what they own. That is
 * the difference between a list you can trust and a list you have to audit.
 *
 * **Watched** is the subset they ticked. Nothing is watched without being
 * ticked: a contributed-to list is routinely nineteen entries of scratch work,
 * and an unasked-for row is exactly the attention PRODUCT.md says this product
 * does not get to take.
 *
 * The two are separate because the features they feed cost different amounts.
 * "Pull requests I am involved in" is one search whatever the repository count.
 * "Every open pull request in these repositories" is one aliased field each.
 *
 * Pure: no DOM, no `chrome.*`, no network.
 */

/** One repository the account has opened a pull request in. */
export interface DiscoveredRepo {
  /** `owner/name`. The identity everywhere in this module. */
  nameWithOwner: string;
  isPrivate: boolean;
  /**
   * Whether the token could resolve it on the last attempt.
   *
   * A fine-grained token is scoped to chosen repositories, and one outside the
   * grant answers exactly what a repository that does not exist answers — a
   * `NOT_FOUND` with no way to tell the two apart (section 9 of the API
   * reference). So this is a fact about the last request rather than a claim
   * about the repository, and the copy that reports it has to say so.
   */
  reachable: boolean;
}

export interface RepoPartition {
  /** The names to actually query. Watched, discovered, and reachable. */
  querying: string[];
  /**
   * Watched, discovered, and refused. Reported rather than dropped: a
   * repository silently missing from a list the reviewer believes is complete
   * is the failure PRODUCT.md's fourth principle exists to prevent.
   */
  unreachable: DiscoveredRepo[];
  /** Discovered and not watched. What the picker offers to add. */
  available: DiscoveredRepo[];
}

/**
 * Split the discovered list by what the reviewer asked for and what the token
 * can actually reach.
 *
 * A watched name this discovery did not return is dropped from all three
 * lists. It is not silence — the name is still in the stored watch list and
 * comes back the moment discovery returns it again — it is a refusal to spend
 * a round trip on a repository GitHub has stopped listing, which would be a
 * guaranteed refusal on every load.
 */
export function partitionRepos(
  discovered: readonly DiscoveredRepo[],
  watched: readonly string[],
): RepoPartition {
  const wanted = new Set(watched);
  const querying: string[] = [];
  const unreachable: DiscoveredRepo[] = [];
  const available: DiscoveredRepo[] = [];

  for (const repo of discovered) {
    if (!wanted.has(repo.nameWithOwner)) {
      available.push(repo);
    } else if (repo.reachable) {
      querying.push(repo.nameWithOwner);
    } else {
      unreachable.push(repo);
    }
  }

  return { querying, unreachable, available };
}

/** Tick or untick one repository. */
export function toggleWatched(watched: readonly string[], nameWithOwner: string): string[] {
  return watched.includes(nameWithOwner)
    ? watched.filter((name) => name !== nameWithOwner)
    : [...watched, nameWithOwner];
}
