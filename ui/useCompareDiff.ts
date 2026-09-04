/**
 * The diff between two commits of this pull request.
 *
 * One request to the worker for `base...head`, turned into the same
 * `ReviewFile[]` the full diff produces — so the column, the tree and thread
 * anchoring all work on it without knowing which diff they are looking at.
 * A single commit, a range of commits and "since my last review" all arrive
 * here as the same resolved pair, which is what keeps the three from drifting
 * apart.
 *
 * The file list is rebuilt through `reviewFiles` rather than assembled here,
 * which is what keeps the two paths honest: the GraphQL metadata join, the
 * viewed states and the noise patterns are applied exactly once, in one place.
 * The counts come from that metadata, so a file that only partly changed in
 * the selected commits still shows the pull request's totals — which is the
 * truth about the file, and the narrowed patch is the truth about what to read.
 *
 * Nothing here calls `fetch`. The worker holds the token.
 */

import { useEffect, useRef, useState } from 'react';
import { type PrPayload, message } from '@/lib/messages';
import type { ResolvedScope } from '@/lib/review/diffScope';
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
  /**
   * What the reviewer asked for, already resolved against the current history.
   *
   * Anything but `narrowed` means there is nothing to fetch: the whole diff is
   * on screen, or the scope named a commit this pull request no longer has, or
   * the two ends are the same commit. In every one of those cases the request
   * would either be pointless or would answer confidently about the wrong
   * history, so it is not made.
   */
  scope: ResolvedScope;
}

export function useCompareDiff({ payload, scope }: CompareRequest): CompareState {
  const [state, setState] = useState<CompareState>(OFF);

  const { owner, repo, number } = payload.ref;
  const base = scope.kind === 'narrowed' ? scope.range.base : null;
  const head = scope.kind === 'narrowed' ? scope.range.head : null;

  // Read inside the callback, which runs long after the render that made it.
  // Held in a ref rather than named as a dependency: the payload is a fresh
  // object on some renders, and re-running this would re-fetch a comparison
  // whose two commits have not moved.
  const latest = useRef(payload);
  latest.current = payload;

  useEffect(() => {
    if (base === null || head === null) {
      setState(OFF);
      return;
    }

    let live = true;
    setState({ status: 'loading' });

    const pr = { owner, repo, number };
    void request(message('compare-diff', { pr, base, head })).then((response) => {
      // The scope can be changed, or the pull request retargeted, while this
      // is in flight. A late reply for a comparison nobody is waiting for must
      // not replace the diff the reviewer went back to.
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
  }, [base, head, owner, repo, number]);

  return state;
}
