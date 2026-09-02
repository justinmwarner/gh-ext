/**
 * "Changes since my last review".
 *
 * The reviewer has already read some of this pull request. Re-reading all of it
 * to find the three files that moved is the tax this toggle removes: the column
 * is re-rendered from `thatSha...headSha` instead of from the whole diff.
 *
 * Two things it must not get wrong, and both are about losing information:
 *
 * - A first-time reviewer has no earlier commit, so the control is disabled
 *   rather than offered and then explained.
 * - A thread whose line is not in the narrowed diff is **listed**, not dropped.
 *   Losing review feedback is the worst thing this application can do, and a
 *   narrowed diff is exactly the situation that would do it quietly.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrPayload } from '@/lib/messages';
import { Shell } from './Shell';
import { request } from './background';
import { fileShadow } from './pierreDom.fixture';
import {
  fileFixture,
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
const REVIEWED_AT = 'a'.repeat(40);

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

function payloadWith(options: { reviewed: boolean }): PrPayload {
  const base = prPayloadWithFiles([
    fileFixture({ path: 'src/app.ts', patch: widePatch }),
  ]);

  return {
    ...base,
    headSha: HEAD,
    pullRequest: pullRequestNode({
      ...base.pullRequest,
      headRefOid: HEAD,
      ...(options.reviewed
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

const compareButton = () => screen.getByRole('button', { name: /since my last review/i });

/** The reply the worker gives for a `compare-diff` request. */
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

describe('the compare toggle', () => {
  it('is disabled when the viewer has never reviewed this pull request', () => {
    // There is no earlier commit to compare against, so there is nothing
    // honest the control could do.
    render(<Shell payload={payloadWith({ reviewed: false })} />);

    const button = compareButton();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/not reviewed|no earlier/i);
  });

  it('asks for nothing when it is disabled', async () => {
    const user = userEvent.setup();
    render(<Shell payload={payloadWith({ reviewed: false })} />);

    await user.click(compareButton());

    expect(requestMock).not.toHaveBeenCalled();
  });

  it('is offered once the viewer has a review with a commit on it', () => {
    render(<Shell payload={payloadWith({ reviewed: true })} />);

    expect((compareButton() as HTMLButtonElement).disabled).toBe(false);
    expect(compareButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('asks the worker for base...head rather than fetching anything itself', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell payload={payloadWith({ reviewed: true })} />);

    await user.click(compareButton());

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
    render(<Shell payload={payloadWith({ reviewed: true })} />);

    await waitFor(() => {
      expect(document.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();

    await user.click(compareButton());

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
    render(<Shell payload={payloadWith({ reviewed: true })} />);

    const rows = (): string[] =>
      [...fileShadow('src/app.ts').querySelectorAll('[data-column-number]')].map(
        (node) => String(node.getAttribute('data-column-number')),
      );

    await waitFor(() => {
      expect(rows()).toContain('1');
    });

    await user.click(compareButton());

    // Both halves in one wait: the viewer is remounted, so there is a frame
    // where it has drawn nothing and "line 1 is gone" is true for the wrong
    // reason.
    await waitFor(() => {
      expect(rows()).toContain('21');
    });
    expect(rows()).not.toContain('1');
  });

  it('goes back to the whole diff when it is switched off', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue(compareReply);
    render(<Shell payload={payloadWith({ reviewed: true })} />);

    await user.click(compareButton());
    await waitFor(() => {
      expect(compareButton().getAttribute('aria-pressed')).toBe('true');
    });

    await user.click(compareButton());

    await waitFor(() => {
      expect(document.querySelector('[data-unanchored="src/app.ts"]')).toBeNull();
    });
    expect(compareButton().getAttribute('aria-pressed')).toBe('false');
    // And the first hunk is back on screen, not just back in the file list.
    await waitFor(() => {
      expect(
        [...fileShadow('src/app.ts').querySelectorAll('[data-column-number]')].map(
          (node) => String(node.getAttribute('data-column-number')),
        ),
      ).toContain('1');
    });
  });

  it('says so and stays on the whole diff when the comparison fails', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'not-found', message: 'No commit a…a', resetAt: null },
    });
    render(<Shell payload={payloadWith({ reviewed: true })} />);

    await user.click(compareButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No commit/);
    // The reviewer keeps a diff to read rather than an empty column.
    expect(document.querySelector('[data-file-card="src/app.ts"]')).not.toBeNull();
  });
});
