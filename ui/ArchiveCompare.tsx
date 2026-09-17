/**
 * What is inside an archive, and which of it moved.
 *
 * A `.zip` — or a `.docx`, or a `.vsix`, which are zips wearing other names —
 * is a binary file to GitHub, so the whole of what a review page usually says
 * about one is "Binary file changed". This card says which files it holds and
 * which of them differ, read from the archive's own index rather than from its
 * bytes: nothing here is decompressed, which is what keeps it cheap and also
 * what keeps a four megabyte archive from expanding into gigabytes on the page.
 *
 * The two modes are the table's two modes for the same reason. Contents keeps
 * every member, so a changed one has the rest of the archive around it and a
 * reviewer can see that the part that moved is `word/document.xml` and not the
 * other nineteen. Changed files drops the rest, which is what a reviewer wants
 * once they know what they are looking at and the archive is a `.jar`.
 *
 * It borrows the grid the CSV card is drawn in rather than growing its own, so
 * a changed row here and a changed row there read as the same event.
 */

import {
  type ArchiveComparison,
  type ArchiveRow,
  type ArchiveStatus,
  STATUS_MARKS,
} from '@/lib/compare/archive';
import { kb } from './bytes';

export interface ArchiveCompareProps {
  comparison: ArchiveComparison;
  /** Drop the members that did not change. */
  changedOnly: boolean;
}

/**
 * The same fact in words, for a reviewer who is not reading the colours.
 *
 * `unknown` is a sentence rather than a word because it is the one status whose
 * meaning is not guessable from a mark: the entry is encrypted, its checksum is
 * not in the index, and this card has no way to tell the two sides apart.
 */
const WORDS: Record<ArchiveStatus, string> = {
  added: 'added',
  removed: 'removed',
  changed: 'changed',
  unchanged: 'unchanged',
  unknown: 'could not be compared',
};

/**
 * The size to show, and which side it belongs to.
 *
 * A removed member has only an old size and an added one only a new size, so
 * showing "the new size" would leave a dash on every removal. When a changed
 * member ended up a different length, both are shown — that difference is
 * frequently the only detail on the row, since the contents themselves are not
 * read.
 */
function Size({ row }: { row: ArchiveRow }) {
  const was = row.before?.size ?? null;
  const is = row.after?.size ?? null;

  if (is === null) return <>{kb(was ?? 0)}</>;
  if (was === null || was === is) return <>{kb(is)}</>;
  return (
    <>
      <span className="grid-was">{kb(was)}</span>
      <span className="grid-is">{kb(is)}</span>
    </>
  );
}

/** `n things`, with the `s` dropped for one of them. */
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The line under the table.
 *
 * Members still in the archive are counted, rather than rows: a removed file is
 * not inside it any more, and saying it is would be the one number on this card
 * that is false. What happened is listed beside it, leaving out the categories
 * that are empty — "0 added, 0 removed" is noise on the overwhelming majority
 * of archives, which change in one member.
 */
function summarise(rows: readonly ArchiveRow[]): string {
  const inside = rows.filter((row) => row.after !== null).length;
  const tally = (status: ArchiveStatus): number =>
    rows.filter((row) => row.status === status).length;

  const parts = [
    tally('changed') > 0 ? `${tally('changed')} changed` : null,
    tally('added') > 0 ? `${tally('added')} added` : null,
    tally('removed') > 0 ? `${tally('removed')} removed` : null,
    tally('unknown') > 0 ? `${count(tally('unknown'), 'file')} could not be compared` : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0
    ? `${count(inside, 'file')} inside, none of them changed`
    : `${count(inside, 'file')} inside. ${parts.join(', ')}.`;
}

export function ArchiveCompare({ comparison, changedOnly }: ArchiveCompareProps) {
  const { rows } = comparison;
  const body = changedOnly ? rows.filter((row) => row.status !== 'unchanged') : rows;

  return (
    <div className="archive-compare">
      {body.length === 0 ? (
        <p className="file-note" role="note">
          {changedOnly && rows.length > 0
            ? 'Nothing inside this archive changed. Contents lists every file it holds.'
            : 'This archive holds no files.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="grid" aria-label="Files inside the archive">
            <thead>
              <tr>
                <th scope="col" className="grid-gutter" aria-label="Change" />
                <th scope="col">File</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {body.map((row) => (
                <tr key={row.path} className={`grid-row archive-${row.status}`}>
                  <td className="grid-gutter">
                    <span className="grid-mark" aria-hidden="true">
                      {STATUS_MARKS[row.status]}
                    </span>
                    <span className="visually-hidden">{WORDS[row.status]}</span>
                  </td>
                  <th scope="row" className="archive-path">
                    {row.path}
                  </th>
                  <td className="archive-size">
                    <Size row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="compare-summary">{summarise(rows)}</p>
    </div>
  );
}
