/**
 * The loader that makes expansion possible.
 *
 * Every case here is a real state of a real pull request rather than a defect:
 * a rename whose base side lives under a different name, a pure rename that
 * has no base side at all, and three ways a blob cannot be turned into text.
 */

import type { FileDiffMetadata } from '@pierre/diffs';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiffFilesLoader } from './blobLoader';
import { request } from './background';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

const PR = { owner: 'acme', repo: 'widgets', number: 42 } as const;
const BASE = 'a'.repeat(40);
const HEAD = 'f'.repeat(40);
const REFS = { pr: PR, baseSha: BASE, headSha: HEAD };

const metadata = (overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata => ({
  name: 'src/app.ts',
  type: 'change',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: [],
  additionLines: [],
  ...overrides,
});

/** Answer every blob request with its own ref, so both sides are identifiable. */
const serve = (text: (ref: string, path: string) => string) => {
  requestMock.mockImplementation((msg: { kind: string; ref: string; path: string }) =>
    Promise.resolve({ ok: true, data: { status: 'ok', text: text(msg.ref, msg.path) } }),
  );
};

const asked = (): { path: string; ref: string }[] =>
  (requestMock.mock.calls as { path: string; ref: string }[][]).map((call) => ({
    path: call[0]?.path ?? '',
    ref: call[0]?.ref ?? '',
  }));

beforeEach(() => {
  requestMock.mockReset();
});

describe('createDiffFilesLoader', () => {
  it('reads both sides, each at its own commit', async () => {
    serve((ref) => (ref === BASE ? 'old text' : 'new text'));

    const loaded = await createDiffFilesLoader(REFS)(metadata());

    expect(loaded.oldFile?.contents).toBe('old text');
    expect(loaded.newFile.contents).toBe('new text');
    expect(asked()).toEqual([
      { path: 'src/app.ts', ref: BASE },
      { path: 'src/app.ts', ref: HEAD },
    ]);
  });

  it('reads a renamed file under the name its base commit knows', async () => {
    // The head path does not exist at the base commit. Asking for it would get
    // an honest "no such file" about entirely the wrong question.
    serve((_ref, path) => path);

    const loaded = await createDiffFilesLoader(REFS)(
      metadata({ type: 'rename-changed', name: 'src/new.ts', prevName: 'src/old.ts' }),
    );

    expect(loaded.oldFile?.contents).toBe('src/old.ts');
    expect(loaded.newFile.contents).toBe('src/new.ts');
  });

  it('gives a pure rename a null base side, which is what Pierre requires', async () => {
    serve(() => 'unchanged');

    const loaded = await createDiffFilesLoader(REFS)(
      metadata({ type: 'rename-pure', name: 'src/new.ts', prevName: 'src/old.ts' }),
    );

    // Not the same contents twice: `hydratePartialDiff` throws for a
    // rename-pure that arrives with an oldFile.
    expect(loaded.oldFile).toBeNull();
    expect(loaded.newFile.contents).toBe('unchanged');
    expect(asked()).toEqual([{ path: 'src/new.ts', ref: HEAD }]);
  });

  it('keys the contents on the commit, so highlighting is not recomputed', async () => {
    serve(() => 'text');

    const loaded = await createDiffFilesLoader(REFS)(metadata());

    expect(loaded.newFile.cacheKey).toContain(HEAD);
    expect(loaded.oldFile?.cacheKey).toContain(BASE);
  });

  it('asks for each blob once however many files want it', async () => {
    serve(() => 'text');
    const loader = createDiffFilesLoader(REFS);

    await loader(metadata());
    await loader(metadata());

    // A blob at a commit is immutable, so the second expansion is free.
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['absent', /does not exist at that commit/i],
    ['too-large', /too large to load in full/i],
    ['binary', /not text/i],
  ])('explains a %s side rather than expanding to nothing', async (status, wording) => {
    requestMock.mockResolvedValue({ ok: true, data: { status } });
    const failures: string[] = [];

    await expect(
      createDiffFilesLoader(REFS, (_path, reason) => failures.push(reason))(metadata()),
    ).rejects.toThrow(wording);

    // Reported to the caller as well as thrown: Pierre swallows the rejection
    // and leaves the hunk shut, so the throw alone reaches nobody.
    expect(failures[0]).toMatch(wording);
  });

  it('reports a worker failure in the words the worker used', async () => {
    requestMock.mockResolvedValue({
      ok: false,
      error: { kind: 'rate-limit', message: 'GitHub rate limit exceeded', resetAt: null },
    });
    const failures: string[] = [];

    await expect(
      createDiffFilesLoader(REFS, (_path, reason) => failures.push(reason))(metadata()),
    ).rejects.toThrow(/rate limit/i);
    expect(failures[0]).toMatch(/src\/app\.ts/);
  });

  it('lets a failed expansion be retried', async () => {
    requestMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unknown', message: 'network', resetAt: null },
    });
    requestMock.mockResolvedValue({ ok: true, data: { status: 'ok', text: 'text' } });
    const loader = createDiffFilesLoader(REFS);

    await expect(loader(metadata())).rejects.toThrow();
    // A cached rejection would make the expander permanently dead after one
    // dropped request.
    await expect(loader(metadata())).resolves.toBeDefined();
  });
});
