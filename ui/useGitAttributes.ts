/**
 * What the repository itself says about which of its files are generated.
 *
 * Read from `.gitattributes` at the head commit, because that is where Linguist
 * reads it and because GitHub answers the question nowhere else — see
 * `lib/review/generated.ts`. A repository that has declared its own generated
 * files knows better than any pattern list, and this is the only way to hear it.
 *
 * **Nothing here fetches.** `get-blob` is the same message the diff expander
 * uses, so the worker holds the token, makes the request and caches the result;
 * a second review of the same pull request costs no round trip at all. Asking
 * for a file that does not exist is an ordinary answer on that path — `absent`
 * — rather than an error, which matters because the overwhelming majority of
 * repositories have no `.gitattributes` and none of them should produce a
 * failure the page has to explain.
 *
 * Only the root file is read. Git resolves attributes from a `.gitattributes`
 * in every directory on the way down, and honouring that would mean one request
 * per directory in the pull request to find files that almost never exist. The
 * root file is where `linguist-generated` is declared in practice.
 *
 * Requested only while the setting that uses it is on. A reviewer who has not
 * asked for generated files to be folded should not have this extension reading
 * extra files out of their repositories on their behalf.
 */

import { useEffect, useState } from 'react';
import {
  type GeneratedRule,
  NO_ATTRIBUTES,
  parseGitAttributes,
} from '@/lib/review/generated';
import { type PrRef, message } from '@/lib/messages';
import { request } from './background';

/** Where Linguist looks, and therefore where this looks. */
export const GITATTRIBUTES = '.gitattributes';

export function useGitAttributes(
  pr: PrRef,
  headSha: string,
  enabled: boolean,
): readonly GeneratedRule[] {
  const [rules, setRules] = useState<readonly GeneratedRule[]>(NO_ATTRIBUTES);

  useEffect(() => {
    if (!enabled) {
      // Back to knowing nothing rather than keeping the last answer. The rules
      // are only consulted while the setting is on, but a stale set surviving a
      // change of pull request would be a quiet way to fold the wrong file.
      setRules(NO_ATTRIBUTES);
      return;
    }

    let live = true;
    void request(message('get-blob', { pr, path: GITATTRIBUTES, ref: headSha }))
      .then((response) => {
        if (!live) return;
        // Every other answer — no such file, too large, not text, a refusal —
        // means the same thing here: the repository has said nothing, and the
        // patterns decide. None of them is worth a sentence on screen for a
        // file the reviewer never asked about.
        if (!response.ok || response.data.status !== 'ok') {
          setRules(NO_ATTRIBUTES);
          return;
        }
        setRules(parseGitAttributes(response.data.text));
      })
      .catch(() => {
        if (live) setRules(NO_ATTRIBUTES);
      });

    return () => {
      live = false;
    };
  }, [pr, headSha, enabled]);

  return rules;
}
