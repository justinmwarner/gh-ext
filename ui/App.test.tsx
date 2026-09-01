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

beforeEach(() => {
  // `vi.fn()`s created inside a `vi.mock` factory are not in the registry
  // Vitest's `restoreMocks` sweeps, so their call records survive the test that
  // made them unless they are reset by hand.
  requestMock.mockReset();
  openOptionsMock.mockReset();
  window.location.hash = '#/pr/acme/widgets/42';
});

afterEach(() => {
  window.location.hash = '';
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

    expect(await screen.findByText('Cache the diff on head SHA')).toBeDefined();
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

    expect(await screen.findByText('Cache the diff on head SHA')).toBeDefined();
  });
});
