/**
 * Asking the worker again.
 *
 * The load effect is keyed on the pull request, so on its own it fires exactly
 * once per route — which is right for the happy path and leaves every failure
 * permanent. The setup screen promised the pull request would load once a
 * token was pasted, and nothing made that true.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from './background';
import { usePrPayload } from './usePrPayload';

vi.mock('./background', () => ({ request: vi.fn() }));

const listeners: ((
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void)[] = [];

vi.stubGlobal('browser', {
  storage: {
    onChanged: {
      addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
      removeListener: (fn: (typeof listeners)[number]) => {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      },
    },
  },
});

const requestMock = request as unknown as Mock;
const PR = { owner: 'acme', repo: 'widgets', number: 42 } as const;

const REFUSED = {
  ok: false,
  error: { kind: 'auth', message: 'GitHub rejected the token', resetAt: null },
} as const;

const payload = { ref: PR, headSha: 'abc' };
const ACCEPTED = { ok: true, data: payload } as const;

/** Pretend the options page wrote a token. */
const saveToken = () => {
  for (const listener of [...listeners]) {
    listener({ 'github-token': { newValue: 'ghp_new' } }, 'local');
  }
};

beforeEach(() => {
  requestMock.mockReset();
  listeners.length = 0;
});

describe('usePrPayload', () => {
  it('asks again when the token changes', async () => {
    // The whole point of the setup screen's promise.
    requestMock.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce(ACCEPTED);
    const { result } = renderHook(() => usePrPayload(PR));
    await waitFor(() => expect(result.current.status).toBe('failed'));

    saveToken();

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('asks again when told to retry', async () => {
    // For the failures a token cannot fix — a rate limit that has since reset,
    // an organisation owner who has since approved the token.
    requestMock.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce(ACCEPTED);
    const { result } = renderHook(() => usePrPayload(PR));
    await waitFor(() => expect(result.current.status).toBe('failed'));

    result.current.retry();

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('stops listening once it is gone', () => {
    // A listener outliving its component would call `setState` on something
    // unmounted every time the reviewer touched their token.
    requestMock.mockResolvedValue(ACCEPTED);
    const { unmount } = renderHook(() => usePrPayload(PR));
    expect(listeners).toHaveLength(1);

    unmount();

    expect(listeners).toHaveLength(0);
  });

  it('ignores a change to something other than the token', () => {
    requestMock.mockResolvedValue(ACCEPTED);
    renderHook(() => usePrPayload(PR));
    const before = requestMock.mock.calls.length;

    for (const listener of [...listeners]) {
      listener({ 'draft:src/app.ts': { newValue: 'x' } }, 'local');
    }

    expect(requestMock.mock.calls).toHaveLength(before);
  });
});
