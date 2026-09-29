/**
 * The file filters, through the whole review page.
 *
 * `lib/review/fileFilters.test.ts` decides which files pass; the component
 * tests beside this one decide how the tree, the menu and the column draw it.
 * What only the assembled page can show is the rule that makes filtering safe
 * while a review is under way, because it is about where the reviewer is and
 * what they just did, and only the shell knows either:
 *
 * - a file leaves when the reviewer moves on, not while they act on it — the
 *   file being read, and any file they just ticked or resolved, stay until
 *   their next deliberate move;
 * - a change moves the reviewer only if the change is what hides their file,
 *   and one visit to the menu is one change;
 * - a filter change still applies at once to everything else.
 *
 * `ui/useFileFilter.ts` states the rule in full.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
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

/** Three files in reading order, the middle one deleted. */
const payload = () =>
  prPayloadWithFiles([
    fileFixture({ path: 'src/app.ts' }),
    fileFixture({ path: 'src/old.ts', changeType: 'DELETED', additions: 0, deletions: 1 }),
    fileFixture({ path: 'src/zed.ts' }),
  ]);

/** The file the review is on, as the shell records it. */
const currentFile = (): string =>
  document.querySelector('.shell')?.getAttribute('data-current-file') ?? '';

const treeRow = (path: string): Element | null =>
  document.querySelector(`[role="treeitem"][data-path="${path}"]`);

/**
 * Let the viewer give the card headers their pointer back.
 *
 * `CodeView` switches pointer events off on its sticky headers for 120ms after
 * any scroll it makes, and `j` has just made one. A click inside that window is
 * refused by the browser as much as by the test.
 */
const pastScrollSuspension = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

/** Open the funnel, press each named row, and put the menu away again. */
async function filterBy(user: ReturnType<typeof userEvent.setup>, ...rows: RegExp[]) {
  await user.click(screen.getByRole('button', { name: 'File filters' }));
  for (const name of rows) {
    await user.click(screen.getByRole('menuitemcheckbox', { name }));
  }
  await user.keyboard('{Escape}');
}

describe('filtering the review', () => {
  it('takes a hidden file out of the tree and out of the j and k walk', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await filterBy(user, /^Deleted/);

    expect(treeRow('src/old.ts')).toBeNull();
    await user.keyboard('j');
    expect(currentFile()).toBe('src/app.ts');
    await user.keyboard('j');
    expect(currentFile()).toBe('src/zed.ts');
  });

  it('moves the review on when a filter hides the file it is on', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await user.keyboard('jj');
    expect(currentFile()).toBe('src/old.ts');

    await filterBy(user, /^Deleted/);

    // On to the next file still showing, rather than staying on one the
    // reviewer has just asked not to see.
    expect(currentFile()).toBe('src/zed.ts');
    expect(treeRow('src/old.ts')).toBeNull();
  });

  it('keeps the file being read when it is ticked viewed, and lets it go on the next move', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await filterBy(user, /^Hide viewed files/);

    await user.keyboard('j');
    await user.keyboard('v');
    await waitFor(() => {
      expect(
        (screen.getByRole('checkbox', { name: /src\/app\.ts/ }) as HTMLInputElement).checked,
      ).toBe(true);
    });

    // Still here: it is the file the reviewer is looking at, and an accidental
    // tick has to be on screen to be undone.
    expect(treeRow('src/app.ts')).not.toBeNull();

    await user.keyboard('j');

    expect(currentFile()).toBe('src/old.ts');
    await waitFor(() => expect(treeRow('src/app.ts')).toBeNull());
  });

  it('keeps a file ticked from its card until the reviewer moves on', async () => {
    // Not the file being read: the card below it, ticked on the way past.
    // Taken away on the press, the next card would slide into its place under
    // the pointer, and a second click would tick that one too.
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await filterBy(user, /^Hide viewed files/);
    await user.keyboard('j');
    await pastScrollSuspension();

    await user.click(screen.getByRole('checkbox', { name: /src\/old\.ts/ }));
    await waitFor(() => {
      expect((screen.getByRole('checkbox', { name: /src\/old\.ts/ }) as HTMLInputElement).checked).toBe(true);
    });
    expect(treeRow('src/old.ts')).not.toBeNull();

    // Somewhere else, on purpose — not onto the ticked file, which `j` would
    // be, since it is still showing until the reviewer leaves it.
    await user.click(treeRow('src/zed.ts') as HTMLElement);

    await waitFor(() => expect(treeRow('src/old.ts')).toBeNull());
  });

  it('keeps a row ticked in the tree until the reviewer moves on', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await filterBy(user, /^Hide viewed files/);
    await user.keyboard('j');

    const tick = treeRow('src/zed.ts')?.querySelector('[data-check]');
    if (!(tick instanceof HTMLElement)) throw new Error('no tick on the zed.ts row');
    await user.click(tick);
    await waitFor(() => {
      expect(treeRow('src/zed.ts')?.getAttribute('aria-checked')).toBe('true');
    });

    await user.keyboard('j');

    await waitFor(() => expect(treeRow('src/zed.ts')).toBeNull());
  });

  it('does not move the reviewer off a file already staying, for a press about something else', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await filterBy(user, /^Hide viewed files/);
    await user.keyboard('j');
    await user.keyboard('v');
    await waitFor(() => {
      expect((screen.getByRole('checkbox', { name: /src\/app\.ts/ }) as HTMLInputElement).checked).toBe(true);
    });

    // Deleted files are not what `app.ts` is. The press hides `old.ts`, and
    // the file being read stays where the tick left it.
    await filterBy(user, /^Deleted/);

    expect(currentFile()).toBe('src/app.ts');
    expect(treeRow('src/old.ts')).toBeNull();
  });

  it('leaves the reviewer where they were when a box is unticked and ticked back in one visit', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await user.keyboard('j');
    expect(currentFile()).toBe('src/app.ts');

    // Every file here is TypeScript, so the wrong box hides all three — and
    // the menu is still open to put it right.
    await filterBy(user, /^\.ts/, /^\.ts/);

    expect(currentFile()).toBe('src/app.ts');
    expect(treeRow('src/old.ts')).not.toBeNull();
  });

  it('turning on Hide viewed files hides a file ticked a moment before, as it hides the rest', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await user.keyboard('j');
    await pastScrollSuspension();
    await user.click(screen.getByRole('checkbox', { name: /src\/old\.ts/ }));
    await waitFor(() => {
      expect((screen.getByRole('checkbox', { name: /src\/old\.ts/ }) as HTMLInputElement).checked).toBe(true);
    });

    await filterBy(user, /^Hide viewed files/);

    await waitFor(() => expect(treeRow('src/old.ts')).toBeNull());
    expect(currentFile()).toBe('src/app.ts');
  });

  it('moves the reviewer when CODEOWNERS, arriving late, is what hides their file', async () => {
    requestMock.mockImplementation((msg: { kind: string; path?: string }) => {
      if (msg.kind === 'get-blob' && msg.path === 'CODEOWNERS') {
        return Promise.resolve({ ok: true, data: { status: 'ok', text: '/src/app.ts @reviewer' } });
      }
      if (msg.kind === 'get-blob') return Promise.resolve({ ok: true, data: { status: 'absent' } });
      if (msg.kind === 'get-viewer-teams') {
        return Promise.resolve({ ok: true, data: { login: 'reviewer', teams: [], truncated: false } });
      }
      return Promise.resolve({ ok: true, data: { data: {} } });
    });
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);
    await user.keyboard('jjj');
    expect(currentFile()).toBe('src/zed.ts');

    await filterBy(user, /^Show only files you own/);

    // Nothing after `zed.ts` is left, so back to the file the reviewer owns.
    await waitFor(() => expect(currentFile()).toBe('src/app.ts'));
    expect(treeRow('src/zed.ts')).toBeNull();
  });

  it('says above the diff how many files are showing, and opens the filters from there', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await filterBy(user, /^Deleted/);
    await user.click(screen.getByRole('button', { name: 'Showing 2 of 3 files' }));

    await waitFor(() => expect(screen.getByRole('menu', { name: 'File filters' })).toBeDefined());
  });

  it('shows a hidden file while a thread link has the reviewer on it, and only then', async () => {
    const user = userEvent.setup();
    const withThread = {
      ...payload(),
      threads: [reviewThread({ path: 'src/old.ts', line: 1, diffSide: 'LEFT' })],
    };
    render(<Shell retry={() => {}} payload={withThread} />);
    await filterBy(user, /^Deleted/);
    expect(treeRow('src/old.ts')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /conversations/i }));
    expect(screen.getByText('In a file your filters hide')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /go to src\/old\.ts/i }));

    // Asked for by name, so shown — the filters still say deleted files are
    // hidden, and the review is on one.
    expect(currentFile()).toBe('src/old.ts');
    expect(treeRow('src/old.ts')).not.toBeNull();

    await user.keyboard('j');

    expect(currentFile()).toBe('src/zed.ts');
    await waitFor(() => expect(treeRow('src/old.ts')).toBeNull());
  });

  it('narrows to the files the reviewer owns, once CODEOWNERS has been read', async () => {
    requestMock.mockImplementation((msg: { kind: string; path?: string }) => {
      if (msg.kind === 'get-blob' && msg.path === 'CODEOWNERS') {
        return Promise.resolve({ ok: true, data: { status: 'ok', text: '/src/zed.ts @reviewer' } });
      }
      if (msg.kind === 'get-blob') return Promise.resolve({ ok: true, data: { status: 'absent' } });
      if (msg.kind === 'get-viewer-teams') {
        return Promise.resolve({ ok: true, data: { login: 'reviewer', teams: [] } });
      }
      return Promise.resolve({ ok: true, data: { data: {} } });
    });
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await filterBy(user, /^Show only files you own/);

    await waitFor(() => expect(treeRow('src/app.ts')).toBeNull());
    expect(treeRow('src/zed.ts')).not.toBeNull();
    // Read at the pull request's base, which is the file GitHub applies.
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'get-blob', path: 'CODEOWNERS', ref: 'a'.repeat(40) }),
    );
  });

  it('turns ownership back off where there is no CODEOWNERS, and says so on the row', async () => {
    requestMock.mockImplementation((msg: { kind: string }) => {
      if (msg.kind === 'get-blob') return Promise.resolve({ ok: true, data: { status: 'absent' } });
      if (msg.kind === 'get-viewer-teams') {
        return Promise.resolve({ ok: true, data: { login: 'reviewer', teams: [] } });
      }
      return Promise.resolve({ ok: true, data: { data: {} } });
    });
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await filterBy(user, /^Show only files you own/);
    await user.click(screen.getByRole('button', { name: 'File filters' }));

    const owned = screen.getByRole('menuitemcheckbox', { name: /^Show only files you own/ });
    await waitFor(() => expect(owned.getAttribute('aria-checked')).toBe('false'));
    expect(owned.getAttribute('aria-disabled')).toBe('true');
    expect(owned.textContent).toContain('This repository has no CODEOWNERS file');
    // Nothing was hidden on the strength of a file that is not there.
    expect(treeRow('src/app.ts')).not.toBeNull();
  });

  it('says when the filters hide everything, and puts it all back from there', async () => {
    const user = userEvent.setup();
    render(<Shell retry={() => {}} payload={payload()} />);

    await filterBy(user, /^\.ts/);

    expect(screen.getByText('Your filters hide all 3 files.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Show all files' }));

    await waitFor(() => expect(treeRow('src/old.ts')).not.toBeNull());
    expect(screen.queryByText('Your filters hide all 3 files.')).toBeNull();
  });
});
