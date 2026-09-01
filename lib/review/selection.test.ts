import { describe, expect, it } from 'vitest';
import { normalizeSelection } from './selection';

describe('normalizeSelection', () => {
  it('converts a single-line selection, omitting the start fields', () => {
    expect(normalizeSelection({ start: 12, end: 12, side: 'additions' })).toEqual({
      ok: true, value: { line: 12, side: 'RIGHT' },
    });
  });

  it('converts a multi-line selection', () => {
    expect(normalizeSelection({ start: 5, end: 9, side: 'additions' })).toEqual({
      ok: true, value: { line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });
  });

  it('swaps endpoints when the user dragged upward', () => {
    // Pierre preserves drag direction, so start can exceed end.
    expect(normalizeSelection({ start: 9, end: 5, side: 'additions' })).toEqual({
      ok: true, value: { line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });
  });

  it('maps the deletions side to LEFT', () => {
    expect(normalizeSelection({ start: 3, end: 3, side: 'deletions' })).toEqual({
      ok: true, value: { line: 3, side: 'LEFT' },
    });
  });

  it('treats an omitted endSide as equal to side', () => {
    const r = normalizeSelection({ start: 1, end: 4, side: 'additions', endSide: undefined });
    expect(r.ok).toBe(true);
  });

  it('rejects a cross-side range, which GitHub cannot represent', () => {
    const r = normalizeSelection({
      start: 1, end: 4, side: 'deletions', endSide: 'additions',
    });
    expect(r).toEqual({ ok: false, reason: 'cross-side' });
  });

  it('defaults a missing side to additions', () => {
    expect(normalizeSelection({ start: 2, end: 2 })).toEqual({
      ok: true, value: { line: 2, side: 'RIGHT' },
    });
  });
});
