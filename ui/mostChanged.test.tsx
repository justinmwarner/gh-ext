/**
 * Reading the review most changed first, through the whole review page.
 *
 * `lib/review/readingOrder.test.ts` decides the order. What only the assembled
 * page can show is that there is one order: the tree, the column, `j`/`k` and
 * `n`/`p` all follow it at once, and turning it off puts every one of them
 * back, including the folders the reviewer had shut.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import { request } from './background';
import { fileFixture, prPayloadWithFiles, reviewThread } from './prPayload.fixture';

vi.mock('./background', () => ({ request: vi.fn() }));

// `Shell` builds its own session and so uses the real draft store, which
// reaches for `browser.storage`.
vi.mock('./draftStore', async () => {
  const { DraftStore } = await import('@/lib/review/drafts');
  const { memoryStore } = await import('./memoryStore.fixture');
  return { draftStore: new DraftStore(memoryStore()) };
});

const requestMock = request as unknown as Mock;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ ok: true, data: { data: {} } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Four files whose folder order and size order disagree everywhere.
 *
 * Folder order: `docs/readme.md`, `lib/big.ts`, `src/app.ts`, `src/mid.ts`.
 * Most changed first: `lib/big.ts` (35), `src/mid.ts` (6), then the two
 * `+1 −1` files in folder order, `docs/readme.md` before `src/app.ts`.
 */
const files = [
  fileFixture({ path: 'src/app.ts' }),
  fileFixture({ path: 'lib/big.ts', additions: 30, deletions: 5 }),
  fileFixture({ path: 'src/mid.ts', additions: 6, deletions: 0 }),
  fileFixture({ path: 'docs/readme.md' }),
];
const BY_FOLDER = ['docs/readme.md', 'lib/big.ts', 'src/app.ts', 'src/mid.ts'];
const BY_SIZE = ['lib/big.ts', 'src/mid.ts', 'docs/readme.md', 'src/app.ts'];

const currentFile = (): string =>
  document.querySelector('.shell')?.getAttribute('data-current-file') ?? '';

const fileTree = () => screen.getByRole('tree', { name: 'Changed files' });
const rowPaths = (): string[] =>
  within(fileTree())
    .getAllByRole('treeitem')
    .map((row) => row.getAttribute('data-path') ?? '');
const filePaths = (): string[] => rowPaths().filter((path) => !path.endsWith('/'));

const SORT_ROW = 'Most changed first';
const BACK_TO_TREE = 'Sorted by most changed. Show as tree';

async function sortByChanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'File filters' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: SORT_ROW }));
  await user.keyboard('{Escape}');
}

describe('reading the review most changed first', () => {
  it('is offered in the filter menu, under its own heading', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);

    await user.click(screen.getByRole('button', { name: 'File filters' }));

    const sort = screen.getByRole('group', { name: 'Sort' });
    const row = within(sort).getByRole('menuitemcheckbox', { name: SORT_ROW });
    expect(row.getAttribute('aria-checked')).toBe('false');
  });

  it('lays the tree out flat, one row a file, biggest change first', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);
    expect(filePaths()).toEqual(BY_FOLDER);

    await sortByChanges(user);

    // No folder rows at all: every row is a file, in size order.
    expect(rowPaths()).toEqual(BY_SIZE);
  });

  it('walks j through the files in the same order', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);
    await sortByChanges(user);

    const walked: string[] = [];
    for (let press = 0; press < BY_SIZE.length; press += 1) {
      await user.keyboard('j');
      walked.push(currentFile());
    }

    expect(walked).toEqual(BY_SIZE);
  });

  it('draws the column in the same order', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);
    const firstCard = () =>
      document.querySelector('[data-file-card]')?.getAttribute('data-file-card');
    await waitFor(() => expect(firstCard()).toBe('docs/readme.md'));

    await sortByChanges(user);

    await waitFor(() => expect(firstCard()).toBe('lib/big.ts'));
  });

  it('walks n through the conversations in the same order', async () => {
    const user = userEvent.setup();
    const payload = {
      ...prPayloadWithFiles(files),
      threads: [
        reviewThread({ path: 'docs/readme.md', line: 1 }),
        reviewThread({ path: 'src/mid.ts', line: 1 }),
      ],
    };
    render(<Shell retry={() => {}} payload={payload} />);
    await sortByChanges(user);

    await user.keyboard('n');

    // In folder order `docs/` comes first; `src/mid.ts` changed more.
    expect(currentFile()).toBe('src/mid.ts');
  });

  it('says so under the box, and pressing the line puts the tree back', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);
    expect(screen.queryByRole('button', { name: BACK_TO_TREE })).toBeNull();
    await sortByChanges(user);

    await user.click(screen.getByRole('button', { name: BACK_TO_TREE }));

    expect(screen.queryByRole('button', { name: BACK_TO_TREE })).toBeNull();
    expect(rowPaths()).toContain('src/');
    expect(filePaths()).toEqual(BY_FOLDER);
    await user.click(screen.getByRole('button', { name: 'File filters' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: SORT_ROW }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('gives back the folders the reviewer had shut', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);
    const folder = () =>
      within(fileTree())
        .getAllByRole('treeitem')
        .find((row) => row.getAttribute('data-path') === 'lib/');
    await user.click(folder() as HTMLElement);
    expect(folder()?.getAttribute('aria-expanded')).toBe('false');

    await sortByChanges(user);
    await user.click(screen.getByRole('button', { name: BACK_TO_TREE }));

    expect(folder()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('is not a filter: every file stays, and the funnel does not light', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={prPayloadWithFiles(files)} />);

    await sortByChanges(user);

    expect(filePaths()).toHaveLength(files.length);
    const funnel = screen.getByRole('button', { name: 'File filters' });
    expect(funnel.getAttribute('data-active')).toBeNull();
    expect(funnel.querySelector('.filter-dot')).toBeNull();
  });
});
