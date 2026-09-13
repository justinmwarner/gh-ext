import { describe, expect, it } from 'vitest';
import { type DiscoveredRepo, partitionRepos, toggleWatched } from './repos';

const repo = (
  nameWithOwner: string,
  overrides: Partial<DiscoveredRepo> = {},
): DiscoveredRepo => ({
  nameWithOwner,
  isPrivate: false,
  reachable: true,
  ...overrides,
});

describe('partitionRepos', () => {
  it('queries only the repositories that are both watched and reachable', () => {
    const discovered = [repo('acme/widgets'), repo('acme/gears'), repo('acme/bolts')];

    const result = partitionRepos(discovered, ['acme/widgets', 'acme/gears']);

    expect(result.querying).toEqual(['acme/widgets', 'acme/gears']);
  });

  it('names a watched repository the token cannot reach rather than dropping it', () => {
    // The failure this exists to prevent: a repository silently absent from a
    // list the reviewer believes is complete. PRODUCT.md principle 4.
    const discovered = [repo('acme/widgets'), repo('acme/secret', { reachable: false })];

    const result = partitionRepos(discovered, ['acme/widgets', 'acme/secret']);

    expect(result.querying).toEqual(['acme/widgets']);
    expect(result.unreachable.map((r) => r.nameWithOwner)).toEqual(['acme/secret']);
  });

  it('does not report an unreachable repository the reviewer never asked to watch', () => {
    const discovered = [repo('acme/widgets'), repo('acme/secret', { reachable: false })];

    const result = partitionRepos(discovered, ['acme/widgets']);

    expect(result.unreachable).toEqual([]);
  });

  it('offers the rest as available to add', () => {
    const discovered = [repo('acme/widgets'), repo('acme/gears')];

    const result = partitionRepos(discovered, ['acme/widgets']);

    expect(result.available.map((r) => r.nameWithOwner)).toEqual(['acme/gears']);
  });

  it('ignores a watched name that discovery no longer returns', () => {
    // A repository can leave the contributed-to list — the account lost access,
    // or it was deleted. Querying it would be a guaranteed 404 on every load.
    const result = partitionRepos([repo('acme/widgets')], ['acme/widgets', 'acme/gone']);

    expect(result.querying).toEqual(['acme/widgets']);
    expect(result.unreachable).toEqual([]);
  });
});

describe('toggleWatched', () => {
  it('adds a repository that was not being watched', () => {
    expect(toggleWatched(['acme/widgets'], 'acme/gears')).toEqual([
      'acme/widgets',
      'acme/gears',
    ]);
  });

  it('removes one that was', () => {
    expect(toggleWatched(['acme/widgets', 'acme/gears'], 'acme/widgets')).toEqual([
      'acme/gears',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const before = ['acme/widgets'];

    toggleWatched(before, 'acme/gears');

    expect(before).toEqual(['acme/widgets']);
  });
});
