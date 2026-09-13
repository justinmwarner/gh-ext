/**
 * Which repositories the dashboard reads, and the list it offers to choose
 * from.
 *
 * Two pieces of state with very different costs, which is why they load
 * separately. The **watch list** is a setting: local, instant, and the thing
 * every other request depends on. **Discovery** is a round trip to GitHub, so
 * it is made lazily — when the reviewer actually opens the picker, or on a
 * first run where there is nothing to show them instead.
 *
 * Nothing here fetches a pull request. That is the point: an account with
 * nothing ticked costs one cheap query that names repositories, not four that
 * read eighty-six pull requests.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DiscoveredRepo } from '@/lib/dashboard/repos';
import { toggleWatched } from '@/lib/dashboard/repos';
import { logWarn } from '@/lib/log';
import { isErr, message } from '@/lib/messages';
import { readSettings, writeSettings } from '@/lib/settings-store';
import { request } from './background';

export interface Repos {
  /** Null until the settings have been read, so nothing renders one behind. */
  watched: string[] | null;
  discovered: DiscoveredRepo[];
  discovering: boolean;
  /** Whether discovery has been asked for at all yet. */
  asked: boolean;
  discover: () => void;
  toggle: (nameWithOwner: string) => void;
}

export function useRepos(): Repos {
  const [watched, setWatched] = useState<string[] | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredRepo[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    void readSettings()
      .then((settings) => setWatched(settings.watchedRepos))
      .catch((error: unknown) => {
        logWarn('could not read the watched repositories', error);
        setWatched([]);
      });
  }, []);

  const discover = useCallback(() => {
    setAsked(true);
    setDiscovering(true);
    void (async () => {
      const reply = await request(message('discover-repos', {}));
      setDiscovering(false);
      if (isErr(reply)) {
        logWarn('could not discover repositories', reply.error);
        return;
      }
      setDiscovered(reply.data.repos);
    })();
  }, []);

  const toggle = useCallback((nameWithOwner: string) => {
    setWatched((current) => {
      const next = toggleWatched(current ?? [], nameWithOwner);
      // Read-modify-write against the whole settings object rather than
      // against the copy this hook is holding: the options page writes the
      // same key, and the field this one does not know about must survive.
      void readSettings()
        .then((settings) => writeSettings({ ...settings, watchedRepos: next }))
        .catch((error: unknown) => {
          logWarn('could not save the watched repositories', error);
        });
      return next;
    });
  }, []);

  return { watched, discovered, discovering, asked, discover, toggle };
}
