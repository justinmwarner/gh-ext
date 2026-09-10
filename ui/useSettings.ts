/**
 * The reviewer's stored preferences, kept current while the page is open.
 *
 * Two of them decide how the diff is drawn — whether whitespace-only changes
 * are hidden, and whether the two sides sit in one column or two — and both are
 * set on the options page, which is a page of its own. So a review that only
 * read storage once would go on drawing the old way for as long as the tab
 * stayed open, and the reviewer would go back to the options page to check they
 * had really clicked the thing they had really clicked.
 *
 * Starts on {@link DEFAULT_SETTINGS} rather than on null. The first read
 * resolves a tick after mount, long before the pull request itself arrives
 * over the wire, so a nullable return would make every caller handle a state
 * nothing is ever rendered in. The defaults are what the page would draw
 * anyway.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { onSettingsChanged, readSettings } from '@/lib/settings-store';

export function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let live = true;
    // A change already applied outranks the opening read, which was issued
    // before it and may still be in flight holding the superseded value.
    let changed = false;

    // The listener goes on before the read, so a write landing between the two
    // is not lost — the same ordering `followLoggingSetting` uses.
    const stop = onSettingsChanged((next) => {
      if (!live) return;
      changed = true;
      setSettings(next);
    });

    void readSettings()
      .then((stored) => {
        if (live && !changed) setSettings(stored);
      })
      // Storage that cannot be read is not a reason to render nothing. The
      // defaults are already on screen and are the honest fallback.
      .catch(() => {});

    return () => {
      live = false;
      stop();
    };
  }, []);

  return settings;
}
