/**
 * The loading state, which is mostly an absence.
 *
 * The prefetch means a warm payload usually lands within a frame or two. A
 * spinner drawn and torn down in that window reads as a glitch, so nothing is
 * drawn until the wait is long enough that silence would read as breakage.
 */

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingState, QUIET_MS } from './LoadingState';

afterEach(() => {
  vi.useRealTimers();
});

describe('LoadingState', () => {
  it('draws nothing for a fast reply', () => {
    vi.useFakeTimers();

    const { container } = render(<LoadingState />);

    act(() => {
      vi.advanceTimersByTime(QUIET_MS - 1);
    });
    expect(container.innerHTML).toBe('');
  });

  it('says something once the wait is long enough to look broken', () => {
    vi.useFakeTimers();

    const { container } = render(<LoadingState />);

    act(() => {
      vi.advanceTimersByTime(QUIET_MS);
    });
    expect(container.textContent).toMatch(/loading/i);
  });
});
