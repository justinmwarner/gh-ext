/**
 * Reading CODEOWNERS for "Show only files you own".
 *
 * What is pinned is what the reviewer is told, because every way this can go
 * short of a clean answer has to come out as a sentence on the menu row rather
 * than as a filter that quietly matches nothing — or everything.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from './background';
import { ownershipNote, useCodeOwners } from './useCodeOwners';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;
const PR = { owner: 'acme', repo: 'widgets', number: 42 } as const;

/** The worker, answering blobs from `files` and identity from `teams`. */
function worker(
  files: Record<string, string | 'too-large'>,
  teams: { login: string; teams: string[] | null; truncated?: boolean } = {
    login: 'reviewer',
    teams: [],
  },
) {
  requestMock.mockImplementation((msg: { kind: string; path?: string }) => {
    if (msg.kind === 'get-viewer-teams') {
      return Promise.resolve({ ok: true, data: { truncated: false, ...teams } });
    }
    const found = msg.path === undefined ? undefined : files[msg.path];
    if (found === undefined) return Promise.resolve({ ok: true, data: { status: 'absent' } });
    if (found === 'too-large') return Promise.resolve({ ok: true, data: { status: 'too-large' } });
    return Promise.resolve({ ok: true, data: { status: 'ok', text: found } });
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe('reading CODEOWNERS', () => {
  it('asks for nothing until the filter is turned on', () => {
    worker({});
    const { result } = renderHook(() => useCodeOwners(PR, 'base', false));

    expect(result.current.state).toBe('off');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reads the file at the pull request’s base, and answers who owns what', async () => {
    worker({ '.github/CODEOWNERS': '/lib/ @reviewer\n/web/ @someone-else' });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.owned?.('lib/parse.ts')).toBe(true);
    expect(result.current.owned?.('web/app.ts')).toBe(false);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'get-blob', path: '.github/CODEOWNERS', ref: 'base' }),
    );
  });

  it('uses the first file in GitHub’s order, not every file it can find', async () => {
    worker({ CODEOWNERS: '* @reviewer', 'docs/CODEOWNERS': '* @someone-else' });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.owned?.('anything.ts')).toBe(true);
  });

  it('says there is no file, and keeps saying so once the filter is off', async () => {
    worker({});
    const { result, rerender } = renderHook(({ on }) => useCodeOwners(PR, 'base', on), {
      initialProps: { on: true },
    });

    await waitFor(() => expect(result.current.state).toBe('absent'));
    // The shell turns the filter back off on this answer. The row still has to
    // say why, or the box the reviewer just ticked unticks itself in silence.
    rerender({ on: false });
    expect(result.current.state).toBe('absent');
    expect(ownershipNote(result.current)).toEqual({
      available: false,
      note: 'This repository has no CODEOWNERS file',
    });
  });

  it('says a file it cannot read is one it cannot read', async () => {
    worker({ CODEOWNERS: 'too-large' });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('unreadable'));
    expect(ownershipNote(result.current).available).toBe(false);
    expect(ownershipNote(result.current).note).toMatch(/too large/);
  });

  it('matches on the login alone, and says so, when the teams could not be read', async () => {
    worker({ CODEOWNERS: '/api/ @acme/backend\n/lib/ @reviewer' }, { login: 'reviewer', teams: null });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.owned?.('lib/a.ts')).toBe(true);
    expect(result.current.owned?.('api/a.ts')).toBe(false);
    expect(ownershipNote(result.current).note).toBe(
      'Matching @reviewer only: the token cannot read team membership',
    );
  });

  it('says what it is matching on when it has everything', async () => {
    worker({ CODEOWNERS: '* @reviewer' }, { login: 'reviewer', teams: ['@acme/a', '@acme/b'] });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(ownershipNote(result.current)).toEqual({
      available: true,
      note: 'Matching @reviewer and 2 teams',
    });
  });

  it('says how far the team list went when GitHub cut it short', async () => {
    worker({ CODEOWNERS: '* @reviewer' }, { login: 'reviewer', teams: ['@acme/a'], truncated: true });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(ownershipNote(result.current).note).toBe(
      'Matching @reviewer and 1 team, from the first 100 GitHub listed',
    );
  });

  it('turns a failed request into a sentence rather than a filter that matches nothing', async () => {
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'rate-limit', message: 'GitHub’s rate limit was reached.', resetAt: null },
    });
    const { result } = renderHook(() => useCodeOwners(PR, 'base', true));

    await waitFor(() => expect(result.current.state).toBe('failed'));
    // Still offered: this is an answer about this minute, not about the repository.
    expect(ownershipNote(result.current).available).toBe(true);
    expect(ownershipNote(result.current).note).toContain('GitHub’s rate limit was reached.');
  });

  it('asks again after a failure, the next time the filter is turned on', async () => {
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'The network went away.', resetAt: null },
    });
    const { result, rerender } = renderHook(({ on }) => useCodeOwners(PR, 'base', on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.state).toBe('failed'));

    worker({ CODEOWNERS: '* @reviewer' });
    rerender({ on: false });
    rerender({ on: true });

    await waitFor(() => expect(result.current.state).toBe('ready'));
  });

  it('does not ask again for an answer that will be the same next time', async () => {
    worker({});
    const { result, rerender } = renderHook(({ on }) => useCodeOwners(PR, 'base', on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.state).toBe('absent'));
    const asked = requestMock.mock.calls.length;

    rerender({ on: false });
    rerender({ on: true });

    expect(requestMock.mock.calls.length).toBe(asked);
  });
});
