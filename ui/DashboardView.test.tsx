/**
 * The list, its headings, and the three things it has to admit.
 *
 * The component takes its data rather than fetching it, so nothing here mocks
 * a worker: a failure in this file always means the list drew the wrong thing.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PrSummary } from '@/lib/dashboard/buckets';
import type { Overrides } from '@/lib/dashboard/overrides';
import type { DashboardPayload } from '@/lib/messages';
import type { SearchState } from './useDashboard';
import { DashboardView } from './DashboardView';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-13T12:00:00Z');

function pr(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    id: 'PR_1',
    number: 7,
    title: 'Do the thing',
    url: 'https://github.com/acme/widgets/pull/7',
    repo: 'acme/widgets',
    isPrivate: false,
    author: 'someone',
    isDraft: false,
    state: 'OPEN',
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    headRefOid: 'aaa',
    viewerDidAuthor: false,
    reviewRequestedFromViewer: false,
    reviewDecision: null,
    viewerLatestReview: null,
    reviewRequestCount: 0,
    checks: null,
    mergeStateStatus: null,
    unresolvedCount: 0,
    unresolvedNotByViewer: 0,
    threadsTruncated: false,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    isReadByViewer: true,
    ...overrides,
  };
}

const payload = (prs: PrSummary[], extra: Partial<DashboardPayload> = {}): DashboardPayload => ({
  viewerLogin: 'me',
  prs,
  truncated: [],
  denied: [],
  fetchedAt: NOW,
  ...extra,
});

const REPOS = {
  discovered: [
    { nameWithOwner: 'acme/widgets', isPrivate: false, reachable: true },
    { nameWithOwner: 'acme/gears', isPrivate: false, reachable: true },
  ],
  watched: ['acme/widgets'],
  discovering: false,
  asked: true,
  onToggle: () => {},
  onDiscover: () => {},
};

function draw(
  data: DashboardPayload,
  options: {
    overrides?: Overrides;
    onOverride?: () => void;
    search?: SearchState;
    onSearch?: (terms: string) => void;
    onClearSearch?: () => void;
  } = {},
) {
  return render(
    <DashboardView
      payload={data}
      overrides={options.overrides ?? {}}
      stalenessDays={14}
      now={NOW}
      onOverride={options.onOverride ?? vi.fn()}
      onRefresh={vi.fn()}
      repos={REPOS}
      search={options.search ?? { status: 'idle' }}
      onSearch={options.onSearch ?? vi.fn()}
      onClearSearch={options.onClearSearch ?? vi.fn()}
    />,
  );
}

describe('DashboardView', () => {
  it('groups rows under the bucket they belong to', () => {
    draw(payload([pr({ id: 'A', reviewRequestedFromViewer: true })]));

    const section = screen.getByRole('region', { name: /waiting on you/i });

    expect(within(section).getByText('Do the thing')).toBeTruthy();
  });

  it('leaves out a bucket with nothing in it', () => {
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    expect(screen.queryByRole('region', { name: /ready to merge/i })).toBeNull();
  });

  it('shows what is waiting on the reviewer above everything else', () => {
    draw(
      payload([
        pr({ id: 'A', isDraft: true, title: 'A draft' }),
        pr({ id: 'B', reviewRequestedFromViewer: true, title: 'Needs me' }),
      ]),
    );

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

    expect(headings[0]).toMatch(/waiting on you/i);
    expect(headings[headings.length - 1]).toMatch(/drafts/i);
  });

  it('names the repository and number on every row', () => {
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    expect(screen.getByText('acme/widgets#7')).toBeTruthy();
  });

  it('gives the one fact that decided the row', () => {
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    expect(screen.getByText('Your review was requested')).toBeTruthy();
  });

  it('opens the review page rather than github.com', () => {
    // The whole point of the list is that every row is an entry to the fast
    // review page. A row linking to github.com would be a slower way to reach
    // what the reviewer already had.
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    const link = screen.getByRole('link', { name: /do the thing/i });

    expect(link.getAttribute('href')).toBe('#/pr/acme/widgets/7');
  });

  it('says how long ago the pull request last moved', () => {
    draw(payload([pr({ reviewRequestedFromViewer: true, updatedAt: NOW - 3 * DAY })]));

    expect(screen.getByText(/3 days ago/)).toBeTruthy();
  });
});

describe('DashboardView, what it has to admit', () => {
  it('says when a search stopped short of what it counted', () => {
    draw(
      payload([pr({ reviewRequestedFromViewer: true })], {
        truncated: [{ search: 'mine', shown: 50, total: 86 }],
      }),
    );

    expect(screen.getByText(/50 of 86/)).toBeTruthy();
  });

  it('says when GitHub refused part of the answer', () => {
    draw(
      payload([pr({ reviewRequestedFromViewer: true })], {
        denied: [
          {
            type: 'FORBIDDEN',
            path: 'mine.nodes.N.reviewThreads',
            message: 'nope',
            count: 1,
          },
        ],
      }),
    );

    expect(screen.getByText(/could not/i)).toBeTruthy();
  });

  it('says why a row is not where the reviewer left it', () => {
    const subject = pr({ reviewRequestedFromViewer: true });
    const overrides: Overrides = {
      PR_1: { bucket: 'quiet', headRefOid: 'older', seenAt: NOW - DAY, setAt: NOW - DAY },
    };

    draw(payload([subject]), { overrides });

    expect(screen.getByText('Moved back: there was a push')).toBeTruthy();
  });

  it('draws a row where the reviewer put it while the override still holds', () => {
    const subject = pr({ reviewRequestedFromViewer: true });
    const overrides: Overrides = {
      PR_1: { bucket: 'quiet', headRefOid: 'aaa', seenAt: subject.updatedAt, setAt: NOW },
    };

    draw(payload([subject]), { overrides });

    const section = screen.getByRole('region', { name: /quiet/i });

    expect(within(section).getByText('Do the thing')).toBeTruthy();
  });
});

describe('DashboardView, moving a row', () => {
  it('reports which bucket the reviewer chose', async () => {
    const onOverride = vi.fn();
    draw(payload([pr({ reviewRequestedFromViewer: true })]), { onOverride });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /move do the thing/i }),
      'quiet',
    );

    expect(onOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 'PR_1' }), 'quiet');
  });

  it('offers to put a moved row back', async () => {
    const onOverride = vi.fn();
    const subject = pr({ reviewRequestedFromViewer: true });
    const overrides: Overrides = {
      PR_1: { bucket: 'quiet', headRefOid: 'aaa', seenAt: subject.updatedAt, setAt: NOW },
    };

    draw(payload([subject]), { overrides, onOverride });

    await userEvent.click(screen.getByRole('button', { name: /put back/i }));

    expect(onOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 'PR_1' }), null);
  });
});

describe('DashboardView, with nothing in it', () => {
  it('says so in one plain sentence', () => {
    draw(payload([]));

    expect(screen.getByText(/nothing is waiting/i)).toBeTruthy();
  });

  it('draws no illustration and no exclamation', () => {
    // PRODUCT.md names illustrated empty states as an anti-reference.
    const { container } = draw(payload([]));

    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/!/);
  });
});

describe('DashboardView, the repositories panel', () => {
  it('says which repositories the list is reading', () => {
    // The list is deliberately partial, so what it is partial *to* has to be
    // on the page rather than buried in a settings screen.
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    expect(screen.getByText(/1 of 2 repositories/i)).toBeTruthy();
  });

  it('keeps the picker folded away until it is asked for', () => {
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    expect(screen.queryByRole('checkbox', { name: /acme\/widgets/ })).toBeNull();
  });

  it('opens the picker in place', async () => {
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    await userEvent.click(screen.getByRole('button', { name: /1 of 2 repositories/i }));

    expect(screen.getByRole('checkbox', { name: /acme\/widgets/ })).toBeTruthy();
  });
});

describe('DashboardView, the repositories panel, before discovery', () => {
  it('does not claim a total it has not been told', () => {
    // Discovery is lazy, so the panel is routinely drawn knowing what is
    // watched and not yet what exists. "2 of 0 repositories" is arithmetic
    // nobody can read as anything but a bug.
    render(
      <DashboardView
        payload={payload([])}
        overrides={{}}
        stalenessDays={14}
        now={NOW}
        onOverride={vi.fn()}
        onRefresh={vi.fn()}
        repos={{ ...REPOS, discovered: [], asked: false }}
        search={{ status: 'idle' }}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /reading 1 repository/i })).toBeTruthy();
    expect(screen.queryByText(/of 0/)).toBeNull();
  });

  it('says one repository rather than 1 repositories', () => {
    render(
      <DashboardView
        payload={payload([])}
        overrides={{}}
        stalenessDays={14}
        now={NOW}
        onOverride={vi.fn()}
        onRefresh={vi.fn()}
        repos={{ ...REPOS, discovered: [], asked: false }}
        search={{ status: 'idle' }}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /1 repository,/i })).toBeTruthy();
  });
});

describe('DashboardView, the title search', () => {
  it('offers a box that says what it reaches', () => {
    draw(payload([pr({ reviewRequestedFromViewer: true })]));

    expect(screen.getByRole('searchbox', { name: /search/i })).toBeTruthy();
  });

  it('reports what was typed when the form is submitted', async () => {
    const onSearch = vi.fn();
    draw(payload([pr({ reviewRequestedFromViewer: true })]), { onSearch });

    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'cache{Enter}');

    expect(onSearch).toHaveBeenCalledWith('cache');
  });

  it('draws results as one flat list rather than in buckets', async () => {
    // These are matches, not work. A merged pull request has no turn to be
    // whose, so sorting it into "waiting on others" would be an invention.
    draw(payload([pr({ reviewRequestedFromViewer: true })]), {
      search: {
        status: 'done',
        terms: 'cache',
        results: {
          viewerLogin: 'me',
          total: 1,
          prs: [pr({ id: 'S1', title: 'Cache the diff', state: 'MERGED' })],
        },
      },
    });

    expect(screen.getByText('Cache the diff')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /waiting on you/i })).toBeNull();
  });

  it('says how many matched and how many it is showing', () => {
    draw(payload([]), {
      search: {
        status: 'done',
        terms: 'cache',
        results: { viewerLogin: 'me', total: 120, prs: [pr({ id: 'S1' })] },
      },
    });

    expect(screen.getByText(/1 of 120/)).toBeTruthy();
  });

  it('says plainly when nothing matched', () => {
    draw(payload([]), {
      search: {
        status: 'done',
        terms: 'nonsense',
        results: { viewerLogin: 'me', total: 0, prs: [] },
      },
    });

    expect(screen.getByText(/nothing matched/i)).toBeTruthy();
  });

  it('offers a way back to the list', async () => {
    const onClearSearch = vi.fn();
    draw(payload([]), {
      onClearSearch,
      search: {
        status: 'done',
        terms: 'cache',
        results: { viewerLogin: 'me', total: 0, prs: [] },
      },
    });

    await userEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect(onClearSearch).toHaveBeenCalledOnce();
  });

  it('marks a result that is no longer open', () => {
    draw(payload([]), {
      search: {
        status: 'done',
        terms: 'cache',
        results: {
          viewerLogin: 'me',
          total: 1,
          prs: [pr({ id: 'S1', title: 'Cache the diff', state: 'MERGED' })],
        },
      },
    });

    expect(screen.getByText('Merged')).toBeTruthy();
  });
});
