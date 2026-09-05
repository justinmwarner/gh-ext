/**
 * Scoping the diff to commits.
 *
 * The reviewer has already read some of this pull request, or wants to read it
 * one commit at a time. Either way the column is re-rendered from a compare
 * between two commits instead of from the whole diff, and "changes since my
 * last review" is one preset over that machinery rather than a feature of its
 * own.
 *
 * Four things it must not get wrong, and every one of them is about losing
 * information or inventing it:
 *
 * - A first-time reviewer has no earlier commit, so the preset is disabled
 *   rather than offered and then explained.
 * - A thread whose line is not in the narrowed diff is **listed**, not dropped.
 *   Losing review feedback is the worst thing this application can do, and a
 *   narrowed diff is exactly the situation that would do it quietly.
 * - A thread whose line number belongs to a different commit is listed too.
 *   That one is worse: the line usually exists, so the comment would be drawn
 *   against text it was never written about.
 * - A commit the reviewer picked can be force-pushed away. Showing the diff
 *   anyway — GitHub keeps the orphan reachable, so it would work — is the
 *   worst outcome of all.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { Shell } from './Shell';
import { request } from './background';
import { clickHunkExpander, fileShadow } from './pierreDom.fixture';
import {
  fileFixture,
  prCommit,
  prPayloadWithFiles,
  pullRequestNode,
  reviewThread,
} from './prPayload.fixture';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
});

const HEAD = 'f'.repeat(40);
const BASE = 'a'.repeat(40);
const REVIEWED_AT = 'b'.repeat(40);
const MIDDLE = 'c'.repeat(40);

/** base — MIDDLE — REVIEWED_AT — HEAD, which is an ordinary pull request. */
const COMMITS = [
  prCommit({ oid: MIDDLE, parentOid: BASE, messageHeadline: 'Add the parser' }),
  prCommit({ oid: REVIEWED_AT, parentOid: MIDDLE, messageHeadline: 'Handle renames' }),
  prCommit({ oid: HEAD, parentOid: REVIEWED_AT, messageHeadline: 'Fix the cache key' }),
];

/** Two hunks, so lines 1–3 and 20–22 are drawn and everything between is not. */
const widePatch = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
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

/** Only the second hunk: the reviewer has already seen the first. */
const sincePatch = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -20,3 +20,3 @@',
  ' twenty',
  '-old',
  '+new',
  ' twentytwo',
].join('\n');

interface PayloadOptions {
  reviewed?: boolean;
  commits?: PrPayload['commits'];
  commitsTruncated?: boolean;
}

function payloadWith(options: PayloadOptions = {}): PrPayload {
  const base = prPayloadWithFiles([
    fileFixture({ path: 'src/app.ts', patch: widePatch }),
  ]);

  return {
    ...base,
    headSha: HEAD,
    commits: options.commits ?? COMMITS,
    truncated: { ...base.truncated, commits: options.commitsTruncated === true },
    pullRequest: pullRequestNode({
      ...base.pullRequest,
      headRefOid: HEAD,
      baseRefOid: BASE,
      ...(options.reviewed === true
        ? {
            viewerLatestReview: {
              id: 'PRR_old',
              state: 'COMMENTED',
              commit: { oid: REVIEWED_AT },
            },
          }
        : {}),
    }),
    threads: [reviewThread({ path: 'src/app.ts', line: 2 })],
  };
}

/**
 * Every scope control but the numbered strip lives behind one kebab now, so
 * reaching one is two steps rather than one. Reopening is idempotent: an item
 * that refuses to run — a disabled one — leaves the menu where it was.
 */
const menuItem = async (user: UserEvent, name: RegExp): Promise<HTMLElement> => {
  const kebab = screen.getByRole('button', { name: /commit options/i });
  if (kebab.getAttribute('aria-expanded') !== 'true') await user.click(kebab);
  const found = [
    ...screen.getByRole('menu').querySelectorAll<HTMLElement>('.menu-item'),
  ].find((item) => name.test(item.textContent ?? ''));
  if (found === undefined) throw new Error(`no menu item matching ${String(name)}`);
  return found;
};

const since = (user: UserEvent) => menuItem(user, /since my last review/i);
const clickSince = async (user: UserEvent): Promise<void> => {
  await user.click(await since(user));
};
const clickPicker = async (user: UserEvent): Promise<void> => {
  await user.click(await menuItem(user, /choose commits/i));
};
const clickShowAll = async (user: UserEvent): Promise<void> => {
  await user.click(await menuItem(user, /show all commits/i));
};
const scopeBar = (): HTMLElement => {
  const bar = document.querySelector<HTMLElement>('[data-scope]');
  if (bar === null) throw new Error('the scope bar is not on the page');
  return bar;
};

/** The reply the worker gives for any `compare-diff` request in these tests. */
const compareReply = {
  ok: true,
  data: {
    base: REVIEWED_AT,
    head: HEAD,
    files: [
      {
        path: 'src/app.ts',
        oldPath: 'src/app.ts',
        isBinary: false,
        isRename: false,
        patch: sincePatch,
      },
    ],
  },
};

const columnLines = (): string[] =>
  [...fileShadow('src/app.ts').querySelectorAll('[data-column-number]')].map((node) =>
    String(node.getAttribute('data-column-number')),
  );

describe('the scope bar', () => {
  it('shows the whole pull request as a state, not as an absence', () => {
    // The whole diff and a diff scoped to one commit must not look the same,
    // and the only way to guarantee that is to say the ordinary case out loud
    // too. It used to be a sentence; it is the pressed "All" tab now, which is
    // the same guarantee in the control the reviewer is already looking at.
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    expect(scopeBar().getAttribute('data-scope')).toBe('whole');
    expect(
      screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('says the commit list is short when GitHub did not send all of it', () => {
    // GitHub stops `commits` at 250 and reports the walk complete, so a
    // reviewer with a longer pull request would be picking from a list that
    // silently is not the history.
    render(<Shell retry={() => {}} payload={payloadWith({ commitsTruncated: true })} />);

    expect(screen.getByRole('status').textContent).toMatch(/not the whole history|short/i);
  });
});

describe('the "since my last review" preset', () => {
  it('is disabled when the viewer has never reviewed this pull request', async () => {
    // There is no earlier commit to compare against, so there is nothing
    // honest the control could do.
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    const item = await since(user);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toMatch(/not reviewed|no earlier/i);
  });

  it('asks for nothing when it is disabled', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    await clickSince(user);

    expect(requestMock).not.toHaveBeenCalled();
  });

  it('asks the worker for base...head rather than fetching anything itself', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith({ reviewed: true })} />);

    await clickSince(user);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith({
        kind: 'compare-diff',
        pr: { owner: 'acme', repo: 'widgets', number: 42 },
        base: REVIEWED_AT,
        head: HEAD,
      });
    });
    // The review page never calls fetch. It has no token and cannot get one.
    expect(globalThis.fetch).toBe(fetch);
  });

  it('re-anchors threads against the narrowed diff instead of losing them', async () => {
    // The thread is on line 2, which the narrowed diff does not draw. It has to
    // turn up in the per-file section rather than vanishing into an annotation
    // Pierre silently declines to place.
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith({ reviewed: true })} />);

    await waitFor(() => {
      expect(document.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();

    await clickSince(user);

    await waitFor(() => {
      expect(document.querySelector('[data-unanchored="src/app.ts"]')).not.toBeNull();
    });

    const listed = document.querySelector<HTMLElement>('[data-unanchored="src/app.ts"]');
    if (listed === null) throw new Error('unreachable');
    expect(listed.querySelector('[data-listed-reason="out-of-hunk"]')).not.toBeNull();
    expect(within(listed).getByText('This allocates on every call.')).toBeDefined();
  });

  it('draws the narrowed patch instead of the one already on screen', async () => {
    // `CodeView` reuses the record it holds for an item id and keeps the code
    // it first rendered for it (pinned in ui/DiffColumn.test.tsx). Without the
    // remount the reviewer would get the new file list over the old diff —
    // silently, and with the numbers still lining up.
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith({ reviewed: true })} />);

    await waitFor(() => {
      expect(columnLines()).toContain('1');
    });

    await clickSince(user);

    // Both halves in one wait: the viewer is remounted, so there is a frame
    // where it has drawn nothing and "line 1 is gone" is true for the wrong
    // reason.
    await waitFor(() => {
      expect(columnLines()).toContain('21');
    });
    expect(columnLines()).not.toContain('1');
  });

  it('goes back to the whole diff when it is switched off', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith({ reviewed: true })} />);

    await clickSince(user);
    await waitFor(async () => {
      expect((await since(user)).getAttribute('aria-checked')).toBe('true');
    });

    await clickSince(user);

    await waitFor(() => {
      expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();
    });
    expect((await since(user)).getAttribute('aria-checked')).toBe('false');
    // And the first hunk is back on screen, not just back in the file list.
    await waitFor(() => {
      expect(columnLines()).toContain('1');
    });
  });

  it('says so and stays on the whole diff when the comparison fails', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'not-found', message: 'No commit a…a', resetAt: null },
    });
    render(<Shell retry={() => {}} payload={payloadWith({ reviewed: true })} />);

    await clickSince(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No commit/);
    // The reviewer keeps a diff to read rather than an empty column.
    expect(document.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
    // And the bar describes *that* diff. Saying "showing changes since your
    // last review" over the whole pull request is the one thing this row
    // exists to make impossible.
    expect(scopeBar().getAttribute('data-scope')).toBe('failed');
    expect(scopeBar().textContent).toMatch(/showing the whole pull request/i);
    expect(document.querySelector('.scope-status')?.textContent).not.toMatch(/since/i);
  });

  it('asks for nothing when the reviewer has already reviewed the head commit', async () => {
    // `head...head` is a valid request answering an empty diff, which reads as
    // "every file in this pull request vanished".
    const user = userEvent.setup();
    const payload = payloadWith({ reviewed: true });
    render(
      <Shell
        retry={() => {}}
        payload={{
          ...payload,
          pullRequest: pullRequestNode({
            ...payload.pullRequest,
            viewerLatestReview: { id: 'PRR_old', state: 'COMMENTED', commit: { oid: HEAD } },
          }),
        }}
      />,
    );

    await clickSince(user);

    expect(
      requestMock.mock.calls.filter(([m]) => m?.kind === 'compare-diff'),
    ).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toMatch(/nothing has landed/i);
  });
});

describe('picking commits', () => {
  const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
    await clickPicker(user);
    return screen.getByRole('dialog', { name: /commits/i });
  };

  it('lists the pull request’s commits, oldest first', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    const dialog = await openPicker(user);
    const rows = within(dialog).getAllByRole('button', { name: /select commit/i });

    expect(rows.map((row) => row.getAttribute('data-commit'))).toEqual([
      MIDDLE,
      REVIEWED_AT,
      HEAD,
    ]);
    expect(dialog.textContent).toContain('Add the parser');
  });

  it('compares one commit against its own parent', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: /select commit ccccccc/i }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith({
        kind: 'compare-diff',
        pr: { owner: 'acme', repo: 'widgets', number: 42 },
        base: BASE,
        head: MIDDLE,
      });
    });
    expect(scopeBar().getAttribute('data-scope')).toBe('narrowed');
    expect(scopeBar().textContent).toMatch(/ccccccc/);
  });

  it('compares a range from the first selection’s parent to the last', async () => {
    // So that selecting one commit and selecting a one-commit range are the
    // same request. Anything else and the two controls disagree about what
    // "selected" means.
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    const dialog = await openPicker(user);
    await user.click(
      within(dialog).getByRole('button', { name: /compare from ccccccc/i }),
    );
    await user.click(within(dialog).getByRole('button', { name: /select commit bbbbbbb/i }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith({
        kind: 'compare-diff',
        pr: { owner: 'acme', repo: 'widgets', number: 42 },
        base: BASE,
        head: REVIEWED_AT,
      });
    });
    expect(scopeBar().textContent).toMatch(/2 commits/i);
  });

  it('lists every thread when the diff is of a commit that is not the head', async () => {
    // A thread's line is a position in the pull request's diff. On a diff
    // ending at an older commit that number counts against a different file,
    // so the comment must not be drawn — it would land on whatever text
    // happens to be there, and nothing would say so.
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: /select commit ccccccc/i }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-listed-reason="other-commit"]'),
      ).not.toBeNull();
    });
  });

  it('goes back to the whole diff on demand', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell retry={() => {}} payload={payloadWith()} />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: /select commit ccccccc/i }));
    await waitFor(() => {
      expect(scopeBar().getAttribute('data-scope')).toBe('narrowed');
    });

    await clickShowAll(user);

    await waitFor(() => {
      expect(scopeBar().getAttribute('data-scope')).toBe('whole');
    });
    // Waited for rather than asserted: the viewer is remounted when the file
    // list is replaced, so there is a frame where it has drawn nothing at all.
    await waitFor(() => {
      expect(columnLines()).toContain('1');
    });
  });
});

describe('expanding unchanged context on a narrowed diff', () => {
  /**
   * The whole file, on both sides, consistent with `sincePatch`.
   *
   * Which commit each side is read at is the point of the test below, so the
   * two texts differ by more than their changed line: a loader still pointed
   * at the pull request's own base and head would splice these in under hunk
   * headers that still line up, and the reviewer would be reading context from
   * a diff they are not looking at.
   */
  const GAP = Array.from({ length: 16 }, (_, index) => `context ${index + 4}`);
  const wholeFile = (marker: string): string =>
    ['one', marker, 'three', ...GAP, 'twenty', marker, 'twentytwo'].join('\n');

  it('reads both sides at the commits the diff on screen is between', async () => {
    // Scoped to the middle commit, so neither end is the pull request's own —
    // the case where reading a blob at the wrong ref cannot be right by
    // accident.
    const user = userEvent.setup();
    const refs: string[] = [];
    requestMock.mockImplementation((msg: { kind: string; ref?: string }) => {
      if (msg.kind === 'compare-diff') return Promise.resolve(compareReply);
      if (msg.kind === 'get-blob') {
        refs.push(String(msg.ref));
        return Promise.resolve({ ok: true, data: { status: 'ok', text: wholeFile('x') } });
      }
      return Promise.resolve({ ok: true, data: { data: {} } });
    });

    render(<Shell retry={() => {}} payload={payloadWith()} />);
    await clickPicker(user);
    const dialog = screen.getByRole('dialog', { name: /commits/i });
    await user.click(within(dialog).getByRole('button', { name: /select commit bbbbbbb/i }));
    await waitFor(() => {
      expect(columnLines()).toContain('21');
    });

    await act(async () => {
      clickHunkExpander('src/app.ts');
    });

    await waitFor(() => {
      expect([...new Set(refs)].sort()).toEqual([MIDDLE, REVIEWED_AT].sort());
    });
  });
});

describe('a commit that was force-pushed away', () => {
  it('says so and shows the whole diff rather than the orphan’s', async () => {
    // GitHub keeps a commit that has left a branch reachable for a while, so
    // the compare would succeed and the reviewer would read a diff against
    // history this pull request no longer has, with nothing to say so.
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    const { rerender } = render(<Shell retry={() => {}} payload={payloadWith()} />);

    const dialog = await openPickerOn(user);
    await user.click(within(dialog).getByRole('button', { name: /select commit ccccccc/i }));
    await waitFor(() => {
      expect(scopeBar().getAttribute('data-scope')).toBe('narrowed');
    });
    requestMock.mockClear();

    // The author force-pushed: MIDDLE is gone from the history.
    rerender(
      <Shell
        retry={() => {}}
        payload={payloadWith({
          commits: [prCommit({ oid: HEAD, parentOid: BASE, messageHeadline: 'Squashed' })],
        })}
      />,
    );

    await waitFor(() => {
      expect(scopeBar().getAttribute('data-scope')).toBe('lost');
    });
    expect(scopeBar().textContent).toMatch(/no longer in this pull request/i);
    // And nothing was asked for on its behalf.
    expect(
      requestMock.mock.calls.filter(([m]) => m?.kind === 'compare-diff'),
    ).toHaveLength(0);
    // The whole diff is what is on screen, so line 1 is back.
    await waitFor(() => {
      expect(columnLines()).toContain('1');
    });
  });
});

async function openPickerOn(user: ReturnType<typeof userEvent.setup>) {
  await clickPicker(user);
  return screen.getByRole('dialog', { name: /commits/i });
}
