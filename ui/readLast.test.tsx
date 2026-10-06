/**
 * Reading types last, through the whole review page.
 *
 * `lib/review/readingOrder.test.ts` decides where each file goes. What only the
 * assembled page can show is that it is one order: the tree, the column and
 * `j` all put the type at the end together, the File type list can now hide a
 * longer type such as `.spec.ts` on its own, and the line under the box puts
 * everything back.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import { request } from './background';
import { fileFixture, prPayloadWithFiles } from './prPayload.fixture';

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
 * Two specs beside the code they test, and a doc.
 *
 * Folder order: `docs/guide.md`, `src/app.spec.ts`, `src/app.ts`,
 * `src/util.spec.ts`, `src/util.ts`. Two of the four `.ts` files are specs, so
 * `.spec.ts` gets a row of its own under `.ts`.
 */
const payload = () =>
  prPayloadWithFiles([
    fileFixture({ path: 'src/app.ts' }),
    fileFixture({ path: 'src/app.spec.ts' }),
    fileFixture({ path: 'src/util.ts' }),
    fileFixture({ path: 'src/util.spec.ts' }),
    fileFixture({ path: 'docs/guide.md' }),
  ]);

const currentFile = (): string =>
  document.querySelector('.shell')?.getAttribute('data-current-file') ?? '';

const rowPaths = (): string[] =>
  within(screen.getByRole('tree', { name: 'Changed files' }))
    .getAllByRole('treeitem')
    .map((row) => row.getAttribute('data-path') ?? '');

async function readLast(user: ReturnType<typeof userEvent.setup>, ...types: string[]) {
  await user.click(screen.getByRole('button', { name: 'File filters' }));
  for (const type of types) {
    await user.click(screen.getByRole('menuitemcheckbox', { name: `Read ${type} last` }));
  }
  await user.keyboard('{Escape}');
}

describe('reading types last', () => {
  it('moves a type to the bottom of the tree, as a group of its own', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await readLast(user, '.spec.ts');

    expect(rowPaths()).toEqual([
      'docs/',
      'docs/guide.md',
      'src/',
      'src/app.ts',
      'src/util.ts',
      '/last/.spec.ts/',
      'src/app.spec.ts',
      'src/util.spec.ts',
    ]);
  });

  it('walks j through the rest first and the specs after', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await readLast(user, '.spec.ts');

    const walked: string[] = [];
    for (let press = 0; press < 5; press += 1) {
      await user.keyboard('j');
      walked.push(currentFile());
    }

    expect(walked).toEqual([
      'docs/guide.md',
      'src/app.ts',
      'src/util.ts',
      'src/app.spec.ts',
      'src/util.spec.ts',
    ]);
  });

  it('draws the column in the same order', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    const cards = () =>
      [...document.querySelectorAll('[data-file-card]')].map((card) => card.getAttribute('data-file-card'));
    await waitFor(() => expect(cards()[1]).toBe('src/app.spec.ts'));

    await readLast(user, '.spec.ts');

    await waitFor(() => expect(cards()[1]).toBe('src/app.ts'));
  });

  it('reads each type sent to the end after the ones already there', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await readLast(user, '.md', '.spec.ts');

    expect(rowPaths().filter((path) => !path.endsWith('/'))).toEqual([
      'src/app.ts',
      'src/util.ts',
      'docs/guide.md',
      'src/app.spec.ts',
      'src/util.spec.ts',
    ]);
  });

  it('says so under the box, and the line puts every file back in its folder', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await readLast(user, '.spec.ts');

    await user.click(screen.getByRole('button', { name: '.spec.ts read last. Put them back' }));

    expect(rowPaths()).toEqual([
      'docs/',
      'docs/guide.md',
      'src/',
      'src/app.spec.ts',
      'src/app.ts',
      'src/util.spec.ts',
      'src/util.ts',
    ]);
  });

  it('can hide the specs on their own, from the File type list', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await user.click(screen.getByRole('button', { name: 'File filters' }));
    await user.click(
      within(screen.getByRole('group', { name: 'File type' })).getByRole('menuitemcheckbox', {
        name: /^\.spec\.ts/,
      }),
    );
    await user.keyboard('{Escape}');

    expect(rowPaths()).not.toContain('src/app.spec.ts');
    expect(rowPaths()).toContain('src/app.ts');
  });
});

/**
 * The order handed in by `App`, which remembers it from one review to the
 * next, so it can name types this pull request does not have.
 */
describe('reading types last, as remembered', () => {
  it('opens with the remembered types already at the end', () => {
    render(
      <Shell
        retry={() => {}}
        payload={payload()}
        arrangement={{ sort: 'folders', last: ['.snap', '.spec.ts'] }}
        onArrange={() => {}}
      />,
    );

    expect(rowPaths().filter((path) => !path.endsWith('/')).slice(-2)).toEqual([
      'src/app.spec.ts',
      'src/util.spec.ts',
    ]);
  });

  it('puts back only what the line names, and keeps a type this review does not have', async () => {
    // `.snap` was sent to the end in some other review. Nothing here is one,
    // so the line does not mention it, and pressing the line cannot be what
    // forgets it.
    const user = userEvent.setup();
    const onArrange = vi.fn();
    render(
      <Shell
        retry={() => {}}
        payload={payload()}
        arrangement={{ sort: 'folders', last: ['.snap', '.spec.ts'] }}
        onArrange={onArrange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '.spec.ts read last. Put them back' }));

    expect(onArrange).toHaveBeenCalledWith({ sort: 'folders', last: ['.snap'] });
  });
});
