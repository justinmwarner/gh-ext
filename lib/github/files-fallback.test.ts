import { describe, expect, it } from 'vitest';
import { fetchFilesFallback } from './files-fallback';

interface RestFilePayload {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | null;
  previous_filename?: string;
}

function recordingFetch(respond: (index: number) => Response) {
  const urls: string[] = [];
  const impl: typeof fetch = async (input) => {
    urls.push(typeof input === 'string' ? input : input.toString());
    return respond(urls.length - 1);
  };
  return { impl, urls };
}

function jsonPage(files: RestFilePayload[]): Response {
  return new Response(JSON.stringify(files), { status: 200 });
}

function restFile(filename: string, extra: Partial<RestFilePayload> = {}): RestFilePayload {
  return {
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1 +1 @@\n-a\n+b',
    ...extra,
  };
}

function manyFiles(count: number, offset = 0): RestFilePayload[] {
  return Array.from({ length: count }, (_, i) => restFile(`src/file-${offset + i}.ts`));
}

describe('fetchFilesFallback pagination', () => {
  it('requests 100 per page and stops on a short page', async () => {
    const fake = recordingFetch((i) => jsonPage(i === 0 ? manyFiles(100) : manyFiles(3, 100)));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(fake.urls).toHaveLength(2);
    expect(fake.urls[0]).toBe(
      'https://api.github.com/repos/octo/repo/pulls/7/files?per_page=100&page=1',
    );
    expect(fake.urls[1]).toBe(
      'https://api.github.com/repos/octo/repo/pulls/7/files?per_page=100&page=2',
    );
    expect(result.files).toHaveLength(103);
    expect(result.truncated).toBe(false);
  });

  it('makes a single request when the first page is already short', async () => {
    const fake = recordingFetch(() => jsonPage(manyFiles(4)));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(fake.urls).toHaveLength(1);
    expect(result.files).toHaveLength(4);
    expect(result.truncated).toBe(false);
  });

  it('stops at GitHub 3000-file cap and reports truncated', async () => {
    // Every page is full, so only the cap can end the loop. If it does not,
    // this test hangs rather than passing quietly.
    const fake = recordingFetch((i) => jsonPage(manyFiles(100, i * 100)));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files).toHaveLength(3000);
    expect(result.truncated).toBe(true);
    expect(fake.urls).toHaveLength(30);
  });

  it('rejects rather than returning an empty file list when a page fails', async () => {
    const fake = recordingFetch(() => new Response('nope', { status: 500 }));

    await expect(fetchFilesFallback('octo', 'repo', 7, fake.impl)).rejects.toThrow('500');
  });
});

describe('fetchFilesFallback file mapping', () => {
  it('keeps files whose patch GitHub omitted, flagged rather than dropped', async () => {
    // GitHub omits `patch` on very large files. Dropping them is a file the
    // reviewer never sees, with nothing on screen to say so.
    const fake = recordingFetch(() =>
      jsonPage([
        restFile('src/small.ts'),
        restFile('src/huge.ts', { patch: undefined, additions: 40000, changes: 40000 }),
      ]),
    );

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({ path: 'src/small.ts', patchOmitted: false });
    expect(result.files[0]?.patch).toContain('@@ -1 +1 @@');
    expect(result.files[1]).toMatchObject({
      path: 'src/huge.ts',
      patchOmitted: true,
      patch: '',
    });
  });

  it('treats a null patch as omitted rather than as an empty diff', async () => {
    // JSON.stringify drops an undefined key, so the test above covers the
    // absent-key case. An explicit null must not render as a file with no
    // changes.
    const fake = recordingFetch(() => jsonPage([restFile('src/huge.ts', { patch: null })]));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files[0]).toMatchObject({ path: 'src/huge.ts', patchOmitted: true, patch: '' });
  });

  it.each([
    ['added', 'ADDED'],
    ['removed', 'DELETED'],
    ['modified', 'MODIFIED'],
    ['renamed', 'RENAMED'],
    ['copied', 'COPIED'],
    ['changed', 'CHANGED'],
  ])('maps REST status %s onto changeType %s', async (status, changeType) => {
    const fake = recordingFetch(() => jsonPage([restFile('src/a.ts', { status })]));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files[0]).toMatchObject({ path: 'src/a.ts', changeType });
  });

  it('reports both paths for a rename', async () => {
    const fake = recordingFetch(() =>
      jsonPage([
        restFile('src/new.ts', { status: 'renamed', previous_filename: 'src/old.ts' }),
      ]),
    );

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files[0]).toMatchObject({
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
      isRename: true,
      changeType: 'RENAMED',
    });
  });

  it('uses the same path for both sides when there is no rename', async () => {
    const fake = recordingFetch(() => jsonPage([restFile('src/a.ts')]));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files[0]).toMatchObject({
      path: 'src/a.ts',
      oldPath: 'src/a.ts',
      isRename: false,
      isBinary: false,
    });
  });

  it('falls back to MODIFIED for a status it does not know', async () => {
    const fake = recordingFetch(() => jsonPage([restFile('src/a.ts', { status: 'unchanged' })]));

    const result = await fetchFilesFallback('octo', 'repo', 7, fake.impl);

    expect(result.files[0]).toMatchObject({ changeType: 'MODIFIED' });
  });
});
