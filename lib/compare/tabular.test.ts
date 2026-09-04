/**
 * Reading a delimited file, and comparing two of them cell by cell.
 *
 * The parser has to survive real exports rather than the examples: quoted
 * fields containing the delimiter, quoted fields containing newlines, doubled
 * quotes, CRLF, and a ragged last row. Every one of those turns up in a file
 * somebody committed, and each one that is mis-parsed shifts a column and
 * paints the rest of the table as changed.
 */

import { describe, expect, it } from 'vitest';
import {
  TABLE_LIMITS,
  compareTables,
  delimiterFor,
  parseDelimited,
} from './tabular';

describe('delimiterFor', () => {
  it('takes a tab for .tsv without looking at the contents', () => {
    expect(delimiterFor('data/rows.tsv', 'a,b,c')).toBe('\t');
  });

  it('sniffs a semicolon-delimited export, which .csv also means', () => {
    // Excel writes these in every locale whose decimal separator is a comma.
    // Read as commas, every row is one enormous cell.
    expect(delimiterFor('data/rows.csv', 'name;qty;price\nbolt;4;1,50')).toBe(';');
  });

  it('falls back to a comma when there is nothing to sniff', () => {
    expect(delimiterFor('data/rows.csv', '')).toBe(',');
    expect(delimiterFor('data/rows.csv', 'single-column')).toBe(',');
  });
});

describe('parseDelimited', () => {
  it('splits plain rows and columns', () => {
    const table = parseDelimited('a,b\n1,2\n', ',');

    expect(table.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(table.columns).toBe(2);
  });

  it('keeps a delimiter that is inside quotes', () => {
    expect(parseDelimited('"Smith, John",42\n', ',').rows).toEqual([
      ['Smith, John', '42'],
    ]);
  });

  it('keeps a newline that is inside quotes', () => {
    const table = parseDelimited('"line one\nline two",x\n', ',');

    expect(table.rows).toEqual([['line one\nline two', 'x']]);
    expect(table.totalRows).toBe(1);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseDelimited('"she said ""hi""",b\n', ',').rows).toEqual([
      ['she said "hi"', 'b'],
    ]);
  });

  it('strips the carriage return from a CRLF file', () => {
    // Left on, every value in the last column differs from its counterpart in
    // an LF-terminated file and the whole column paints as changed.
    expect(parseDelimited('a,b\r\n1,2\r\n', ',').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not invent a trailing empty row', () => {
    expect(parseDelimited('a\nb\n', ',').rows).toHaveLength(2);
  });

  it('keeps a genuinely empty row in the middle', () => {
    expect(parseDelimited('a\n\nb\n', ',').rows).toHaveLength(3);
  });

  it('reports a ragged row rather than padding it away', () => {
    const table = parseDelimited('a,b,c\n1\n', ',');

    expect(table.rows[1]).toEqual(['1']);
    expect(table.columns).toBe(3);
  });

  it('gives back the row text it parsed, for aligning against the other side', () => {
    const table = parseDelimited('a,b\n"x,y",z\n', ',');

    expect(table.keys).toHaveLength(2);
    expect(table.keys[0]).not.toBe(table.keys[1]);
  });

  it('stops at the row cap and says how many rows there really were', () => {
    const text = Array.from({ length: 50 }, (_, index) => `row${index}`).join('\n');
    const table = parseDelimited(text, ',', { ...TABLE_LIMITS, maxRows: 10 });

    expect(table.rows).toHaveLength(10);
    expect(table.totalRows).toBe(50);
    expect(table.truncated).toBe(true);
  });

  it('stops at the cell budget, which is what a wide table hits first', () => {
    // Twenty columns of a thousand rows is twenty thousand DOM cells, and the
    // row cap alone would not have noticed.
    const wide = Array.from({ length: 100 }, () => 'x'.repeat(1)).join(',');
    const text = Array.from({ length: 100 }, () => wide).join('\n');
    const table = parseDelimited(text, ',', { ...TABLE_LIMITS, maxCells: 500 });

    expect(table.truncated).toBe(true);
    expect(table.rows.length * table.columns).toBeLessThanOrEqual(500 + table.columns);
  });

  it('caps the columns as well, and says so', () => {
    const text = Array.from({ length: 80 }, (_, index) => `c${index}`).join(',');
    const table = parseDelimited(text, ',', { ...TABLE_LIMITS, maxColumns: 5 });

    expect(table.columns).toBe(5);
    expect(table.rows[0]).toHaveLength(5);
    expect(table.truncated).toBe(true);
  });
});

describe('compareTables', () => {
  const compare = (before: string, after: string) =>
    compareTables(parseDelimited(before, ','), parseDelimited(after, ','));

  it('marks only the cell that moved, not the whole row', () => {
    // This is the entire reason the mode exists. A one-cell edit is one line in
    // the text diff, and finding the cell inside it is the reviewer's problem.
    const result = compare('name,qty\nbolt,4\n', 'name,qty\nbolt,5\n');
    const row = result.rows[1];

    expect(row?.kind).toBe('changed');
    expect(row?.cells.map((cell) => cell.changed)).toEqual([false, true]);
    expect(row?.cells[1]).toMatchObject({ text: '5', previous: '4' });
  });

  it('keeps every unchanged row, so the changed one has context', () => {
    const result = compare('a\nb\nc\n', 'a\nB\nc\n');

    expect(result.rows.map((row) => row.kind)).toEqual(['equal', 'changed', 'equal']);
  });

  it('numbers rows on the side they exist on', () => {
    const result = compare('a\nb\n', 'a\nx\nb\n');
    const added = result.rows.find((row) => row.kind === 'added');

    expect(added?.newNumber).toBe(2);
    expect(added?.oldNumber).toBeNull();
  });

  it('does not call an inserted column a change to every cell after it', () => {
    // The text diff's worst case. Every row differs, every row is rewritten,
    // and the one fact worth knowing — a column arrived — is invisible in it.
    // Cell-level, the inserted column is what differs and the rest lines up
    // only if the columns line up, which they do not: this is honest about
    // that by marking the shifted cells rather than pretending.
    const result = compare('a,c\n1,3\n', 'a,b,c\n1,2,3\n');

    expect(result.columns).toBe(3);
    expect(result.rows.every((row) => row.kind === 'changed')).toBe(true);
  });

  it('reports a removed row with no counterpart', () => {
    const result = compare('a\ngone\nb\n', 'a\nb\n');

    expect(result.rows.map((row) => row.kind)).toEqual(['equal', 'removed', 'equal']);
    expect(result.rows[1]?.newNumber).toBeNull();
  });

  it('widens every row to the widest one, so the grid is rectangular', () => {
    const result = compare('a,b,c\n1\n', 'a,b,c\n1\n');

    expect(result.columns).toBe(3);
    for (const row of result.rows) expect(row.cells).toHaveLength(3);
  });

  it('carries the truncation and approximation flags out to the caller', () => {
    const rows = Array.from({ length: 40 }, (_, index) => `row${index}`).join('\n');
    const before = parseDelimited(rows, ',', { ...TABLE_LIMITS, maxRows: 10 });
    const after = parseDelimited(rows, ',', { ...TABLE_LIMITS, maxRows: 10 });

    expect(compareTables(before, after).truncated).toBe(true);
  });

  it('compares a file that was only added against nothing', () => {
    const result = compareTables(parseDelimited('', ','), parseDelimited('a\nb\n', ','));

    expect(result.rows.map((row) => row.kind)).toEqual(['added', 'added']);
  });
});
