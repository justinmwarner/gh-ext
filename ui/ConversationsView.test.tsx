/**
 * The Conversations view.
 *
 * This list is the **only** global index of review threads in the application.
 * The per-file unanchorable section is drawn by `CodeView`'s custom header, so
 * it exists only for files the column has actually rendered — and `files` is
 * capped while `reviewThreads` is followed separately. A thread this view drops
 * is a thread the reviewer is never told about.
 *
 * So the things tested hardest are all about not losing one: a resolved thread
 * is folded away rather than filtered out, a thread on a file the column never
 * received is listed and labelled, and a thread GitHub returned with no
 * comments in it renders rather than throwing the page away.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewThread } from '@/lib/github/types';
import { DraftStore } from '@/lib/review/drafts';
import { ConversationsView } from './ConversationsView';
import { request } from './background';
import { memoryStore } from './memoryStore.fixture';
import { prPayload, reviewComment, reviewThread } from './prPayload.fixture';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

beforeEach(() => {
  (request as unknown as Mock).mockReset();
});

function mount(
  threads: ReviewThread[],
  options: { paths?: readonly string[]; onGoTo?: (id: string, path: string) => void } = {},
) {
  const payload = prPayload({ threads });
  const onGoTo = options.onGoTo ?? vi.fn();
  const view = render(
    <ReviewSessionProvider
      pullRequest={payload.pullRequest}
      prRef={payload.ref}
      threads={payload.threads}
      drafts={new DraftStore(memoryStore())}
    >
      <ConversationsView paths={options.paths ?? ['src/app.ts']} onGoTo={onGoTo} />
    </ReviewSessionProvider>,
  );
  return { ...view, onGoTo };
}

describe('ConversationsView', () => {
  it('gathers each file’s threads under its path', () => {
    mount(
      [
        reviewThread({ path: 'src/app.ts', line: 2 }),
        reviewThread({ path: 'README.md', line: 1 }),
      ],
      { paths: ['README.md', 'src/app.ts'] },
    );

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual(['README.md', 'src/app.ts']);
  });

  it('shows who said what, and when', () => {
    mount([reviewThread({ path: 'src/app.ts', line: 2 })]);

    expect(screen.getByText('dana')).toBeDefined();
    expect(screen.getByText(/This allocates on every call/)).toBeDefined();
    expect(screen.getByText('Line 2')).toBeDefined();
  });

  it('takes the reviewer to the thread when Go to is pressed', async () => {
    const { onGoTo } = mount([reviewThread({ path: 'src/app.ts', line: 2 })]);

    await userEvent.click(screen.getByRole('button', { name: /go to/i }));

    expect(onGoTo).toHaveBeenCalledWith('PRRT_src/app.ts:2', 'src/app.ts');
  });

  it('names the Go to button without folding the position into a sentence', () => {
    // `threadPosition` returns fragments — "was on line 5", "Whole file",
    // "Position unknown" — so a label built as `Go to ${position}` reads as
    // none of them. The path is in the name too, because a column of buttons
    // all called "Go to" tells a screen reader nothing about which is which.
    mount(
      [
        reviewThread({
          path: 'src/gamma.ts',
          line: null,
          startLine: null,
          originalLine: 5,
          isOutdated: true,
        }),
      ],
      { paths: ['src/gamma.ts'] },
    );

    const button = screen.getByRole('button', { name: /go to/i });
    expect(button.textContent).toBe('Go to');
    expect(button.getAttribute('aria-label')).toBe(
      'Go to src/gamma.ts, was on line 5',
    );
  });

  it('says how many replies the reviewer has not been shown', () => {
    mount([
      reviewThread({
        path: 'src/app.ts',
        line: 2,
        comments: { totalCount: 4, nodes: [reviewComment()] },
      }),
    ]);

    expect(screen.getByText(/3 more replies/i)).toBeDefined();
  });

  it('flags an outdated thread, which is why it has no line', () => {
    mount([
      reviewThread({
        path: 'src/app.ts',
        line: null,
        startLine: null,
        originalLine: 4,
        isOutdated: true,
      }),
    ]);

    expect(screen.getByText('Outdated')).toBeDefined();
  });

  it('shows a suggestion as what it is rather than as a code fence', () => {
    // The body is Markdown drawn as plain text everywhere else in this app, so
    // an unhandled fence renders its backticks into the middle of the excerpt.
    mount([
      reviewThread({
        path: 'src/app.ts',
        line: 2,
        comments: {
          totalCount: 1,
          nodes: [
            reviewComment({
              body: 'Try this instead.\n\n```suggestion\nconst x = 1;\n```',
            }),
          ],
        },
      }),
    ]);

    expect(screen.getByText(/Try this instead/)).toBeDefined();
    expect(screen.getByText(/suggests a change/i)).toBeDefined();
    expect(document.body.textContent).not.toContain('```');
  });

  it('folds resolved threads away instead of dropping them', () => {
    mount([
      reviewThread({ path: 'src/app.ts', line: 2 }),
      reviewThread({ path: 'src/app.ts', line: 9, isResolved: true }),
    ]);

    expect(screen.getByText(/1 resolved/i).closest('details')).not.toBeNull();
  });

  it('still lists a file whose threads have all been resolved', () => {
    // Nothing outstanding is not the same as nothing to read. This is the only
    // place a resolved thread on an unrendered file can be reached from.
    mount([reviewThread({ path: 'src/app.ts', line: 2, isResolved: true })]);

    expect(screen.getByRole('heading', { name: 'src/app.ts', level: 3 })).toBeDefined();
    expect(screen.getByText(/1 resolved/i)).toBeDefined();
  });

  it('reaches a resolved thread once its disclosure is opened', async () => {
    const { onGoTo } = mount([
      reviewThread({ path: 'src/app.ts', line: 9, isResolved: true }),
    ]);

    await userEvent.click(screen.getByText(/1 resolved/i));
    const folded = screen.getByRole('group');
    await userEvent.click(within(folded).getByRole('button', { name: /go to/i }));

    expect(onGoTo).toHaveBeenCalledWith('PRRT_src/app.ts:9', 'src/app.ts');
  });

  it('says when the column has no card to go to', () => {
    mount([reviewThread({ path: 'lib/dropped.ts', line: 3 })], {
      paths: ['src/app.ts'],
    });

    expect(screen.getByText(/not in this diff/i)).toBeDefined();
  });

  it('renders a thread GitHub returned with no comments in it', () => {
    mount([
      reviewThread({ path: 'src/app.ts', line: 2, comments: { totalCount: 0, nodes: [] } }),
    ]);

    expect(screen.getByText('Line 2')).toBeDefined();
    expect(screen.getByRole('button', { name: /go to/i })).toBeDefined();
  });

  it('says so when nobody has commented at all', () => {
    mount([]);

    expect(screen.getByText(/no comments/i)).toBeDefined();
  });
});
