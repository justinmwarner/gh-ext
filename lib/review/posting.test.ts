import { describe, expect, it } from 'vitest';
import {
  type PostingComment,
  beginPost,
  dropPost,
  failPost,
  nextPostId,
  postsOnPath,
  retryPost,
} from './posting';

const INPUT = {
  path: 'src/app.ts',
  body: 'This allocates once per row.',
  anchor: { line: 12, side: 'RIGHT' as const },
};

const one = (): readonly PostingComment[] => beginPost([], 'p1', INPUT);

describe('nextPostId', () => {
  it('never repeats, so two identical comments stay two entries', () => {
    // A reviewer who gives up waiting and posts the same line again has made
    // two comments, not one. Deriving the id from the content would merge them.
    expect(nextPostId()).not.toBe(nextPostId());
  });
});

describe('beginPost', () => {
  it('keeps the comment and marks it in flight', () => {
    expect(one()).toEqual([{ ...INPUT, id: 'p1', error: null }]);
  });

  it('appends, so the order they were written is the order they are shown', () => {
    const two = beginPost(one(), 'p2', { ...INPUT, body: 'second' });
    expect(two.map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });
});

describe('failPost', () => {
  it('records the reason and keeps the words', () => {
    // The entry is now the only copy of the comment on screen. Dropping it
    // here is the one unrecoverable mistake this module can make.
    const [entry] = failPost(one(), 'p1', 'GitHub said no');
    expect(entry?.body).toBe(INPUT.body);
    expect(entry?.error).toBe('GitHub said no');
  });

  it('returns the same array for an entry that is no longer there', () => {
    // Identity, not just contents: this array is Pierre annotation input, and
    // a fresh one for an unchanged file re-renders the whole card.
    const list = one();
    expect(failPost(list, 'gone', 'GitHub said no')).toBe(list);
  });
});

describe('retryPost', () => {
  it('clears the reason so the card stops describing the previous attempt', () => {
    const failed = failPost(one(), 'p1', 'GitHub said no');
    expect(retryPost(failed, 'p1')[0]?.error).toBeNull();
  });

  it('leaves an entry that is already in flight exactly as it is', () => {
    const list = one();
    expect(retryPost(list, 'p1')).toBe(list);
  });
});

describe('dropPost', () => {
  it('removes the entry the real thread replaced', () => {
    expect(dropPost(one(), 'p1')).toEqual([]);
  });

  it('returns the same array when there was nothing to drop', () => {
    const list = one();
    expect(dropPost(list, 'gone')).toBe(list);
  });
});

describe('postsOnPath', () => {
  it('gathers the entries one card has to draw', () => {
    const list = beginPost(one(), 'p2', { ...INPUT, path: 'src/other.ts' });
    expect(postsOnPath(list, 'src/app.ts').map((entry) => entry.id)).toEqual(['p1']);
    expect(postsOnPath(list, 'nothing/here.ts')).toEqual([]);
  });
});
