/**
 * Comparing two Jupyter notebooks cell by cell.
 *
 * The failure this replaces is specific and universal: a notebook's outputs are
 * base64 images and execution counters, they are rewritten every time the
 * notebook is run, and they are ninety-nine per cent of the text diff. The one
 * line of Python that changed is somewhere underneath a megabyte of PNG.
 */

import { describe, expect, it } from 'vitest';
import { NOTEBOOK_LIMITS, compareNotebooks, parseNotebook } from './notebook';

const notebook = (cells: unknown[]): string =>
  JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells });

const code = (source: string, outputs: unknown[] = [], count: number | null = 1) => ({
  cell_type: 'code',
  execution_count: count,
  metadata: {},
  source,
  outputs,
});

describe('parseNotebook', () => {
  it('joins a source that arrives as a list of lines', () => {
    // The format stores source as an array of lines with their newlines still
    // attached, and a great many notebooks in the wild use it.
    const parsed = parseNotebook(
      notebook([{ cell_type: 'code', source: ['import os\n', 'print(os)\n'], outputs: [] }]),
    );

    expect(parsed.cells[0]?.source).toBe('import os\nprint(os)\n');
  });

  it('accepts a source that arrives as one string', () => {
    expect(parseNotebook(notebook([code('x = 1')])).cells[0]?.source).toBe('x = 1');
  });

  it('reads a stream output as its text', () => {
    const parsed = parseNotebook(
      notebook([code('print(1)', [{ output_type: 'stream', name: 'stdout', text: ['1\n'] }])]),
    );

    expect(parsed.cells[0]?.outputs[0]).toMatchObject({ kind: 'text', text: '1\n' });
  });

  it('keeps an image output as data rather than as its base64', () => {
    const parsed = parseNotebook(
      notebook([
        code('plot()', [
          {
            output_type: 'display_data',
            data: { 'image/png': 'AAAA', 'text/plain': '<Figure>' },
            metadata: {},
          },
        ]),
      ]),
    );

    expect(parsed.cells[0]?.outputs[0]).toMatchObject({
      kind: 'image',
      image: { mediaType: 'image/png', base64: 'AAAA' },
    });
  });

  it('reads an error output as its name, value and traceback', () => {
    const parsed = parseNotebook(
      notebook([
        code('1/0', [
          {
            output_type: 'error',
            ename: 'ZeroDivisionError',
            evalue: 'division by zero',
            traceback: ['Traceback', '  line 1'],
          },
        ]),
      ]),
    );

    expect(parsed.cells[0]?.outputs[0]?.kind).toBe('error');
    expect(parsed.cells[0]?.outputs[0]?.text).toContain('ZeroDivisionError');
  });

  it('refuses a file that is not a notebook rather than showing an empty one', () => {
    expect(parseNotebook('{"a":1}').status).toBe('unreadable');
    expect(parseNotebook('not json').status).toBe('unreadable');
  });

  it('stops at the cell cap and says so', () => {
    const many = Array.from({ length: 20 }, (_, index) => code(`cell ${index}`));
    const parsed = parseNotebook(notebook(many), { ...NOTEBOOK_LIMITS, maxCells: 5 });

    expect(parsed.cells).toHaveLength(5);
    expect(parsed.totalCells).toBe(20);
    expect(parsed.truncated).toBe(true);
  });

  it('drops an image too large to be worth drawing, and keeps the cell', () => {
    const huge = 'A'.repeat(200);
    const parsed = parseNotebook(
      notebook([code('plot()', [{ output_type: 'display_data', data: { 'image/png': huge } }])]),
      { ...NOTEBOOK_LIMITS, maxImageChars: 50 },
    );

    expect(parsed.cells).toHaveLength(1);
    expect(parsed.cells[0]?.outputs[0]?.image).toBeNull();
    expect(parsed.cells[0]?.outputs[0]?.text).toMatch(/too large/i);
  });
});

describe('compareNotebooks', () => {
  const compare = (before: string, after: string) =>
    compareNotebooks(parseNotebook(before), parseNotebook(after));

  it('calls a cell unchanged when only its execution count moved', () => {
    // Re-running a notebook rewrites every counter and every output. That is
    // the whole of the noise this mode exists to remove.
    const result = compare(
      notebook([code('x = 1', [], 1)]),
      notebook([code('x = 1', [], 7)]),
    );

    expect(result.cells.map((cell) => cell.kind)).toEqual(['equal']);
    expect(result.cells[0]?.outputsOnly).toBe(false);
  });

  it('flags a cell whose source held still and whose output did not', () => {
    // Not a source change, and not nothing either: a reviewer switching to the
    // outputs view wants to know which cells are worth looking at.
    const result = compare(
      notebook([code('random()', [{ output_type: 'stream', text: '0.1' }])]),
      notebook([code('random()', [{ output_type: 'stream', text: '0.9' }])]),
    );

    expect(result.cells[0]?.kind).toBe('equal');
    expect(result.cells[0]?.outputsOnly).toBe(true);
  });

  it('pairs an edited cell so the two sources can be diffed against each other', () => {
    const result = compare(notebook([code('x = 1')]), notebook([code('x = 2')]));

    expect(result.cells[0]?.kind).toBe('changed');
    expect(result.cells[0]?.before?.source).toBe('x = 1');
    expect(result.cells[0]?.after?.source).toBe('x = 2');
  });

  it('finds an inserted cell without calling everything after it changed', () => {
    const result = compare(
      notebook([code('a'), code('b')]),
      notebook([code('a'), code('inserted'), code('b')]),
    );

    expect(result.cells.map((cell) => cell.kind)).toEqual(['equal', 'added', 'equal']);
  });

  it('treats a markdown cell turned into a code cell as a change', () => {
    const result = compare(
      notebook([{ cell_type: 'markdown', source: 'text' }]),
      notebook([code('text')]),
    );

    expect(result.cells[0]?.kind).toBe('changed');
  });

  it('says when a side cannot be read at all', () => {
    const result = compareNotebooks(parseNotebook('{"a":1}'), parseNotebook(notebook([])));

    expect(result.status).toBe('unreadable');
    expect(result.reason).toBeTruthy();
  });

  it('numbers cells so a reviewer can find them in the notebook', () => {
    const result = compare(notebook([code('a'), code('b')]), notebook([code('a'), code('B')]));

    expect(result.cells[1]?.number).toBe(2);
  });
});
