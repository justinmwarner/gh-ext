/**
 * The four full-page states, and the route that produces each of them.
 *
 * The worker is mocked at the module boundary — `./background` — so no test
 * touches `chrome.*`, and a test failure here always means the page made the
 * wrong decision rather than that the extension APIs were missing.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { request } from './background';
import { openOptions } from './openOptions';
import { prPayload } from './prPayload.fixture';

vi.mock('./background', () => ({ request: vi.fn() }));
vi.mock('./openOptions', () => ({ openOptions: vi.fn() }));

const requestMock = request as unknown as Mock;
const openOptionsMock = openOptions as unknown as Mock;

/** A request that never settles, for asserting on the in-flight state. */
const pending = () => new Promise<never>(() => {});

/**
 * The fake `storage.local` from `testSetup`, which is where the vault state is
 * read from. Reached through the global rather than imported so this file
 * keeps its promise of naming no `chrome.*` API directly.
 */
const vaultStorage = () =>
  (globalThis as unknown as {
    browser: { storage: { local: { set(items: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> } } };
  }).browser.storage.local;

beforeEach(() => {
  // `vi.fn()`s created inside a `vi.mock` factory are not in the registry
  // Vitest's `restoreMocks` sweeps, so their call records survive the test that
  // made them unless they are reset by hand.
  requestMock.mockReset();
  openOptionsMock.mockReset();
  window.location.hash = '#/pr/acme/widgets/42';
});

afterEach(async () => {
  window.location.hash = '';
  // The fake storage areas are module-scoped, so a vault written by one test
  // would otherwise decide the state of every test after it.
  await vaultStorage().remove('github-token-vault');
  await vaultStorage().remove('settings');
});

describe('App', () => {
  it('renders nothing while the payload is in flight', () => {
    requestMock.mockImplementation(pending);

    const { container } = render(<App />);

    // Not a spinner, not a skeleton. On a warm cache the reply lands in a few
    // milliseconds and anything drawn here is a flash.
    expect(container.innerHTML).toBe('');
  });

  it('renders the pull request once the payload arrives', async () => {
    requestMock.mockResolvedValue({ ok: true, data: prPayload() });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Cache the diff on head SHA' }),
    ).toBeDefined();
    expect(requestMock).toHaveBeenCalledWith({
      kind: 'get-pr',
      pr: { owner: 'acme', repo: 'widgets', number: 42 },
    });
  });

  it('renders a setup state that opens the options page when auth fails', async () => {
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'auth', message: 'No GitHub token configured', resetAt: null },
    });

    const { container } = render(<App />);

    const button = await screen.findByRole('button', { name: /open options/i });
    await userEvent.click(button);

    expect(openOptionsMock).toHaveBeenCalled();
    // The state has to say what to do next, not only what went wrong.
    expect(container.textContent).toMatch(/options page/i);
  });

  it('asks for the passphrase, not for a token, when the vault is merely locked', async () => {
    // The worker cannot tell these apart — a locked vault and no token at all
    // both come back as `kind: 'auth'`. Telling a reviewer who already has a
    // token to go and create one is the failure this guards against.
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'auth', message: 'No GitHub token configured', resetAt: null },
    });
    await vaultStorage().set({
      'github-token-vault': {
        v: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600_000,
        salt: 'c2FsdA==',
        iv: 'aXY=',
        ct: 'Y3Q=',
      },
    });

    const { container } = render(<App />);

    expect(await screen.findByLabelText(/passphrase/i)).toBeDefined();
    expect(container.textContent).not.toMatch(/personal access token/i);
  });

  it('renders the error state when the request fails for a non-auth reason', async () => {
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'rate-limit', message: 'API rate limit exceeded', resetAt: null },
    });

    const { container } = render(<App />);

    await screen.findByRole('link', { name: /open in github/i });
    expect(container.textContent).toMatch(/rate limit/i);
  });

  it('explains an unparseable hash instead of rendering a blank page', () => {
    window.location.hash = '#/not-a-review-route';
    requestMock.mockImplementation(pending);

    const { container } = render(<App />);

    expect(container.textContent).toMatch(/pull request/i);
    // Nothing to ask the worker for — there are no coordinates.
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('follows the hash when the worker navigates an already-open tab', async () => {
    requestMock.mockResolvedValue({ ok: true, data: prPayload() });
    window.location.hash = '';

    render(<App />);
    expect(requestMock).not.toHaveBeenCalled();

    window.location.hash = '#/pr/acme/widgets/42';

    expect(
      await screen.findByRole('heading', { name: 'Cache the diff on head SHA' }),
    ).toBeDefined();
  });
});

/** The worker's reply to whichever request the page decides to make. */
const replyWith = (data: unknown) => {
  requestMock.mockResolvedValue({ ok: true, data });
};

describe('App, the dashboard route', () => {
  const emptyDashboard = () =>
    replyWith({
      viewerLogin: 'me',
      prs: [],
      truncated: [],
      denied: [],
      fetchedAt: Date.now(),
    });

  /** Opt a repository in, the way the options page would have. */
  const watch = async (...repos: string[]) => {
    await vaultStorage().set({ settings: { watchedRepos: repos } });
  };

  it('asks for no pull requests at all until a repository is opted in', async () => {
    // The whole point of opting in. A fresh install reaches the picker without
    // reading a single pull request out of anybody's account.
    replyWith({ repos: [], total: 0 });
    window.location.hash = '#/prs';

    render(<App />);
    await screen.findByRole('heading', { name: /pick the repositories/i });

    expect(requestMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'get-dashboard' }),
    );
  });

  it('offers the repositories it found instead', async () => {
    replyWith({
      repos: [{ nameWithOwner: 'acme/widgets', isPrivate: false, reachable: true }],
      total: 1,
    });
    window.location.hash = '#/prs';

    render(<App />);

    expect(
      await screen.findByRole('checkbox', { name: /acme\/widgets/ }),
    ).toBeTruthy();
  });

  it('draws the list once a repository is opted in', async () => {
    await watch('acme/widgets');
    emptyDashboard();
    window.location.hash = '#/prs';

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeTruthy();
  });

  it('asks the worker for the dashboard, scoped to what was opted in', async () => {
    await watch('acme/widgets');
    emptyDashboard();
    window.location.hash = '#/prs';

    render(<App />);
    await screen.findByRole('heading', { name: 'Pull requests' });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'get-dashboard', repos: ['acme/widgets'] }),
    );
  });

  it('still explains a hash that names nothing', () => {
    window.location.hash = '#/nonsense';

    render(<App />);

    expect(screen.getByText(/no pull request here/i)).toBeTruthy();
  });
});

/**
 * The theme belongs to the page, not to one route on it.
 *
 * It used to be applied by `Shell`, which mounts on exactly one of the six
 * things this file renders. So a reviewer who left a dark options page for
 * their pull request list arrived on a page wearing nothing, which is to say
 * wearing whatever the operating system thought — and on a machine set to
 * light, that is a white window with no warning.
 */
describe('App, wearing the chosen theme', () => {
  const root = () => document.documentElement;

  const choose = async (diffTheme: string) => {
    await vaultStorage().set({ settings: { diffTheme } });
  };

  afterEach(() => {
    root().removeAttribute('data-syntax-theme');
    root().removeAttribute('style');
  });

  it('dresses the dashboard, which is the route that used to arrive undressed', async () => {
    await choose('github-dark');
    replyWith({ repos: [], total: 0 });
    window.location.hash = '#/prs';

    render(<App />);

    await vi.waitFor(() => {
      expect(root().getAttribute('data-syntax-theme')).toBe('github-dark');
    });
    expect(root().style.colorScheme).toBe('dark');
  });

  it('dresses a route that names no pull request at all', async () => {
    await choose('github-dark');
    window.location.hash = '#/nonsense';

    render(<App />);

    await vi.waitFor(() => {
      expect(root().getAttribute('data-syntax-theme')).toBe('github-dark');
    });
  });

  it('leaves the page in Primer for a reviewer who has chosen no theme', async () => {
    replyWith({ repos: [], total: 0 });
    window.location.hash = '#/prs';

    render(<App />);
    await screen.findByRole('heading', { name: /pick the repositories/i });

    expect(root().hasAttribute('data-syntax-theme')).toBe(false);
  });
});
