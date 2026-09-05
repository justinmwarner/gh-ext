/**
 * Noticing that the pull request moved out from under the reviewer.
 *
 * The failure this guards against is silent: line comments are positioned
 * against the patch the page loaded, so once the head commit moves, a queued
 * comment can land on the wrong line or come back marked outdated the moment
 * it is submitted. Nothing on screen changes when that happens, which is why
 * the check has to exist at all.
 *
 * Two properties are load-bearing and both are pinned here: the check happens
 * on a signal that is free, and it cannot happen more often than the floor.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '@/lib/messages';
import { request } from './background';
import { HEAD_CHECK_FLOOR_MS, useHeadMoved } from './useHeadMoved';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

const PR = { owner: 'acme', repo: 'widgets', number: 42 } as const;
const LOADED = 'f'.repeat(40);
const MOVED = 'b'.repeat(40);
const MOVED_AGAIN = 'c'.repeat(40);

/** Only `headSha` is read, but a whole payload is what really comes back. */
const at = (headSha: string) => ({ ok: true, data: { ref: PR, headSha } });

const REFUSED = {
  ok: false,
  error: { kind: 'rate-limit', message: 'Rate limited', resetAt: null },
} as const;

/**
 * A clock the test moves by hand.
 *
 * `Date.now` rather than Vitest's fake timers: those replace `setInterval`,
 * which is what Testing Library's `waitFor` polls on, so a hook that answers
 * asynchronously would never be observed to have answered.
 */
let clockAt = 0;
const advance = (ms: number) => {
  clockAt += ms;
};

/** Coming back to the tab. The one signal this hook listens for. */
const refocus = () => {
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
};

/**
 * Let a check that has already been answered be acted on.
 *
 * Needed wherever a test asserts that the hook stayed *quiet*: without it the
 * assertion runs before the reply has been read, so it would hold just as well
 * against a hook that was about to shout.
 */
const settle = async () => {
  await act(async () => {});
};

beforeEach(() => {
  requestMock.mockReset();
  clockAt = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clockAt);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useHeadMoved', () => {
  it('says nothing while the pull request is where the page left it', async () => {
    requestMock.mockResolvedValue(at(LOADED));
    const { result } = renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await settle();

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(result.current.movedTo).toBeNull();
  });

  it('reports the new head commit once the pull request has moved', async () => {
    requestMock.mockResolvedValue(at(MOVED));
    const { result } = renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();

    await waitFor(() => expect(result.current.movedTo).toBe(MOVED));
  });

  it('asks for a refresh, so the answer cannot be the cached head', async () => {
    // A cached `get-pr` is served under the head pointer the page already has,
    // which would agree with itself forever.
    requestMock.mockResolvedValue(at(MOVED));
    renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        message('get-pr', { pr: PR, refresh: true }),
      ),
    );
  });

  it('does not check on a focus that arrives before the floor has passed', () => {
    // The payload on screen was read at mount, so the first focus after it has
    // nothing to learn — and a page left open all day is focused constantly.
    requestMock.mockResolvedValue(at(LOADED));
    renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS - 1);
    refocus();

    expect(requestMock).not.toHaveBeenCalled();
  });

  it('holds the floor between two checks', async () => {
    requestMock.mockResolvedValue(at(LOADED));
    renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await settle();
    expect(requestMock).toHaveBeenCalledTimes(1);

    advance(HEAD_CHECK_FLOOR_MS - 1);
    refocus();
    refocus();

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('holds the floor after a check that failed', async () => {
    // Otherwise a token GitHub has started refusing turns every alt-tab into
    // another request it will refuse.
    requestMock.mockResolvedValue(REFUSED);
    renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await settle();
    expect(requestMock).toHaveBeenCalledTimes(1);

    advance(HEAD_CHECK_FLOOR_MS - 1);
    refocus();

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('starts no second check while one is still in flight', async () => {
    // The floor is written down before the request goes out, not after it
    // answers, so a burst of focus events cannot slip through the gap.
    requestMock.mockReturnValue(new Promise(() => {}));
    renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    refocus();

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('stops mentioning a head the reviewer chose to keep reading past', async () => {
    requestMock.mockResolvedValue(at(MOVED));
    const { result } = renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await waitFor(() => expect(result.current.movedTo).toBe(MOVED));

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.movedTo).toBeNull();

    // And it stays dismissed: the same commit re-reported is the same news.
    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await settle();
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.movedTo).toBeNull();
  });

  it('speaks up again when the head moves a second time', async () => {
    requestMock.mockResolvedValue(at(MOVED));
    const { result } = renderHook(() => useHeadMoved(PR, LOADED));

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await waitFor(() => expect(result.current.movedTo).toBe(MOVED));
    act(() => {
      result.current.dismiss();
    });

    requestMock.mockResolvedValue(at(MOVED_AGAIN));
    advance(HEAD_CHECK_FLOOR_MS);
    refocus();

    await waitFor(() => expect(result.current.movedTo).toBe(MOVED_AGAIN));
  });

  it('falls quiet once the page has caught up to the commit it named', async () => {
    requestMock.mockResolvedValue(at(MOVED));
    const { result, rerender } = renderHook(
      ({ sha }: { sha: string }) => useHeadMoved(PR, sha),
      { initialProps: { sha: LOADED } },
    );

    advance(HEAD_CHECK_FLOOR_MS);
    refocus();
    await waitFor(() => expect(result.current.movedTo).toBe(MOVED));

    // What a reload looks like from in here: the payload it produced is the
    // commit this hook was complaining about.
    rerender({ sha: MOVED });

    expect(result.current.movedTo).toBeNull();
  });

  it('stops listening when the page goes away', () => {
    requestMock.mockResolvedValue(at(MOVED));
    const { unmount } = renderHook(() => useHeadMoved(PR, LOADED));

    unmount();
    advance(HEAD_CHECK_FLOOR_MS);
    refocus();

    expect(requestMock).not.toHaveBeenCalled();
  });
});
