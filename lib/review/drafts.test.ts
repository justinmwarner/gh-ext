import { describe, expect, it } from 'vitest';
import { DraftStore, type DraftLocation, type KeyValueStore, draftKey } from './drafts';
import { fileAnchor } from './selection';

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => { map.set(k, v); },
    remove: async (k) => { map.delete(k); },
    keys: async () => [...map.keys()],
  };
}

const loc: DraftLocation = {
  prId: 'PR_1',
  path: 'src/a.ts',
  anchor: { subject: 'line', line: 10, side: 'RIGHT' },
};

const onTheFile: DraftLocation = { prId: 'PR_1', path: 'src/a.ts', anchor: fileAnchor() };

describe('draftKey', () => {
  it('is stable and includes every locating field', () => {
    // Unchanged from the format that shipped, and asserted as a literal rather
    // than as a shape. A reviewer who updates the extension mid-sentence has a
    // draft in storage under this exact string.
    expect(draftKey(loc)).toBe('draft:PR_1:src/a.ts:10:RIGHT');
  });

  it('distinguishes sides on the same line', () => {
    expect(
      draftKey({ ...loc, anchor: { subject: 'line', line: 10, side: 'LEFT' } }),
    ).not.toBe(draftKey(loc));
  });

  it('keeps a comment about the file clear of every line draft', () => {
    // The last segment of a line key is a `DiffSide`, so `file` is a suffix no
    // line draft can produce — including on a path that already ends in one,
    // which is the only way the two families could otherwise meet.
    expect(draftKey(onTheFile)).toBe('draft:PR_1:src/a.ts:file');
    expect(draftKey(onTheFile)).not.toBe(draftKey(loc));
    expect(
      draftKey({ ...onTheFile, path: 'src/a.ts:10:RIGHT' }),
    ).not.toBe(draftKey(loc));
  });
});

describe('DraftStore', () => {
  it('round-trips a draft', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'work in progress');
    expect(await s.load(loc)).toBe('work in progress');
  });

  it('returns null for an absent draft', async () => {
    expect(await new DraftStore(memoryStore()).load(loc)).toBeNull();
  });

  it('clears a draft', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'text');
    await s.clear(loc);
    expect(await s.load(loc)).toBeNull();
  });

  it('treats an empty body as a clear, so blank drafts do not accumulate', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'text');
    await s.save(loc, '   ');
    expect(await s.load(loc)).toBeNull();
  });

  it('lists only drafts for the requested pull request', async () => {
    const s = new DraftStore(memoryStore());
    await s.save(loc, 'a');
    await s.save({ ...loc, prId: 'PR_2' }, 'b');
    expect(await s.listFor('PR_1')).toHaveLength(1);
  });
});
