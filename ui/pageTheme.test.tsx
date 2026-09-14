/**
 * The chosen theme, arriving before the paint rather than after it.
 *
 * Two claims are worth holding down here and they are the two faults the file
 * was written for. The first is that *something* owns `<html>` on every route,
 * not only on a loaded pull request — leaving the options page for the
 * dashboard used to drop the reviewer back into whatever the operating system
 * thought. The second is that the mirror is read synchronously, because a
 * theme applied one tick late is exactly the flicker being complained about.
 *
 * `@/lib/settings-store` is mocked at the module boundary, the way `App.test`
 * mocks the worker: what is under test is the decision about when to dress the
 * page, not whether `browser.storage` can be read.
 */

import { render } from '@testing-library/react';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { onSettingsChanged, readSettings } from '@/lib/settings-store';
import { bootPageTheme, usePageTheme, wearPageTheme } from './pageTheme';

vi.mock('@/lib/settings-store', () => ({
  readSettings: vi.fn(),
  onSettingsChanged: vi.fn(),
}));

const readSettingsMock = readSettings as unknown as Mock;
const onSettingsChangedMock = onSettingsChanged as unknown as Mock;

/** The same key `pageTheme.ts` writes. Spelled out so a rename fails here. */
const MIRROR_KEY = 'abr:chrome-theme';

/** A real id, so `chromeTheme` has a palette to find rather than a null. */
const DARK = 'github-dark';

const settings = (diffTheme: string): Settings => ({ ...DEFAULT_SETTINGS, diffTheme });

const root = () => document.documentElement;

/** One token off the palette, enough to say whether it was written at all. */
const canvas = () => root().style.getPropertyValue('--canvas-default');

function Probe() {
  usePageTheme();
  return null;
}

beforeEach(() => {
  readSettingsMock.mockReset();
  onSettingsChangedMock.mockReset();
  onSettingsChangedMock.mockReturnValue(() => {});
  // `readSettings` never settling is the state a boot has to survive, so it is
  // the default here and the tests that care resolve it themselves.
  readSettingsMock.mockImplementation(() => new Promise<never>(() => {}));
  window.localStorage.clear();
});

afterEach(() => {
  root().removeAttribute('data-syntax-theme');
  root().removeAttribute('style');
  window.localStorage.clear();
});

describe('booting from the mirror', () => {
  it('dresses the page synchronously, before anything has rendered', () => {
    window.localStorage.setItem(MIRROR_KEY, DARK);

    bootPageTheme();

    // No awaits above. That is the whole point: the frame this is getting in
    // front of is gone by the time a promise resolves.
    expect(root().getAttribute('data-syntax-theme')).toBe(DARK);
    expect(canvas()).not.toBe('');
    expect(root().style.colorScheme).toBe('dark');
  });

  it('leaves the page alone when nothing has been mirrored yet', () => {
    bootPageTheme();

    // A fresh install has no mirror, and the default has to be the *absence*
    // of this code path rather than something equivalent to it.
    expect(root().hasAttribute('data-syntax-theme')).toBe(false);
    expect(root().getAttribute('style')).toBe(null);
  });

  it('leaves it alone for a reviewer who has chosen to follow the page', () => {
    window.localStorage.setItem(MIRROR_KEY, '');

    bootPageTheme();

    expect(root().hasAttribute('data-syntax-theme')).toBe(false);
    expect(root().getAttribute('style')).toBe(null);
  });

  it('ignores a theme this build has never heard of', () => {
    // The mirror outlives the build that wrote it. Somebody who rolls back
    // from a version with more themes has one of them sitting here, and
    // setting the attribute to it would turn off the Primer fallback in favour
    // of a theme that does not exist.
    window.localStorage.setItem(MIRROR_KEY, 'theme-from-the-future');

    bootPageTheme();

    expect(root().hasAttribute('data-syntax-theme')).toBe(false);
  });
});

describe('wearing a theme', () => {
  it('mirrors what it wears, so the next load can start there', () => {
    wearPageTheme(DARK);

    expect(window.localStorage.getItem(MIRROR_KEY)).toBe(DARK);
  });

  it('mirrors the absence of one too', () => {
    window.localStorage.setItem(MIRROR_KEY, DARK);

    wearPageTheme('');

    // Otherwise turning a theme off would leave the old one booting on every
    // load until something else overwrote it.
    expect(window.localStorage.getItem(MIRROR_KEY)).toBe('');
    expect(root().hasAttribute('data-syntax-theme')).toBe(false);
  });
});

describe('following the stored setting', () => {
  it('does not undress a booted page while the read is still in flight', () => {
    window.localStorage.setItem(MIRROR_KEY, DARK);
    bootPageTheme();

    render(<Probe />);

    // `useSettings` would have handed over `DEFAULT_SETTINGS` here, and acting
    // on it would strip the theme and put the flicker back.
    expect(root().getAttribute('data-syntax-theme')).toBe(DARK);
  });

  it('wears what storage says once it arrives', async () => {
    readSettingsMock.mockResolvedValue(settings(DARK));

    render(<Probe />);
    await vi.waitFor(() => {
      expect(root().getAttribute('data-syntax-theme')).toBe(DARK);
    });

    expect(root().style.colorScheme).toBe('dark');
  });

  it('follows a change made on the options page', async () => {
    readSettingsMock.mockResolvedValue(settings(''));
    let notify: ((next: Settings) => void) | null = null;
    onSettingsChangedMock.mockImplementation((onChange: (next: Settings) => void) => {
      notify = onChange;
      return () => {};
    });

    render(<Probe />);
    await vi.waitFor(() => {
      expect(notify).not.toBe(null);
    });
    notify!(settings(DARK));

    expect(root().getAttribute('data-syntax-theme')).toBe(DARK);
  });

  it('keeps what the mirror gave it when storage cannot be read', async () => {
    window.localStorage.setItem(MIRROR_KEY, DARK);
    bootPageTheme();
    readSettingsMock.mockRejectedValue(new Error('no storage'));

    render(<Probe />);
    await vi.waitFor(() => {
      expect(readSettingsMock).toHaveBeenCalled();
    });

    // An unreadable settings area is not a reason to undress the page. What
    // the mirror supplied is the best answer available and it is already on.
    expect(root().getAttribute('data-syntax-theme')).toBe(DARK);
  });

  it('takes its listener back down when the page goes', () => {
    const stop = vi.fn();
    onSettingsChangedMock.mockReturnValue(stop);

    render(<Probe />).unmount();

    expect(stop).toHaveBeenCalled();
  });
});
