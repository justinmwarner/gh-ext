/**
 * The order reviews open in, read before one is drawn and kept current.
 *
 * Unlike `useModeMemory`, this has a state before storage answers, and it is
 * the state the page waits on: `App` holds the review back until the order is
 * known. So the null is pinned, and so is the way out of it when storage
 * cannot be read at all, because a page waiting on a read that failed would
 * wait for good.
 *
 * The shared stub in `testSetup` answers reads but has an inert `onChanged`, so
 * this file installs a working one for the duration and puts the original back.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Arrangement } from '@/lib/review/readingOrder';
import { ARRANGEMENT_KEY } from '@/lib/settings';
import { useStoredArrangement } from './useStoredArrangement';

type Listener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

let listeners: Listener[] = [];
let original: unknown;

/** Put the storage area's `get` back, for the tests that replace it. */
let restoreGet: (() => void) | null = null;

beforeEach(async () => {
  listeners = [];
  original = browser.storage.onChanged;
  Object.defineProperty(browser.storage, 'onChanged', {
    value: {
      addListener: (fn: Listener) => listeners.push(fn),
      removeListener: (fn: Listener) => {
        listeners = listeners.filter((held) => held !== fn);
      },
    },
    writable: true,
    configurable: true,
  });
  await browser.storage.local.remove(ARRANGEMENT_KEY);
});

afterEach(async () => {
  Object.defineProperty(browser.storage, 'onChanged', {
    value: original,
    writable: true,
    configurable: true,
  });
  restoreGet?.();
  restoreGet = null;
  // The fake storage area outlives the test. An order written here would be
  // the order every later test in this run opened in.
  await browser.storage.local.remove(ARRANGEMENT_KEY);
});

/** Answer reads some other way, for one test. */
function stubGet(get: (key: string) => Promise<Record<string, unknown>>): void {
  const real = browser.storage.local.get.bind(browser.storage.local);
  Object.defineProperty(browser.storage.local, 'get', {
    value: get,
    writable: true,
    configurable: true,
  });
  restoreGet = () => {
    Object.defineProperty(browser.storage.local, 'get', {
      value: real,
      writable: true,
      configurable: true,
    });
  };
}

/** What another review tab does when the reviewer changes the order in it. */
const announce = (arrangement: unknown): void => {
  act(() => {
    for (const listener of [...listeners]) {
      listener({ [ARRANGEMENT_KEY]: { newValue: arrangement } }, 'local');
    }
  });
};

let latest: Arrangement | null = null;
let arrange: (next: Arrangement) => void = () => {};

function Probe() {
  const [arrangement, set] = useStoredArrangement();
  latest = arrangement;
  arrange = set;
  return (
    <output>
      {arrangement === null ? 'unread' : `${arrangement.sort}|${arrangement.last.join(',')}`}
    </output>
  );
}

const shown = (): string => screen.getByRole('status').textContent ?? '';

describe('useStoredArrangement', () => {
  it('is unread until storage has answered', () => {
    render(<Probe />);
    expect(shown()).toBe('unread');
  });

  it('answers folder order when nothing was ever chosen', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('folders|');
    });
  });

  it('answers what was stored', async () => {
    await browser.storage.local.set({
      [ARRANGEMENT_KEY]: { sort: 'changes', last: ['.story.ts', '.snap'] },
    });

    render(<Probe />);

    await waitFor(() => {
      expect(shown()).toBe('changes|.story.ts,.snap');
    });
  });

  it('answers folder order when storage cannot be read, rather than leaving the page waiting', async () => {
    stubGet(() => Promise.reject(new Error('storage is unavailable')));

    render(<Probe />);

    await waitFor(() => {
      expect(shown()).toBe('folders|');
    });
  });

  it('shows a change at once and writes it through', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('folders|');
    });

    act(() => {
      arrange({ sort: 'folders', last: ['.story.ts'] });
    });

    expect(shown()).toBe('folders|.story.ts');
    await waitFor(async () => {
      const stored = await browser.storage.local.get(ARRANGEMENT_KEY);
      expect(stored[ARRANGEMENT_KEY]).toEqual({ sort: 'folders', last: ['.story.ts'] });
    });
  });

  it('follows a change made in another review tab', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('folders|');
    });

    announce({ sort: 'changes', last: [] });

    expect(shown()).toBe('changes|');
  });

  it('keeps the object it holds when a change says the same thing', async () => {
    // Every write comes back through `onChanged`, this page's own included,
    // as a new object. Taken, it would lay every surface out again.
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('folders|');
    });
    act(() => {
      arrange({ sort: 'changes', last: ['.snap'] });
    });
    const held = latest;

    announce({ sort: 'changes', last: ['.snap'] });

    expect(latest).toBe(held);
  });

  it('does not let the opening read undo a change made in another tab during it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = browser.storage.local.get.bind(browser.storage.local);
    // Read at call time and delivered late, which is the shape of the race.
    stubGet(async (key) => {
      const snapshot = await real(key);
      await gate;
      return snapshot;
    });

    render(<Probe />);
    expect(shown()).toBe('unread');

    announce({ sort: 'changes', last: ['.md'] });
    expect(shown()).toBe('changes|.md');

    // The read now answers, with what storage held before the change.
    await act(async () => {
      release();
      await gate;
    });

    expect(shown()).toBe('changes|.md');
  });

  it('ignores a write to a different area', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('folders|');
    });

    act(() => {
      for (const listener of [...listeners]) {
        listener({ [ARRANGEMENT_KEY]: { newValue: { sort: 'changes', last: [] } } }, 'sync');
      }
    });

    expect(shown()).toBe('folders|');
  });
});
