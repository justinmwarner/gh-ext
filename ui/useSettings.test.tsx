/**
 * Preferences reaching an open review, and staying current in it.
 *
 * Both halves matter and they fail differently. Without the read, a stored
 * preference does nothing until the page is reloaded; without the listener, it
 * does nothing until the *tab* is reloaded — the reviewer ticks a box on the
 * options page, comes back to the review they were reading, and finds it drawn
 * exactly as before. The second failure is the one that reads as a broken
 * setting rather than a slow one.
 *
 * The shared stub in `testSetup` answers reads but has an inert
 * `onChanged`, so this file installs a working one for the duration and puts
 * the original back afterwards.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from '@/lib/settings';
import { useSettings } from './useSettings';

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
  await browser.storage.local.remove(SETTINGS_KEY);
});

afterEach(() => {
  Object.defineProperty(browser.storage, 'onChanged', {
    value: original,
    writable: true,
    configurable: true,
  });
});

/** What the options page does when a checkbox is ticked. */
const announce = (settings: Partial<Settings>): void => {
  act(() => {
    for (const listener of [...listeners]) {
      listener({ [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, ...settings } } }, 'local');
    }
  });
};

function Probe() {
  const settings = useSettings();
  return (
    <output>
      {`${settings.openIn}/${String(settings.splitView)}/${String(settings.ignoreWhitespace)}`}
    </output>
  );
}

const shown = (): string => screen.getByRole('status').textContent ?? '';

describe('useSettings', () => {
  it('renders the defaults before storage has answered', () => {
    // Synchronously, on the first paint. A nullable return would make every
    // caller handle a state the page is never actually rendered in — the read
    // resolves a tick later, and the pull request itself takes a round trip.
    render(<Probe />);

    expect(shown()).toBe('new-tab/false/false');
  });

  it('picks up what was stored', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, splitView: true },
    });

    render(<Probe />);

    await waitFor(() => {
      expect(shown()).toBe('new-tab/true/false');
    });
  });

  it('follows a change made on the options page', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('new-tab/false/false');
    });

    announce({ ignoreWhitespace: true });

    expect(shown()).toBe('new-tab/false/true');
  });

  it('ignores a write to a different area', () => {
    render(<Probe />);

    act(() => {
      for (const listener of [...listeners]) {
        listener({ [SETTINGS_KEY]: { newValue: { splitView: true } } }, 'session');
      }
    });

    expect(shown()).toBe('new-tab/false/false');
  });

  it('ignores a write to a different key', () => {
    render(<Probe />);

    act(() => {
      for (const listener of [...listeners]) {
        listener({ 'card-collapsed': { newValue: true } }, 'local');
      }
    });

    expect(shown()).toBe('new-tab/false/false');
  });

  it('validates what arrives on the change rather than trusting it', () => {
    // The options page writes a whole object, and a build with more fields
    // than this one writes fields this one has never heard of. Anything
    // unrecognized has to fall back rather than reach the page.
    render(<Probe />);

    act(() => {
      for (const listener of [...listeners]) {
        listener(
          { [SETTINGS_KEY]: { newValue: { openIn: 'floating-panel', splitView: 'yes' } } },
          'local',
        );
      }
    });

    expect(shown()).toBe('new-tab/false/false');
  });

  it('does not let the opening read undo a change that overtook it', async () => {
    // The read is issued after the listener is installed, so a write landing
    // while it is in flight is announced first and resolved second. Without a
    // guard the stale read wins and the reviewer's change appears to have been
    // rejected.
    render(<Probe />);

    announce({ splitView: true });
    expect(shown()).toBe('new-tab/true/false');

    // Long enough for the opening read — a resolved promise — to have settled.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shown()).toBe('new-tab/true/false');
  });

  it('takes its listener back down when the page goes away', () => {
    const view = render(<Probe />);
    expect(listeners).toHaveLength(1);

    view.unmount();

    expect(listeners).toHaveLength(0);
  });
});
