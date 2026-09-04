/**
 * Getting both sides of one file to a rich comparison.
 *
 * Two properties are asserted here and neither is cosmetic. Nothing on this
 * page may call `fetch`, so every read is a message to the worker — and a side
 * that does not exist, or is too large, or cannot be decoded, has to come back
 * as a sentence rather than as an empty view that reads as "nothing changed".
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Response as ProtocolResponse } from '@/lib/messages';
import * as background from './background';
import { clearSideCache, useImageSides, useTextSides } from './fileSides';

const REFS = {
  pr: { owner: 'acme', repo: 'widgets', number: 42 },
  baseSha: 'a'.repeat(40),
  headSha: 'f'.repeat(40),
};

const ok = (data: unknown): ProtocolResponse =>
  ({ ok: true, data }) as unknown as ProtocolResponse;

let requests: { kind: string; ref: string; path: string }[] = [];

function answer(reply: (ref: string, path: string) => unknown): void {
  vi.spyOn(background, 'request').mockImplementation(((message: {
    kind: string;
    ref: string;
    path: string;
  }) => {
    requests.push({ kind: message.kind, ref: message.ref, path: message.path });
    return Promise.resolve(ok(reply(message.ref, message.path)));
  }) as typeof background.request);
}

beforeEach(() => {
  requests = [];
  clearSideCache();
  // jsdom implements neither, and the image loader is built on both.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTextSides', () => {
  it('reads the old path at the base commit and the new path at the head', async () => {
    // A rename has two different names, and asking for the head name at the
    // base commit is a 404 on every renamed file — a true sentence about the
    // wrong question.
    answer(() => ({ status: 'ok', text: 'contents' }));

    const { result } = renderHook(() =>
      useTextSides({
        refs: REFS,
        path: 'new/name.csv',
        oldPath: 'old/name.csv',
        sides: 'both',
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(requests).toEqual([
      { kind: 'get-blob', ref: REFS.baseSha, path: 'old/name.csv' },
      { kind: 'get-blob', ref: REFS.headSha, path: 'new/name.csv' },
    ]);
  });

  it('asks for one side only when the file was added', async () => {
    answer(() => ({ status: 'ok', text: 'contents' }));

    const { result } = renderHook(() =>
      useTextSides({
        refs: REFS,
        path: 'fresh.csv',
        oldPath: 'fresh.csv',
        sides: 'added',
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(requests).toHaveLength(1);
    expect(result.current.before).toBeNull();
    expect(result.current.after).toBe('contents');
  });

  it('fetches nothing at all until it is enabled', () => {
    answer(() => ({ status: 'ok', text: 'contents' }));

    const { result } = renderHook(() =>
      useTextSides({
        refs: REFS,
        path: 'a.csv',
        oldPath: 'a.csv',
        sides: 'both',
        enabled: false,
      }),
    );

    expect(requests).toEqual([]);
    expect(result.current.status).toBe('idle');
  });

  it('turns a side the worker declined into one sentence', async () => {
    answer((ref) => (ref === REFS.baseSha ? { status: 'too-large' } : { status: 'ok', text: 'x' }));

    const { result } = renderHook(() =>
      useTextSides({
        refs: REFS,
        path: 'huge.csv',
        oldPath: 'huge.csv',
        sides: 'both',
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.reason).toMatch(/too large/i);
  });

  it('reads a worker failure as a failure rather than as an empty file', async () => {
    vi.spyOn(background, 'request').mockResolvedValue({
      ok: false,
      error: { kind: 'rate-limit', message: 'GitHub rate limit exceeded', resetAt: null },
    } as ProtocolResponse);

    const { result } = renderHook(() =>
      useTextSides({
        refs: REFS,
        path: 'a.csv',
        oldPath: 'a.csv',
        sides: 'both',
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.reason).toMatch(/rate limit/i);
  });

  it('asks the worker once for a side two cards want', async () => {
    // Virtualization recycles a card whenever it scrolls out of the window, so
    // a reviewer scrolling back up remounts it. Without a cache that is another
    // multi-megabyte trip through the message channel per remount.
    answer(() => ({ status: 'ok', text: 'contents' }));

    const request = {
      refs: REFS,
      path: 'a.csv',
      oldPath: 'a.csv',
      sides: 'added' as const,
      enabled: true,
    };
    const first = renderHook(() => useTextSides(request));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();

    const second = renderHook(() => useTextSides(request));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(requests).toHaveLength(1);
  });
});

describe('useImageSides', () => {
  it('turns worker bytes into an object URL rather than a remote one', async () => {
    // The whole point: an <img> on this page must never be given a URL that
    // reaches the network. `btoa` of the three bytes below.
    answer(() => ({ status: 'ok', base64: btoa('\x00\x01\x02'), byteLength: 3 }));

    const { result } = renderHook(() =>
      useImageSides({
        refs: REFS,
        path: 'a.png',
        oldPath: 'a.png',
        sides: 'added',
        enabled: true,
        mediaType: 'image/png',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.after?.url.startsWith('blob:')).toBe(true);
    expect(result.current.after?.byteLength).toBe(3);
  });

  it('says so when the image is past the byte cap', async () => {
    answer(() => ({ status: 'too-large', byteLength: 9_000_000 }));

    const { result } = renderHook(() =>
      useImageSides({
        refs: REFS,
        path: 'a.png',
        oldPath: 'a.png',
        sides: 'added',
        enabled: true,
        mediaType: 'image/png',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.reason).toMatch(/too large/i);
  });
});
