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

afterEach(() => {
  Object.defineProperty(browser.storage, 'onChanged', {
    value: original,
    writable: true,
    configurable: true,
  });
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
