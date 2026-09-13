import { describe, expect, it } from 'vitest';
import { fileAnchor, normalizeSelection } from './selection';

describe('normalizeSelection', () => {
  it('converts a single-line selection, omitting the start fields', () => {
    expect(normalizeSelection({ start: 12, end: 12, side: 'additions' })).toEqual({
      ok: true, value: { subject: 'line', line: 12, side: 'RIGHT' },
    });
  });

  it('converts a multi-line selection', () => {
    expect(normalizeSelection({ start: 5, end: 9, side: 'additions' })).toEqual({
      ok: true,
      value: { subject: 'line', line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });
  });

  it('swaps endpoints when the user dragged upward', () => {
    // Pierre preserves drag direction, so start can exceed end.
    expect(normalizeSelection({ start: 9, end: 5, side: 'additions' })).toEqual({
      ok: true,
      value: { subject: 'line', line: 9, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    });
  });

  it('maps the deletions side to LEFT', () => {
    expect(normalizeSelection({ start: 3, end: 3, side: 'deletions' })).toEqual({
      ok: true, value: { subject: 'line', line: 3, side: 'LEFT' },
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
      ok: true, value: { subject: 'line', line: 2, side: 'RIGHT' },
    });
  });
});

describe('normalizeSelection edge cases', () => {
  it('derives a missing side from endSide rather than rejecting', () => {
    // Pierre leaves `side` undefined in single-file mode but still emits
    // `endSide`. Defaulting side to 'additions' would read that as a
    // cross-side drag and reject a perfectly ordinary selection.
    expect(normalizeSelection({ start: 1, end: 4, endSide: 'deletions' })).toEqual({
      ok: true,
      value: { subject: 'line', line: 4, side: 'LEFT', startLine: 1, startSide: 'LEFT' },
    });
  });

  it('rejects a non-integer endpoint', () => {
    expect(normalizeSelection({ start: 1.5, end: 4, side: 'additions' })).toEqual({
      ok: false, reason: 'invalid-range',
    });
  });

  it('rejects NaN, which would otherwise reach GitHub as line: NaN', () => {
    expect(normalizeSelection({ start: Number.NaN, end: 5, side: 'additions' })).toEqual({
      ok: false, reason: 'invalid-range',
    });
  });

  it('rejects a non-positive line number', () => {
    expect(normalizeSelection({ start: 0, end: 3, side: 'additions' })).toEqual({
      ok: false, reason: 'invalid-range',
    });
  });
});

describe('file-level anchors', () => {
  it('is its own subject', () => {
    expect(fileAnchor()).toEqual({ subject: 'file' });
  });

  it('a normalised selection is a line subject', () => {
    const result = normalizeSelection({ start: 3, end: 3, side: 'additions' });
    expect(result.ok && result.value.subject).toBe('line');
  });

  it('a normalised range is a line subject too', () => {
    const result = normalizeSelection({ start: 5, end: 9, side: 'deletions' });
    expect(result.ok && result.value.subject).toBe('line');
  });

  // The two refusals are the other ways out of `normalizeSelection`, and
  // neither of them is a file comment. A selection GitHub cannot express as
  // lines is not thereby a comment about the file: whether the reviewer meant
  // one is a question, and this function is not where it gets asked.
  it('a cross-side refusal yields no anchor at all', () => {
    const result = normalizeSelection({
      start: 1, end: 4, side: 'deletions', endSide: 'additions',
    });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });

  it('an invalid range yields no anchor at all', () => {
    const result = normalizeSelection({ start: Number.NaN, end: 4, side: 'additions' });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });
});
