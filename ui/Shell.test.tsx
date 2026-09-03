/**
 * The loaded layout.
 *
 * An identity bar, a vertical switcher, and one of three views in the space
 * that is left. These tests pin the frame — which views exist, that switching
 * reaches them, and that the one thing no view may do is lose a thread.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import { request } from './background';
import {
  fileFixture,
  prPayload,
  prPayloadWithFiles,
  reviewThread,
} from './prPayload.fixture';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
});

describe('Shell', () => {
  it('renders the top bar, the view switcher and the diff', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeDefined();
    expect(screen.getByRole('main')).toBeDefined();
  });

  it('offers the three views down the left, and opens on the diff', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(
      screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label')),
    ).toEqual(['Files', 'Conversations', 'Overview']);
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe(
      'vertical',
    );
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe(
      'Files',
    );
  });

  it('keeps every view mounted so the diff does not lose its place', async () => {
    // `visibility`, never `display: none` and never unmounting. CodeView
    // virtualizes against a scrollport it measures, and anything that takes
    // that measurement to zero costs the reviewer their scroll position and
    // every line of context they expanded to reach it.
    render(
      <Shell
        retry={() => {}}
        payload={prPayloadWithFiles([fileFixture({ path: 'src/app.ts' })])}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: /overview/i }));

    const files = document.getElementById('review-view-files');
    expect(files?.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
    expect(files?.style.visibility).toBe('hidden');
  });

  it('says when a list was cut short, and offers the way out', () => {
    // The worst outcome is a reviewer who cannot tell "no more comments" from
    // "we dropped them", so a capped list is announced rather than absorbed.
    render(
      <Shell retry={() => {}} payload={prPayload({ truncated: { files: true, threads: true } })} />,
    );

    const notice = screen.getByRole('alert');
    expect(notice.textContent).toMatch(/files/i);
    expect(notice.textContent).toMatch(/comment|thread/i);
    expect(
      screen.getAllByRole('link', { name: /open in github/i }).length,
    ).toBeGreaterThan(0);
  });

  it('says nothing about truncation for an ordinary pull request', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives every changed file a card in the main column', () => {
    render(
      <Shell
        retry={() => {}}
        payload={prPayloadWithFiles([
          fileFixture({ path: 'src/app.ts', additions: 12, deletions: 3 }),
          fileFixture({ path: 'README.md' }),
        ])}
      />,
    );

    const column = screen.getByRole('main');
    expect(column.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
    expect(column.querySelector('[data-file-card="README.md"]')).not.toBeNull();
  });

  it('reads the counts and the viewed state off the payload, not the patch', () => {
    render(
      <Shell
        retry={() => {}}
        payload={prPayloadWithFiles([
          fileFixture({
            path: 'src/app.ts',
            additions: 12,
            deletions: 3,
            viewedState: 'VIEWED',
          }),
        ])}
      />,
    );

    // Scoped to the card's own counts. The bar above the diff totals the same
    // numbers for a one-file pull request, and an unscoped query would be
    // satisfied by that total whatever the card said.
    const counts = document.querySelector('.file-counts');
    expect(counts?.textContent).toContain('+12');
    expect(counts?.textContent).toContain('−3');
    expect(
      (screen.getByRole('checkbox', { name: /src\/app\.ts/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('puts the file tree in the Files view, beside the diff', () => {
    render(<Shell retry={() => {}} payload={prPayloadWithFiles([fileFixture({ path: 'src/app.ts' })])} />);

    const tree = screen.getByRole('navigation', { name: /changed files/i });
    expect(document.getElementById('review-view-files')?.contains(tree)).toBe(true);
    expect(tree.querySelector('file-tree-container')).not.toBeNull();
  });

  it('says so in both regions when a pull request changed nothing', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.getAllByText(/no changed files/i).length).toBe(2);
  });

  it('gives the file tree a resize handle the keyboard can reach', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    const separator = screen.getByRole('separator', { name: /sidebar/i });
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('tabindex')).toBe('0');
  });

  it('goes back to the diff when a conversation asks to be shown', async () => {
    // The whole point of the Go to button. A thread the reviewer asked to see
    // is not shown by a view the diff is not in.
    render(
      <Shell
        retry={() => {}}
        payload={{
          ...prPayloadWithFiles([fileFixture({ path: 'src/app.ts' })]),
          threads: [reviewThread({ path: 'src/app.ts', line: 2 })],
        }}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: /conversations/i }));
    await userEvent.click(screen.getByRole('button', { name: /go to/i }));

    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe(
      'Files',
    );
  });
});

describe('the pending-review footer', () => {
  it('is absent while browsing', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('appears once the top bar starts a review', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: true,
      data: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } },
    });
    render(<Shell retry={() => {}} payload={prPayload()} />);

    await user.click(screen.getByRole('button', { name: /start a review/i }));

    await waitFor(() => {
      expect(screen.getByRole('contentinfo')).toBeDefined();
    });
    expect(screen.getByRole('contentinfo').textContent).toMatch(/nothing queued yet/i);
  });

  it('is already there for a review GitHub still has open', () => {
    render(
      <Shell
        retry={() => {}}
        payload={prPayload({
          pullRequest: {
            ...prPayload().pullRequest,
            viewerLatestReview: { id: 'PRR_open', state: 'PENDING' },
          },
        })}
      />,
    );

    expect(screen.getByRole('contentinfo')).toBeDefined();
  });
});

describe('the Conversations view', () => {
  it('lists a thread whose file has no card in the column', async () => {
    // The per-file unanchorable section is rendered by `CodeView`'s custom
    // header, so it exists only for files the column has drawn. A pull request
    // whose `files` connection was capped still has threads on the files that
    // were dropped, and this list is the only place they can appear.
    render(
      <Shell
        retry={() => {}}
        payload={{
          ...prPayloadWithFiles([fileFixture({ path: 'src/app.ts' })]),
          threads: [reviewThread({ path: 'lib/dropped.ts', line: 3 })],
          truncated: { files: true, threads: false },
        }}
      />,
    );

    // The column does draw cards — so the absence below is the file missing,
    // not the column failing to render in jsdom.
    const column = screen.getByRole('main');
    expect(column.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();

    // Nothing in the diff column mentions the file or the thread at all: no
    // card, no per-file section, and no annotation.
    expect(column.querySelector('[data-file-card="lib/dropped.ts"]')).toBeNull();
    expect(column.querySelector('[data-unanchored="lib/dropped.ts"]')).toBeNull();
    expect(
      column.querySelector('[data-thread="PRRT_lib/dropped.ts:3"]'),
    ).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /conversations/i }));

    expect(
      document.getElementById('review-view-conversations')?.textContent,
    ).toContain('lib/dropped.ts');
  });

  it('lists threads on files the reviewer has not scrolled to', async () => {
    render(
      <Shell
        retry={() => {}}
        payload={{
          ...prPayloadWithFiles([
            fileFixture({ path: 'src/app.ts' }),
            fileFixture({ path: 'src/deep/last.ts' }),
          ]),
          threads: [reviewThread({ path: 'src/deep/last.ts', line: 2 })],
        }}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: /conversations/i }));

    expect(
      document.getElementById('review-view-conversations')?.textContent,
    ).toContain('src/deep/last.ts');
  });
});

describe('when the token stops working mid-review', () => {
  /**
   * Above the diff, not instead of it. The pull request on screen was loaded
   * with a token that worked; only writing has stopped, and replacing the page
   * would throw away a diff the reviewer is midway through.
   */
  it('says nothing while the token is fine', () => {
    requestMock.mockResolvedValue({ ok: true, data: { data: {} } });

    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.queryByText(/rejected your token/i)).toBeNull();
  });

  it('explains itself once GitHub rejects the token', async () => {
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'auth', message: 'GitHub rejected the token', resetAt: null },
    });

    render(
      <Shell
        retry={() => {}}
        payload={prPayloadWithFiles([fileFixture({ path: 'src/app.ts' })])}
      />,
    );
    // Through the checkbox rather than a shortcut, so the test does not depend
    // on which file happens to be current.
    await userEvent.click(screen.getByRole('checkbox', { name: /src\/app\.ts/i }));

    await waitFor(() => {
      expect(screen.getByText(/rejected your token/i)).toBeTruthy();
    });
    // And the diff is still there to read.
    expect(document.querySelector('[data-file-card]')).not.toBeNull();
  });
});
