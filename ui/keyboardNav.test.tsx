/**
 * The review keyboard, wired to the surfaces it drives.
 *
 * `lib/keymap.test.ts` proves the map resolves every binding. This proves the
 * page acts on what it resolves — and, most importantly, that it stays out of
 * the way while someone is writing a comment.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { Shell } from './Shell';
import { request } from './background';
import { clickGutterUtility, diffHasRendered } from './pierreDom.fixture';
import {
  fileFixture,
  prPayloadWithFiles,
  pullRequestNode,
  reviewThread,
} from './prPayload.fixture';

vi.mock('./background', () => ({ request: vi.fn() }));

// `Shell` builds its own session and so uses the real draft store, which
// reaches for `browser.storage`. The composer opens in one of these tests.
vi.mock('./draftStore', async () => {
  const { DraftStore } = await import('@/lib/review/drafts');
  const { memoryStore } = await import('./memoryStore.fixture');
  return { draftStore: new DraftStore(memoryStore()) };
});

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((msg: { document: string }) =>
    Promise.resolve({
      ok: true,
      data: {
        data: msg.document.includes('mutation StartReview')
          ? { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } }
          : {},
      },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const gapped = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,3 @@',
    ' one',
    '-before',
    '+after',
    ' three',
    '@@ -20,3 +20,3 @@',
    ' twenty',
    '-old',
    '+new',
    ' twentytwo',
  ].join('\n');

function payload(threads: PrPayload['threads'] = []): PrPayload {
  const base = prPayloadWithFiles([
    fileFixture({ path: 'src/app.ts', patch: gapped('src/app.ts') }),
    fileFixture({ path: 'src/cache.ts', patch: gapped('src/cache.ts') }),
  ]);
  return { ...base, threads };
}

/** The file the review is on, as the shell records it. */
const currentFile = (): string =>
  document.querySelector('.shell')?.getAttribute('data-current-file') ?? '';

const untilDrawn = (path: string) =>
  waitFor(() => {
    expect(diffHasRendered(path)).toBe(true);
  });

describe('moving through the review with the keyboard', () => {
  it('moves to the next and previous file with j and k', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('j');
    expect(currentFile()).toBe('src/app.ts');

    await user.keyboard('j');
    expect(currentFile()).toBe('src/cache.ts');

    await user.keyboard('k');
    expect(currentFile()).toBe('src/app.ts');
  });

  it('stops at the ends rather than wrapping', async () => {
    // Wrapping from the last file to the first reads as "nothing happened" and
    // loses the reviewer's place.
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('kk');
    expect(currentFile()).toBe('src/app.ts');

    await user.keyboard('jjjj');
    expect(currentFile()).toBe('src/cache.ts');
  });

  it('marks the current file viewed with v', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('j');
    await user.keyboard('v');

    const box = screen.getByRole('checkbox', {
      name: /src\/app\.ts/,
    }) as HTMLInputElement;
    await waitFor(() => {
      expect(box.checked).toBe(true);
    });
    expect(requestMock.mock.calls[0]?.[0]?.document).toMatch(/markFileAsViewed/);
  });

  it('opens the pull request on GitHub for the sequence g h', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Shell payload={payload()} />);

    await user.keyboard('gh');

    expect(open).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('does not swallow the key after a lone g', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Shell payload={payload()} />);

    await user.keyboard('gj');

    expect(open).not.toHaveBeenCalled();
    expect(currentFile()).toBe('src/app.ts');
  });
});

describe('the shortcut help overlay', () => {
  it('opens on ? and lists the bindings from the map itself', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('?');

    const help = screen.getByRole('dialog', { name: /keyboard shortcuts/i });
    expect(within(help).getByText('j')).toBeDefined();
    expect(within(help).getByText('g h')).toBeDefined();
    expect(within(help).getByText('Ctrl+K')).toBeDefined();
    expect(within(help).getByText('Ctrl+Shift+Enter')).toBeDefined();
    expect(help.textContent).toMatch(/next file/i);
  });

  it('closes again from its own button', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('?');
    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('searching the diff', () => {
  it('opens on / and lists changed lines that match', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('/');
    const box = screen.getByRole('searchbox', { name: /search the diff/i });
    await user.type(box, 'after');

    const results = screen.getByRole('list', { name: /results/i });
    expect(within(results).getAllByText(/src\/app\.ts/).length).toBeGreaterThan(0);
    expect(results.textContent).toContain('after');
  });

  it('does not match a context line nobody changed', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('/');
    await user.type(screen.getByRole('searchbox', { name: /search the diff/i }), 'twentytwo');

    expect(screen.getByRole('status').textContent).toMatch(/no matches/i);
  });

  it('goes to the file a result is on when it is chosen', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('/');
    await user.type(screen.getByRole('searchbox', { name: /search the diff/i }), 'new');

    const results = screen.getByRole('list', { name: /results/i });
    await user.click(within(results).getAllByRole('button')[0] as HTMLElement);

    expect(currentFile()).toBe('src/app.ts');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('takes Ctrl+F too, so the browser find bar does not open instead', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('{Control>}f{/Control}');

    expect(screen.getByRole('searchbox', { name: /search the diff/i })).toBeDefined();
  });
});

describe('the file jump', () => {
  it('opens on Ctrl+K and filters the file list', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('{Control>}k{/Control}');
    const box = screen.getByRole('searchbox', { name: /jump to a file/i });
    await user.type(box, 'cache');

    const results = screen.getByRole('list', { name: /results/i });
    expect(results.textContent).toContain('src/cache.ts');
    expect(results.textContent).not.toContain('src/app.ts');
  });

  it('moves the review to the file that is chosen', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('searchbox', { name: /jump to a file/i }), 'cache');
    await user.click(
      within(screen.getByRole('list', { name: /results/i })).getAllByRole(
        'button',
      )[0] as HTMLElement,
    );

    expect(currentFile()).toBe('src/cache.ts');
  });
});

describe('never while the reviewer is typing', () => {
  it('inserts the letters into a reply box instead of navigating', async () => {
    // The single most common way a keymap like this ruins a text field. `j`,
    // `k`, `v`, `c`, `n` and `/` are all ordinary characters, and a reply that
    // silently drops them — or moves the page while someone writes — is worse
    // than having no shortcuts at all.
    const user = userEvent.setup();
    render(<Shell payload={payload([reviewThread({ path: 'src/app.ts', line: 2 })])} />);

    const box = await screen.findByRole('textbox', { name: /reply to the thread/i });
    await user.click(box);
    await user.keyboard('jknvcre/?p');

    expect((box as HTMLTextAreaElement).value).toBe('jknvcre/?p');
    expect(currentFile()).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('does not arm the g sequence from inside a text field', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Shell payload={payload([reviewThread({ path: 'src/app.ts', line: 2 })])} />);

    const box = await screen.findByRole('textbox', { name: /reply to the thread/i });
    await user.click(box);
    await user.keyboard('gh');

    expect((box as HTMLTextAreaElement).value).toBe('gh');
    expect(open).not.toHaveBeenCalled();
  });

  it('still posts the comment on Ctrl+Enter, which is the whole point', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);
    await untilDrawn('src/app.ts');

    await act(async () => {
      clickGutterUtility('src/app.ts', 2, 'additions');
    });

    const box = await screen.findByRole('textbox', { name: /comment on src\/app\.ts/i });
    await user.click(box);
    await user.keyboard('needs a guard');
    expect((box as HTMLTextAreaElement).value).toBe('needs a guard');

    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    // Posting one comment is three round trips — open a review, add the
    // thread, submit it — because `addPullRequestReviewThread` has no
    // standalone mode. The chord still has to reach the middle one.
    const sent = requestMock.mock.calls.map((call) => call[0]?.document as string);
    expect(sent.some((doc) => doc.includes('addPullRequestReviewThread('))).toBe(true);
  });
});

describe('moving between hunks', () => {
  it('scrolls without falling over, from either end', async () => {
    // jsdom measures everything as zero-sized, so *where* it lands is not
    // meaningful here; `hunkStops` is tested against real hunk headers on its
    // own. What this pins is that the channel exists and is connected.
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);
    await untilDrawn('src/app.ts');

    await user.keyboard('J');
    await user.keyboard('J');
    await user.keyboard('K');
    await user.keyboard('K');
    await user.keyboard('K');

    expect(screen.getByRole('main')).toBeDefined();
  });
});

describe('Mod+Enter goes to the box the cursor is in', () => {
  it('posts the reply being written, not a composer open elsewhere', async () => {
    // Both claim the same chord. Without the focus condition on the reply box,
    // typing a reply and pressing Ctrl+Enter would post the *composer's*
    // comment on a different line of a different file.
    const user = userEvent.setup();
    render(<Shell payload={payload([reviewThread({ path: 'src/app.ts', line: 2 })])} />);
    await untilDrawn('src/app.ts');

    // A different line of the same file: jsdom virtualizes, so only the first
    // card is drawn, and the two hunks are the two places to be at once.
    await act(async () => {
      clickGutterUtility('src/app.ts', 21, 'additions');
    });
    const composer = await screen.findByRole('textbox', {
      name: /comment on src\/app\.ts/i,
    });
    await user.click(composer);
    await user.keyboard('a thought about the cache');

    const reply = screen.getByRole('textbox', { name: /reply to the thread/i });
    await user.click(reply);
    await user.keyboard('and one about the app');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    expect(requestMock.mock.calls[0]?.[0]?.document).toMatch(
      /addPullRequestReviewThreadReply/,
    );
    expect(requestMock.mock.calls[0]?.[0]?.variables?.body).toBe('and one about the app');
    // And the composer still holds what was typed into it.
    expect((composer as HTMLTextAreaElement).value).toBe('a thought about the cache');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe('acting on the focused thread', () => {
  it('resolves the thread n moved to when e is pressed', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload([reviewThread({ path: 'src/app.ts', line: 2 })])} />);

    await user.keyboard('n');
    await user.keyboard('e');

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    expect(requestMock.mock.calls[0]?.[0]?.document).toMatch(/resolveReviewThread/);
  });

  it('puts the cursor in the reply box when r is pressed', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload([reviewThread({ path: 'src/app.ts', line: 2 })])} />);

    await user.keyboard('n');
    await user.keyboard('r');

    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(
        /reply to the thread/i,
      );
    });
  });

  it('skips the resolved ones for N', async () => {
    // `n` walks every thread and `N` walks only what is still open. A reviewer
    // clearing a backlog wants the second, and getting the first would march
    // them through settled business.
    const user = userEvent.setup();
    render(
      <Shell
        payload={payload([
          reviewThread({ path: 'src/app.ts', line: 2, isResolved: true }),
          reviewThread({ path: 'src/app.ts', line: 3 }),
        ])}
      />,
    );

    await user.keyboard('N');
    await user.keyboard('e');

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    // The open thread on line 3, not the resolved one on line 2.
    expect(requestMock.mock.calls[0]?.[0]?.variables).toEqual({
      threadId: 'PRRT_src/app.ts:3',
    });
  });

  it('does nothing at all when there are no threads', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('nre');

    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('submitting the review from the keyboard', () => {
  it('submits a pending review on Ctrl+Shift+Enter, as a plain comment', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: true,
      data: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } },
    });
    render(<Shell payload={payload()} />);

    await user.click(screen.getByRole('button', { name: /start a review/i }));
    await waitFor(() => {
      expect(screen.getByRole('contentinfo')).toBeDefined();
    });
    requestMock.mockClear();

    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    expect(requestMock.mock.calls[0]?.[0]?.document).toMatch(/submitPullRequestReview/);
    expect(requestMock.mock.calls[0]?.[0]?.variables?.event).toBe('COMMENT');
  });

  it('leaves the chord alone when no review is pending', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);

    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');

    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('commenting from the keyboard', () => {
  it('explains that nothing is selected rather than opening an empty composer', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payload()} />);
    await untilDrawn('src/app.ts');

    await user.keyboard('c');

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toMatch(/select/i);
  });
});

describe('the pull request node the shortcuts read', () => {
  it('opens the route when the payload carries no permalink', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const base = payload();
    render(
      <Shell
        payload={{
          ...base,
          pullRequest: pullRequestNode({ ...base.pullRequest, permalink: undefined }),
        }}
      />,
    );

    await user.keyboard('gh');

    expect(open).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
