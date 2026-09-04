/**
 * Comparing two delimited files as a table rather than as lines.
 *
 * A unified diff of a CSV answers the wrong question twice over. Inserting a
 * column rewrites every line in the file, so the diff is a hundred per cent
 * changed and says nothing; and editing one cell shows a whole line removed and
 * a whole line added, leaving the reviewer to find the moved value by eye
 * against a line of commas. Aligning the rows and marking the cells is the
 * whole of the improvement.
 *
 * The parser is by hand rather than by dependency, and that is a deliberate
 * call rather than an oversight. RFC 4180 is quoting, doubled quotes, embedded
 * newlines and CRLF — about sixty lines — and the alternative is a package
 * whose value is the parts we would then have to bound anyway: streaming,
 * worker offload, type inference, dynamic typing. See the comparison document
 * for the libraries considered.
 *
 * Every limit here exists because the input is whatever a pull request
 * contains. The parse stops at a row count, a column count and a total cell
 * budget, and reports honestly that it did — a table that silently shows the
 * first two thousand rows of eighteen thousand is worse than the text diff,
 * because the reviewer cannot tell.
 */

import { alignRows, pairRows } from './rows';
import { extensionOf } from './modes';

/**
 * The one byte that cannot occur in a delimited field.
 *
 * Written as an escape rather than as itself. A literal NUL in the source
 * makes git call the whole file binary — no diff, no blame, no merge — which
 * is a high price for a separator nobody ever sees.
 */
const FIELD_SEPARATOR = '\u0000';

export interface TableLimits {
  /** Rows materialized per side. */
  maxRows: number;
  /** Columns kept per row. Wide exports are usually wide by accident. */
  maxColumns: number;
  /**
   * Cells materialized per side, which is what actually bounds the DOM.
   * A row cap alone does not notice a hundred-column table.
   */
  maxCells: number;
}

/**
 * The limits a card renders with.
 *
 * Thirty thousand cells is the number that matters: it is roughly what Chrome
 * lays out without a visible stall, and every other cap is a way of reaching it
 * sooner. Blob reads are already capped at a megabyte upstream, so this is the
 * second gate rather than the first.
 */
export const TABLE_LIMITS: TableLimits = {
  maxRows: 2000,
  maxColumns: 30,
  maxCells: 30_000,
};

export interface ParsedTable {
  rows: string[][];
  /**
   * The source text of each parsed row, which is what the two sides are aligned
   * on. Derived from the parsed cells rather than from the original line, so
   * two rows that differ only in their quoting compare equal — which is what a
   * reviewer means by "this row did not change".
   */
  keys: string[];
  /** The widest row, after capping. */
  columns: number;
  /** Rows in the file, including the ones past the cap. */
  totalRows: number;
  truncated: boolean;
}

/** The delimiters worth sniffing between. Order is the tie-break. */
const CANDIDATES = [',', ';', '\t', '|'] as const;

/**
 * Which character separates the fields.
 *
 * `.tsv` is settled by its name. `.csv` is not: Excel writes semicolons in
 * every locale whose decimal separator is a comma, and read as commas such a
 * file is one enormous column and every row of it reads as changed.
 *
 * Sniffed from the first non-empty line, counting occurrences without regard to
 * quoting. A quoted comma inside a semicolon-delimited row would have to
 * outnumber the semicolons to mislead this, which is a table with one column
 * and a lot of prose in it.
 */
export function delimiterFor(path: string, sample: string): string {
  if (extensionOf(path) === 'tsv') return '\t';

  const line = sample.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    let count = 0;
    for (const character of line) if (character === candidate) count += 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse a delimited file into rows of cells.
 *
 * A single forward pass over the characters, because the quoting rules are not
 * expressible as a split: a delimiter inside quotes is data, a newline inside
 * quotes is data, and `""` inside quotes is one quote.
 *
 * `totalRows` counts every row in the file even after materializing stops, so
 * the caller can say "the first two thousand of eighteen thousand" rather than
 * showing two thousand and implying that is all there is. Counting is a
 * continuation of the same pass, so it costs a scan and no allocation.
 */
export function parseDelimited(
  text: string,
  delimiter: string,
  limits: TableLimits = TABLE_LIMITS,
): ParsedTable {
  const rows: string[][] = [];
  const keys: string[] = [];
  let columns = 0;
  let totalRows = 0;
  let truncated = false;

  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let dropped = false;
  // A file ending in a newline has no final row after it, but a file ending
  // mid-row does. Tracked rather than inferred so `a\n\nb\n` keeps its empty
  // middle row while `a\nb\n` does not grow a phantom one at the end.
  let started = false;

  const endCell = (): void => {
    if (row.length < limits.maxColumns) row.push(cell);
    else dropped = true;
    cell = '';
  };

  const endRow = (): void => {
    endCell();
    totalRows += 1;

    const room =
      rows.length < limits.maxRows &&
      (rows.length + 1) * Math.max(columns, row.length) <= limits.maxCells;

    if (room) {
      rows.push(row);
      // The key is the parsed cells rejoined with a separator no cell can
      // contain, so quoting differences do not read as content differences.
      keys.push(row.join(FIELD_SEPARATOR));
      if (row.length > columns) columns = row.length;
    } else {
      truncated = true;
    }

    row = [];
    started = false;
  };

  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    started = true;

    if (quoted) {
      if (character === '"') {
        if (text[at + 1] === '"') {
          cell += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === delimiter) {
      endCell();
    } else if (character === '\n') {
      endRow();
    } else if (character === '\r' && text[at + 1] === '\n') {
      // Swallowed here rather than stripped up front, so a lone \r inside a
      // quoted field survives and a CRLF file does not leave \r on the last
      // cell of every row — which would mark that whole column as changed
      // against an LF-terminated counterpart.
      continue;
    } else {
      cell += character;
    }
  }

  if (started || cell !== '' || row.length > 0) endRow();

  if (dropped) truncated = true;

  return { rows, keys, columns, totalRows, truncated };
}

/** One cell of the compared grid. */
export interface ComparedCell {
  /** What to draw: the new value where there is one, otherwise the old. */
  text: string;
  /** The value it replaced. Null unless this cell changed. */
  previous: string | null;
  changed: boolean;
}

export interface ComparedRow {
  kind: 'equal' | 'changed' | 'added' | 'removed';
  /** One-based row numbers, for the gutter. Null on the side it is absent from. */
  oldNumber: number | null;
  newNumber: number | null;
  cells: ComparedCell[];
}

export interface TableComparison {
  rows: ComparedRow[];
  columns: number;
  /** Either side hit a parse cap. */
  truncated: boolean;
  /** The alignment gave up on pairing and reported one wholesale replacement. */
  approximate: boolean;
}

const cellAt = (row: string[] | undefined, column: number): string => row?.[column] ?? '';

/**
 * Compare two parsed tables.
 *
 * Rows are aligned on their whole content, then a removal adjacent to an
 * addition is read as an edit and its cells are compared column by column. The
 * grid is rectangular — every row is widened to the widest — because a ragged
 * table renders as a staircase and the missing cells are exactly the ones a
 * reviewer needs to see are missing.
 */
export function compareTables(before: ParsedTable, after: ParsedTable): TableComparison {
  const { ops, approximate } = alignRows(before.keys, after.keys);
  const columns = Math.max(before.columns, after.columns);

  const rows = pairRows(ops).map((pair): ComparedRow => {
    if (pair.kind === 'added') {
      const source = after.rows[pair.newIndex];
      return {
        kind: 'added',
        oldNumber: null,
        newNumber: pair.newIndex + 1,
        cells: fill(columns, (column) => ({
          text: cellAt(source, column),
          previous: null,
          changed: false,
        })),
      };
    }

    if (pair.kind === 'removed') {
      const source = before.rows[pair.oldIndex];
      return {
        kind: 'removed',
        oldNumber: pair.oldIndex + 1,
        newNumber: null,
        cells: fill(columns, (column) => ({
          text: cellAt(source, column),
          previous: null,
          changed: false,
        })),
      };
    }

    const oldRow = before.rows[pair.oldIndex];
    const newRow = after.rows[pair.newIndex];
    return {
      kind: pair.kind,
      oldNumber: pair.oldIndex + 1,
      newNumber: pair.newIndex + 1,
      cells: fill(columns, (column) => {
        const previous = cellAt(oldRow, column);
        const text = cellAt(newRow, column);
        return {
          text,
          previous: previous === text ? null : previous,
          changed: previous !== text,
        };
      }),
    };
  });

  return {
    rows,
    columns,
    truncated: before.truncated || after.truncated,
    approximate,
  };
}

const fill = <T,>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_unused, index) => make(index));
