/**
 * The commit list on the Overview.
 *
 * The numbered strip above the diff is for stepping through a history you are
 * already reading; it says nothing but a number, on purpose. This is the other
 * half of that trade — the place where the numbers get their subjects back, so
 * a reviewer can decide *which* commit to read before they are in it.
 *
 * Two things a row has to do, and they must not be the same thing: scope the
 * diff to that commit, and open it on GitHub. A row that did both from one
 * click would make "let me look at this properly" mean "leave".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PrCommit } from '@/lib/github/types';
import { CommitLog } from './CommitLog';

const PR = { owner: 'acme', repo: 'widgets', number: 42 };

const commit = (n: number): PrCommit => ({
  oid: `${n}`.repeat(40),
  abbreviatedOid: `${n}`.repeat(7),
  messageHeadline: `Commit number ${n}`,
  committedDate: `2026-09-0${n}T10:00:00Z`,
  authorLogin: `dev${n}`,
  authorName: `Dev ${n}`,
  parentOid: n === 1 ? 'base' : `${n - 1}`.repeat(40),
});

const COMMITS = [commit(1), commit(2), commit(3)];

function mount(commits: readonly PrCommit[] = COMMITS) {
  const onReview = vi.fn<(commit: PrCommit) => void>();
  const view = render(<CommitLog commits={commits} pr={PR} onReview={onReview} />);
  return { ...view, onReview };
}

const rows = () => screen.getAllByRole('listitem');

describe('what it lists', () => {
  it('numbers the commits the same way the strip does, oldest first', () => {
    // A reviewer who reads "3" here and presses "3" up there has to get the
    // same commit, or the two controls are lying about each other.
    mount();

    expect(rows()).toHaveLength(3);
    expect(rows()[0]?.textContent).toContain('1');
    expect(rows()[0]?.textContent).toContain('Commit number 1');
  });

  it('gives each row its subject, its hash and who wrote it', () => {
    mount();

    const first = rows()[0]?.textContent ?? '';
    expect(first).toContain('1111111');
    expect(first).toContain('Commit number 1');
    expect(first).toContain('dev1');
  });

  it('says so rather than drawing an empty list', () => {
    // A pull request has at least one commit, so an empty list means the
    // lookup came back with nothing — which is a different thing from a pull
    // request with no commits, and the reviewer should not have to guess.
    mount([]);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText(/could not be read|no commits/i)).toBeDefined();
  });
});

describe('what a row does', () => {
  it('scopes the diff to that commit when the row is chosen', async () => {
    const { onReview } = mount();

    await userEvent.click(screen.getByRole('button', { name: /review commit 2/i }));

    expect(onReview).toHaveBeenCalledWith(COMMITS[1]);
  });

  it('opens the commit on GitHub from a link of its own', async () => {
    // A separate control, not the same click. A row that did both would make
    // "let me read this properly" mean "leave the page".
    mount();

    const link = screen.getByRole('link', { name: /commit 2222222 on github/i });
    expect(link.getAttribute('href')).toBe(
      `https://github.com/acme/widgets/commit/${'2'.repeat(40)}`,
    );
  });

  it('names both controls by the commit, since a digit is not a name', () => {
    mount();

    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
});
