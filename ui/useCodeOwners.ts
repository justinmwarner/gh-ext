/**
 * Which changed files the reviewer owns, as the repository's CODEOWNERS says.
 *
 * What "Show only files you own" asks, and the only one of the file filters
 * that fetches anything: the file itself, and who the reviewer is. GitHub
 * decides ownership server-side and says nothing about it per file over any
 * API, so both halves are read here and matched in `lib/review/codeowners.ts`.
 *
 * **Nothing here fetches.** `get-blob` is the message the diff expander and
 * `useGitAttributes` already use, so the worker holds the token, makes the
 * request and caches it, and a CODEOWNERS path that does not exist is an
 * ordinary `absent` rather than an error. `get-viewer-teams` is the other half.
 *
 * **Read at the base commit**, because that is the file GitHub itself applies
 * to a pull request: a change to CODEOWNERS in this very pull request does not
 * decide who owns it.
 *
 * **Asked for only once the filter is turned on**, like `.gitattributes` for
 * the fold setting, and for the same reason: the teams a reviewer is on are not
 * something to read out of GitHub on their behalf uninvited. Once answered, the
 * answer is kept for the rest of the review. That is not only thrift — when the
 * answer is "there is no CODEOWNERS file", the shell turns the filter back off,
 * and the row has to go on saying why rather than unticking itself in silence.
 *
 * Two kinds of "no", kept apart. A file that is absent, too large or not text
 * is an answer about the repository and will be the same answer next time, so
 * the row is refused. A request that failed — a rate limit, the network — is
 * an answer about this minute, so the row stays offered and turning the filter
 * on again asks again.
 */

import { useEffect, useMemo, useState } from 'react';
import { type PrRef, message } from '@/lib/messages';
import { TEAM_PAGE } from '@/lib/github/teams';
import {
  CODEOWNERS_PATHS,
  type OwnerIdentity,
  type OwnerRule,
  isOwnedBy,
  parseCodeowners,
} from '@/lib/review/codeowners';
import { request } from './background';
import type { OwnershipNote } from './FilterMenu';

export type Ownership =
  /** Not asked for yet. */
  | { state: 'off' }
  | { state: 'reading' }
  | {
      state: 'ready';
      rules: readonly OwnerRule[];
      identity: OwnerIdentity;
      /** False when GitHub would not say which teams the reviewer is on. */
      teamsKnown: boolean;
      /** GitHub listed only the first {@link TEAM_PAGE} of them. */
      teamsTruncated: boolean;
    }
  /** None of the three places GitHub looks has one. */
  | { state: 'absent' }
  /** There is a file, and it cannot be read here — and will not be next time either. */
  | { state: 'unreadable'; reason: string }
  /** A request failed. Worth asking again, and asked again when the filter next goes on. */
  | { state: 'failed'; reason: string };

export interface CodeOwners {
  /** `ownership.state`, lifted out for the checks that need nothing else. */
  state: Ownership['state'];
  ownership: Ownership;
  /** Whether the reviewer owns a path, or null until that can be answered. */
  owned: ((path: string) => boolean) | null;
}

const OFF: Ownership = { state: 'off' };
const READING: Ownership = { state: 'reading' };

/** The file, from the first of GitHub's three places that has one. */
async function readFile(pr: PrRef, ref: string): Promise<Ownership | string> {
  for (const path of CODEOWNERS_PATHS) {
    const response = await request(message('get-blob', { pr, path, ref }));
    if (!response.ok) {
      return { state: 'failed', reason: `CODEOWNERS could not be read: ${response.error.message}` };
    }
    const blob = response.data;
    if (blob.status === 'absent') continue;
    if (blob.status === 'ok') return blob.text;
    // GitHub uses the first file it finds even if this page cannot read it, so
    // moving on to the next place would be reading the wrong file.
    return {
      state: 'unreadable',
      reason:
        blob.status === 'too-large'
          ? `The CODEOWNERS file at ${path} is too large to read here`
          : `The CODEOWNERS file at ${path} is not text`,
    };
  }
  return { state: 'absent' };
}

export function useCodeOwners(pr: PrRef, baseSha: string | null, enabled: boolean): CodeOwners {
  const [ownership, setOwnership] = useState<Ownership>(OFF);
  /**
   * How many times this pull request has been asked about. Zero until the
   * filter is first turned on, and moved again only after a failure.
   */
  const [attempt, setAttempt] = useState(0);

  // A different pull request, or the same one at a different base, is a
  // different question. Reset during render, so no frame answers the old one.
  const key = `${pr.owner}/${pr.repo}/${pr.number}@${baseSha ?? ''}`;
  const [askedFor, setAskedFor] = useState(key);
  if (askedFor !== key) {
    setAskedFor(key);
    setAttempt(0);
    setOwnership(OFF);
  }

  // The filter going on is the only thing that asks: the first time, and again
  // after an answer that might not be the same twice. An answer that will be —
  // absent, unreadable — is kept, and the row it produces cannot be ticked.
  useEffect(() => {
    if (!enabled) return;
    if (attempt === 0 || ownership.state === 'failed') setAttempt((count) => count + 1);
    // Keyed on the press and on the question, not on the answers: a refreshed
    // payload with a new base while the filter is on is a new question, and
    // the reset above has already put `attempt` back to zero for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  useEffect(() => {
    if (attempt === 0) return;
    if (baseSha === null) {
      // A payload cached before `baseRefOid` was queried has no base commit to
      // read at, and reading at the head instead would be the wrong file.
      setOwnership({
        state: 'unreadable',
        reason: 'This pull request has no base commit to read CODEOWNERS at',
      });
      return;
    }

    let live = true;
    setOwnership(READING);

    void Promise.all([readFile(pr, baseSha), request(message('get-viewer-teams', { pr }))])
      .then(([file, who]) => {
        if (!live) return;
        if (typeof file !== 'string') {
          setOwnership(file);
          return;
        }
        if (!who.ok) {
          setOwnership({
            state: 'failed',
            reason: `GitHub would not say who you are: ${who.error.message}`,
          });
          return;
        }
        setOwnership({
          state: 'ready',
          rules: parseCodeowners(file),
          identity: { login: who.data.login, teams: who.data.teams ?? [] },
          teamsKnown: who.data.teams !== null,
          teamsTruncated: who.data.truncated,
        });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setOwnership({
          state: 'failed',
          reason: `CODEOWNERS could not be read: ${error instanceof Error ? error.message : String(error)}`,
        });
      });

    return () => {
      live = false;
    };
    // `pr` is keyed through `key`: the shell rebuilds the ref object, and a new
    // identity for the same pull request is not a reason to read it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, key, baseSha]);

  const owned = useMemo(() => {
    if (ownership.state !== 'ready') return null;
    const { rules, identity } = ownership;
    return (path: string) => isOwnedBy(path, rules, identity);
  }, [ownership]);

  return { state: ownership.state, ownership, owned };
}

/**
 * Whether the answer so far means the filter cannot be on.
 *
 * Every state but a clean one and a pending one. Left on, "only files you own"
 * would hide every file on the strength of nothing and call that the answer.
 */
export const ownershipRefused = (state: Ownership['state']): boolean =>
  state === 'absent' || state === 'unreadable' || state === 'failed';

/**
 * What the menu row says, and whether it can be ticked.
 *
 * Every state that is not a clean answer is a sentence, and "ready" is one too:
 * saying what is being matched on is the only way a reviewer on a token that
 * cannot see teams finds out that files their team owns are not in the list.
 */
export function ownershipNote(owners: Pick<CodeOwners, 'ownership'>): OwnershipNote {
  const { ownership } = owners;
  switch (ownership.state) {
    case 'off':
      return { available: true, note: null };
    case 'reading':
      return { available: true, note: 'Reading CODEOWNERS…' };
    case 'absent':
      return { available: false, note: 'This repository has no CODEOWNERS file' };
    case 'unreadable':
      return { available: false, note: ownership.reason };
    case 'failed':
      // Offered, because the next press asks again.
      return { available: true, note: `${ownership.reason}. Turn it on again to retry` };
    case 'ready': {
      const login = `@${ownership.identity.login}`;
      if (!ownership.teamsKnown) {
        return {
          available: true,
          note: `Matching ${login} only: the token cannot read team membership`,
        };
      }
      const count = ownership.identity.teams.length;
      const teams = `${count} ${count === 1 ? 'team' : 'teams'}`;
      return {
        available: true,
        note:
          count === 0
            ? `Matching ${login}`
            : ownership.teamsTruncated
              ? `Matching ${login} and ${teams}, from the first ${TEAM_PAGE} GitHub listed`
              : `Matching ${login} and ${teams}`,
      };
    }
  }
}
