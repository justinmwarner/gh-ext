import { describe, expect, it } from 'vitest';
import { DraftStore, type KeyValueStore, draftKey } from './drafts';

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => { map.set(k, v); },
    remove: async (k) => { map.delete(k); },
    keys: async () => [...map.keys()],
  };
}

const loc = { prId: 'PR_1', path: 'src/a.ts', line: 10, side: 'RIGHT' as const };

describe('draftKey', () => {
  it('is stable and includes every locating field', () => {
    expect(draftKey(loc)).toBe('draft:PR_1:src/a.ts:10:RIGHT');
  });

  it('distinguishes sides on the same line', () => {
    expect(draftKey(loc)).not.toBe(draftKey({ ...loc, side: 'LEFT' }));
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
