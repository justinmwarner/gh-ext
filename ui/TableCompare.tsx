/**
 * A CSV or TSV as a grid, with the cells that moved marked in place.
 *
 * The two modes differ in what they leave out. The grid keeps every row, so a
 * changed cell has the rest of its table around it and a reviewer can see that
 * the column it is in is the price column. Changed rows drops everything that
 * held still, which is what a reviewer wants once they know what they are
 * looking at and the file has ten thousand rows.
 *
 * The first row is drawn as a header when it survived unchanged, which is the
 * shape of essentially every committed export. When it did not survive, it is
 * drawn as an ordinary row — because a changed header is exactly the change
 * worth seeing, and hiding it in a `<th>` would style it as furniture.
 */

import type { TableComparison } from '@/lib/compare/tabular';

export interface TableCompareProps {
  comparison: TableComparison;
  /** Drop the rows that did not change. */
  changedOnly: boolean;
}

const MARKS: Record<string, string> = {
  added: '+',
  removed: '−',
  changed: '~',
  equal: '',
};

export function TableCompare({ comparison, changedOnly }: TableCompareProps) {
  const { rows, columns } = comparison;
  const header =
    rows[0]?.kind === 'equal' && rows[0].oldNumber === 1 && rows[0].newNumber === 1
      ? rows[0]
      : null;
  const body = (header === null ? rows : rows.slice(1)).filter(
    (row) => !changedOnly || row.kind !== 'equal',
  );

  const changes = rows.filter((row) => row.kind !== 'equal').length;

  return (
    <div className="table-compare">
      {comparison.approximate && (
        <p className="file-note" role="note">
          Too much of this table moved to line the rows up one by one, so it is
          shown as the old rows replaced by the new ones. The raw diff is the
          same information without the grid.
        </p>
      )}
      {comparison.truncated && (
        <p className="file-note" role="note">
          This table is larger than the grid will draw, so only the first part of
          it is shown. Open it on GitHub, or switch to Raw, to see the rest.
        </p>
      )}

      {body.length === 0 ? (
        <p className="file-note" role="note">
          {changes === 0
            ? 'No rows changed. The difference is in the file’s formatting or its quoting.'
            : 'Every changed row is above the part of the table that was drawn.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="grid" aria-label="Compared rows">
            {header !== null && (
              <thead>
                <tr>
                  <th scope="col" className="grid-gutter" aria-label="Row" />
                  {header.cells.map((cell, index) => (
                    <th key={index} scope="col">
                      {cell.text}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row) => (
                <tr
                  key={`${row.kind}:${row.oldNumber ?? 'x'}:${row.newNumber ?? 'x'}`}
                  className={`grid-row grid-${row.kind}`}
                >
                  <th scope="row" className="grid-gutter">
                    <span className="grid-mark" aria-hidden="true">
                      {MARKS[row.kind]}
                    </span>
                    <span className="visually-hidden">
                      {row.kind === 'equal' ? 'unchanged row' : `${row.kind} row`}
                    </span>
                    {row.newNumber ?? row.oldNumber}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td
                      key={index}
                      className={cell.changed ? 'grid-cell-changed' : undefined}
                    >
                      {cell.previous !== null && (
                        <span className="grid-was">{cell.previous}</span>
                      )}
                      <span className="grid-is">{cell.text}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="compare-summary">
        {changes === 0
          ? `${columns} columns, nothing changed`
          : `${changes} of ${rows.length} rows changed`}
      </p>
    </div>
  );
}
