import { describe, expect, it } from 'vitest';
import type { ReviewThread } from '../github/types';
import { anchorThread, isMultiLine, partitionThreads } from './threads';

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 't1', isResolved: false, isOutdated: false,
    path: 'src/a.ts', line: 10, startLine: 10,
    originalLine: 10, originalStartLine: null,
    diffSide: 'RIGHT', startDiffSide: null, subjectType: 'LINE',
    viewerCanReply: true, viewerCanResolve: true, viewerCanUnresolve: true,
    comments: { totalCount: 0, nodes: [] }, ...over,
  };
}

describe('anchorThread', () => {
  it('anchors a RIGHT-side thread to the additions side', () => {
    expect(anchorThread(thread())).toEqual({
      kind: 'anchored', side: 'additions', lineNumber: 10,
    });
  });

  it('anchors a LEFT-side thread to the deletions side', () => {
    expect(anchorThread(thread({ diffSide: 'LEFT' }))).toEqual({
      kind: 'anchored', side: 'deletions', lineNumber: 10,
    });
  });

  it('anchors a multi-line thread to its END line', () => {
    // Pierre cannot express ranges, so the end line is the anchor.
    const t = thread({ startLine: 5, line: 9, startDiffSide: 'RIGHT' });
    expect(anchorThread(t)).toEqual({
      kind: 'anchored', side: 'additions', lineNumber: 9,
    });
  });

  it('refuses to anchor an outdated thread, whose line is null', () => {
    const t = thread({ isOutdated: true, line: null, startLine: null, originalLine: 194 });
    expect(anchorThread(t)).toEqual({ kind: 'unanchorable', reason: 'outdated' });
  });

  it('refuses to anchor a file-level thread', () => {
    expect(anchorThread(thread({ subjectType: 'FILE' }))).toEqual({
      kind: 'unanchorable', reason: 'file-level',
    });
  });

  it('refuses to anchor a null line even when not flagged outdated', () => {
    expect(anchorThread(thread({ line: null }))).toEqual({
      kind: 'unanchorable', reason: 'no-line',
    });
  });
});

describe('isMultiLine', () => {
  it('is false when startLine equals line', () => {
    // The trap: startLine is NOT null for single-line threads.
    expect(isMultiLine(thread({ startLine: 10, line: 10 }))).toBe(false);
  });

  it('is true when startLine differs from line', () => {
    expect(isMultiLine(thread({ startLine: 5, line: 9 }))).toBe(true);
  });

  it('is false when either endpoint is null', () => {
    expect(isMultiLine(thread({ startLine: null, line: null }))).toBe(false);
  });
});

describe('partitionThreads', () => {
  it('separates anchorable threads from those that must be listed instead', () => {
    const anchorable = thread({ id: 'a' });
    const outdated = thread({ id: 'b', isOutdated: true, line: null, startLine: null });
    const fileLevel = thread({ id: 'c', subjectType: 'FILE' });

    const result = partitionThreads([anchorable, outdated, fileLevel]);

    expect(result.anchored).toHaveLength(1);
    expect(result.anchored[0]?.thread.id).toBe('a');
    expect(result.anchored[0]?.anchor).toEqual({
      kind: 'anchored', side: 'additions', lineNumber: 10,
    });
    expect(result.unanchorable.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('returns empty groups for no threads', () => {
    expect(partitionThreads([])).toEqual({ anchored: [], unanchorable: [] });
  });
});
