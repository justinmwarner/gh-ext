/**
 * The remembered comparison mode reaching an open review, and staying current.
 *
 * The same two halves as `useSettings`, failing the same two ways: without the
 * read a preference does nothing until reload, and without the listener a
 * second review tab and this one disagree about how Markdown is drawn.
 *
 * The shared stub in `testSetup` answers reads but has an inert `onChanged`, so
 * this file installs a working one for the duration and puts the original back.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODE_MEMORY_KEY, type ModeMemory } from '@/lib/settings';
import { useModeMemory } from './useModeMemory';

type Listener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

let listeners: Listener[] = [];
let original: unknown;

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
  await browser.storage.local.remove(MODE_MEMORY_KEY);
});

/** Put the storage area's `get` back, for the one test that holds it open. */
let restoreGet: (() => void) | null = null;

afterEach(() => {
  Object.defineProperty(browser.storage, 'onChanged', {
    value: original,
    writable: true,
    configurable: true,
  });
  restoreGet?.();
  restoreGet = null;
});

/** What another review tab does when the reviewer presses a mode in it. */
const announce = (memory: ModeMemory): void => {
  act(() => {
    for (const listener of [...listeners]) {
      listener({ [MODE_MEMORY_KEY]: { newValue: memory } }, 'local');
    }
  });
};

let remember: (kind: 'markdown', mode: string) => void = () => {};

function Probe() {
  const [memory, set] = useModeMemory();
  remember = set;
  return <output>{memory.markdown ?? 'unset'}</output>;
}

const shown = (): string => screen.getByRole('status').textContent ?? '';

describe('useModeMemory', () => {
  it('renders unset before storage has answered', () => {
    render(<Probe />);
    expect(shown()).toBe('unset');
  });

  it('picks up what was stored', async () => {
    await browser.storage.local.set({ [MODE_MEMORY_KEY]: { markdown: 'raw' } });

    render(<Probe />);

    await waitFor(() => {
      expect(shown()).toBe('raw');
    });
  });

  it('remembering shows at once and is written through', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('unset');
    });

    act(() => {
      remember('markdown', 'raw');
    });

    expect(shown()).toBe('raw');
    await waitFor(async () => {
      const stored = await browser.storage.local.get(MODE_MEMORY_KEY);
      expect(stored[MODE_MEMORY_KEY]).toEqual({ markdown: 'raw' });
    });
  });

  it('follows a press made in another review tab', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('unset');
    });

    announce({ markdown: 'raw' });

    expect(shown()).toBe('raw');
  });

  /**
   * The reviewer's own press outranks a read issued before they made it.
   *
   * The opening read resolves a tick after mount, and until this was pinned it
   * was entitled to overwrite whatever it landed on — so a press made inside
   * that tick turned the cards and then let them turn back, with nothing on
   * screen to say why. `storage.onChanged` fires on this page's own writes and
   * would have healed it a moment later, which is exactly what makes it the
   * kind of flicker nobody reports and nobody can reproduce.
   *
   * The read is held open by stubbing the storage area rather than the store,
   * keeping this file's rule that it tests the real `lib/settings-store`.
   */
  it('does not let the opening read clobber a press made during it', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = browser.storage.local.get.bind(browser.storage.local);
    Object.defineProperty(browser.storage.local, 'get', {
      // Read at call time and delivered late, which is the shape of the race.
      // Awaiting the gate *before* reading would see what the press has since
      // written and hand back the same value either way — a test that passes
      // whether or not the bug is there.
      value: async (key: string) => {
        const snapshot = await real(key);
        await held;
        return snapshot;
      },
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

    render(<Probe />);
    expect(shown()).toBe('unset');

    act(() => {
      remember('markdown', 'raw');
    });
    expect(shown()).toBe('raw');

    // The read now answers, with what storage held before the press.
    await act(async () => {
      release();
      await held;
    });

    expect(shown()).toBe('raw');
  });

  it('ignores a write to a different area', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('unset');
    });

    act(() => {
      for (const listener of [...listeners]) {
        listener({ [MODE_MEMORY_KEY]: { newValue: { markdown: 'raw' } } }, 'sync');
      }
    });

    expect(shown()).toBe('unset');
  });
});
