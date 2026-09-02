/**
 * The diff since the reviewer's own last review.
 *
 * One request to the worker for `base...head`, turned into the same
 * `ReviewFile[]` the full diff produces — so the column, the tree and thread
 * anchoring all work on it without knowing which diff they are looking at.
 *
 * The file list is rebuilt through `reviewFiles` rather than assembled here,
 * which is what keeps the two paths honest: the GraphQL metadata join, the
 * viewed states and the noise patterns are applied exactly once, in one place.
 * The counts come from that metadata, so a file that only partly changed since
 * the last review still shows the pull request's totals — which is the truth
 * about the file, and the narrowed patch is the truth about what to read.
 *
 * Nothing here calls `fetch`. The worker holds the token.
 */

import { useEffect, useRef, useState } from 'react';
import { type PrPayload, message } from '@/lib/messages';
import { request } from './background';
import { type ReviewFile, reviewFiles } from './reviewFiles';

export type CompareState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; files: readonly ReviewFile[] }
  | { status: 'failed'; message: string };

const OFF: CompareState = { status: 'off' };

export interface CompareRequest {
  payload: PrPayload;
  /** The commit the viewer last reviewed at. Null disables the whole thing. */
  base: string | null;
  enabled: boolean;
}

export function useCompareDiff({ payload, base, enabled }: CompareRequest): CompareState {
  const [state, setState] = useState<CompareState>(OFF);

  const head = payload.headSha;
  const { owner, repo, number } = payload.ref;

  // Read inside the callback, which runs long after the render that made it.
  // Held in a ref rather than named as a dependency: the payload is a fresh
  // object on some renders, and re-running this would re-fetch a comparison
  // whose two commits have not moved.
  const latest = useRef(payload);
  latest.current = payload;

  useEffect(() => {
    if (!enabled || base === null) {
      setState(OFF);
      return;
    }

    let live = true;
    setState({ status: 'loading' });

    const pr = { owner, repo, number };
    void request(message('compare-diff', { pr, base, head })).then((response) => {
      // The toggle can be switched off, or the pull request retargeted, while
      // this is in flight. A late reply for a comparison nobody is waiting for
      // must not replace the diff the reviewer went back to.
      if (!live) return;

      if (!response.ok) {
        setState({ status: 'failed', message: response.error.message });
        return;
      }

      setState({
        status: 'ready',
        files: reviewFiles({
          ...latest.current,
          diff: { source: 'unified', files: response.data.files, truncated: false },
        }),
      });
    });

    return () => {
      live = false;
    };
  }, [enabled, base, head, owner, repo, number]);

  return state;
}
