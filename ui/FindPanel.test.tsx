/**
 * The find panel: the rail's other tree.
 *
 * Tested through this component rather than through `SearchTree` directly,
 * because the thing worth pinning is the behaviour a reviewer gets — type,
 * walk, arrive — and the tree is how it is drawn rather than what it does. The
 * pure halves have tests of their own: `lib/review/search`, `ui/searchRows`,
 * `ui/treeKeys`.
 */

import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FIND, FindPanel, type FindState, type FindTarget } from './FindPanel';
import type { ReviewFile } from './reviewFiles';

const file = (path: string, patch: string, overrides: Partial<ReviewFile> = {}): ReviewFile => ({
  path,
  oldPath: path,
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch,
  additions: 1,
  deletions: 1,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
  ...overrides,
});

const patch = (path: string, body: readonly string[]): string =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...body].join('\n');

const FILES: ReviewFile[] = [
  file(
    'src/cache.ts',
    patch('src/cache.ts', [
      '@@ -10,3 +10,4 @@',
      '   const existing = this.store.get(key);',
      '-  return existing;',
      '+  if (existing === undefined) return null;',
    ]),
  ),
  file(
    'docs/guide.md',
    patch('docs/guide.md', ['@@ -1,2 +1,2 @@', '-old heading', '+new heading']),
  ),
];

/** Mount with state held above, the way `FilesView` holds it. */
function Harness({
  files = FILES,
  initial = DEFAULT_FIND,
  onGoTo = vi.fn(),
  onClose = vi.fn(),
}: {
  files?: readonly ReviewFile[];
  initial?: FindState;
  onGoTo?: (target: FindTarget) => void;
  onClose?: () => void;
}) {
  const [state, setState] = useState(initial);
  return (
    <FindPanel
      files={files}
      state={state}
      onState={setState}
      onGoTo={onGoTo}
      onClose={onClose}
    />
  );
}

const box = (): HTMLInputElement => screen.getByRole('searchbox', { name: /search the diff/i });

describe('FindPanel', () => {
  it('says what to do before anything has been typed', () => {
    render(<Harness />);

    expect(box().value).toBe('');
    expect(screen.queryByRole('treeitem')).toBeNull();
  });

  it('finds a changed line and nests it under its file', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'undefined');

    expect(screen.getByRole('treeitem', { name: /cache\.ts/ })).toBeDefined();
    expect(screen.getByTitle(/if \(existing === undefined\) return null;/)).toBeDefined();
  });

  it('finds a line nobody changed, because the panel searches context too', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'this.store.get');

    expect(screen.getByTitle(/const existing = this\.store\.get\(key\);/)).toBeDefined();
  });

  it('counts what it found, in files', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'heading');

    expect(screen.getByRole('status').textContent).toMatch(/2 results in 1 file/i);
  });

  it('says so when nothing matched', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'zzzznothing');

    expect(screen.getByRole('status').textContent).toMatch(/no results/i);
  });

  it('names the problem with a pattern that will not compile', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...DEFAULT_FIND, regex: true }} />);

    await user.type(box(), '(unclosed');

    expect(screen.getByRole('status').textContent).toMatch(/invalid pattern/i);
  });

  it('respects case once the toggle is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'HEADING');
    expect(screen.getByRole('status').textContent).toMatch(/2 results/i);

    await user.click(screen.getByRole('button', { name: /match case/i }));
    expect(screen.getByRole('status').textContent).toMatch(/no results/i);
  });

  it('refuses a hit inside a longer word once whole-word is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'exist');
    expect(screen.getByRole('status').textContent).toMatch(/results/i);

    await user.click(screen.getByRole('button', { name: /whole word/i }));
    expect(screen.getByRole('status').textContent).toMatch(/no results/i);
  });

  it('reads the query as a pattern once regex is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'exist(ing)?');
    expect(screen.getByRole('status').textContent).toMatch(/no results/i);

    await user.click(screen.getByRole('button', { name: /regular expression/i }));
    expect(screen.getByRole('status').textContent).toMatch(/[1-9]\d* results?/i);
  });

  it('says which toggles are on, so a surprising result can be explained', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const matchCase = screen.getByRole('button', { name: /match case/i });
    expect(matchCase.getAttribute('aria-pressed')).toBe('false');

    await user.click(matchCase);
    expect(matchCase.getAttribute('aria-pressed')).toBe('true');
  });

  it('scrolls the diff when the reviewer arrows onto a result, without taking focus', async () => {
    const user = userEvent.setup();
    const onGoTo = vi.fn();
    render(<Harness onGoTo={onGoTo} />);

    await user.type(box(), 'heading');
    // Down out of the box lands on the first row; down again onto a match.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');

    expect(onGoTo).toHaveBeenCalled();
    // The reviewer is still walking the list, so the keyboard has to still be
    // in it. This is the whole reason the panel is not a modal over the diff.
    expect(document.activeElement?.closest('[role="tree"]')).not.toBeNull();
  });

  it('clears the query on Escape, and closes on a second one', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.type(box(), 'heading');
    await user.keyboard('{Escape}');

    expect(box().value).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('folds a file away from its chevron, and keeps the count', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'heading');
    const fileRow = screen.getByRole('treeitem', { name: /guide\.md/ });
    const chevron = fileRow.querySelector('.tree-chevron');
    if (chevron === null) throw new Error('no chevron on the file row');
    await user.click(chevron);

    expect(fileRow.getAttribute('aria-expanded')).toBe('false');
    expect(within(fileRow).getByText('2')).toBeDefined();
  });

  it('goes to the file when the row itself is clicked, rather than folding it', async () => {
    // The convention the checklist already set: clicking a file selects it.
    // Only a directory folds on a plain click.
    const user = userEvent.setup();
    const onGoTo = vi.fn();
    render(<Harness onGoTo={onGoTo} />);

    await user.type(box(), 'heading');
    const fileRow = screen.getByRole('treeitem', { name: /guide\.md/ });
    await user.click(fileRow);

    expect(onGoTo).toHaveBeenCalled();
    expect(fileRow.getAttribute('aria-expanded')).toBe('true');
  });

  it('marks the matched run inside the line', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'heading');

    expect(screen.getAllByText('heading', { selector: 'mark' }).length).toBeGreaterThan(0);
  });
});

describe('FindPanel, handing the diff back the keyboard', () => {
  it('asks for focus to move to the diff on Enter, and not on a move', async () => {
    const user = userEvent.setup();
    const onGoTo = vi.fn();
    render(<Harness onGoTo={onGoTo} />);

    await user.type(box(), 'heading');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');

    // Walking the list leaves the keyboard in the list.
    expect(onGoTo.mock.calls.every(([target]) => target.focusDiff === false)).toBe(true);

    await user.keyboard('{Enter}');

    // Choosing one is the reviewer saying they are done walking.
    expect(onGoTo.mock.lastCall?.[0].focusDiff).toBe(true);
  });
});
