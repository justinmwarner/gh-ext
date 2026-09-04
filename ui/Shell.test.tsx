/**
 * The loaded layout.
 *
 * Three regions, mirroring GitHub's Files-changed tab. Two of them are empty
 * until later tasks fill them; these tests pin the frame so those tasks have
 * somewhere to land rather than a layout to invent.
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
  it('renders the top bar, the left rail and the main column', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('complementary')).toBeDefined();
    expect(screen.getByRole('main')).toBeDefined();
  });

  it('puts a collapsible Overview at the top of the rail', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    const rail = screen.getByRole('complementary');
    const overview = screen.getByText('Overview');

    expect(rail.contains(overview)).toBe(true);
    expect(overview.closest('details')).not.toBeNull();
  });

  it('says when a list was cut short, and offers the way out', () => {
    // The worst outcome is a reviewer who cannot tell "no more comments" from
    // "we dropped them", so a capped list is announced rather than absorbed.
    render(
      <Shell retry={() => {}} payload={prPayload({ truncated: { files: true, threads: true, commits: false } })} />,
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

    expect(screen.getByText('+12')).toBeDefined();
    expect(screen.getByText('−3')).toBeDefined();
    expect(
      (screen.getByRole('checkbox', { name: /src\/app\.ts/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('puts the file tree in the rail, below the overview', () => {
    render(<Shell retry={() => {}} payload={prPayloadWithFiles([fileFixture({ path: 'src/app.ts' })])} />);

    const tree = screen.getByRole('navigation', { name: /changed files/i });
    expect(screen.getByRole('complementary').contains(tree)).toBe(true);
    expect(tree.querySelector('file-tree-container')).not.toBeNull();
  });

  it('says so in both regions when a pull request changed nothing', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    expect(screen.getAllByText(/no changed files/i).length).toBe(2);
  });

  it('gives the rail a resize handle the keyboard can reach', () => {
    render(<Shell retry={() => {}} payload={prPayload()} />);

    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('tabindex')).toBe('0');
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

describe('the unresolved thread jump list', () => {
  it('lists a thread whose file has no card in the column', () => {
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
          truncated: { files: true, threads: false, commits: false },
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

    const list = screen.getByRole('list', { name: /unresolved/i });
    expect(screen.getByRole('complementary').contains(list)).toBe(true);
    expect(list.textContent).toContain('lib/dropped.ts');
  });

  it('lists threads on files the reviewer has not scrolled to', () => {
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

    const list = screen.getByRole('list', { name: /unresolved/i });
    expect(list.textContent).toContain('src/deep/last.ts');
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
