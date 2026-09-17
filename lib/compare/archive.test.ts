/**
 * What two archives differ by, read from their indexes rather than their bytes.
 *
 * The interesting cases are all the ones where "did this entry change" cannot
 * be answered by looking at a size: a file edited without changing its length
 * is the ordinary case in a `.docx`, and an entry whose checksum the archive
 * withholds must be reported as unknown rather than guessed at.
 */

import { describe, expect, it } from 'vitest';
import { decodeBase64 } from '../github/binary-blobs';
import { NESTED_ARCHIVE, PAIR_ARCHIVE } from './archive.fixture';
import {
  type ArchiveEntry,
  compareArchives,
  entryLines,
  readArchive,
} from './archive';

const entry = (path: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  path,
  directory: false,
  size: 10,
  compressedSize: 8,
  crc: 1,
  encrypted: false,
  ...over,
});

const statuses = (rows: { path: string; status: string }[]): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.path, row.status]));

describe('compareArchives', () => {
  it('calls an entry only the new side has added', () => {
    const comparison = compareArchives([], [entry('a.txt')]);

    expect(statuses([...comparison.rows])).toEqual({ 'a.txt': 'added' });
  });

  it('calls an entry only the old side has removed', () => {
    const comparison = compareArchives([entry('a.txt')], []);

    expect(statuses([...comparison.rows])).toEqual({ 'a.txt': 'removed' });
  });

  it('calls an entry with the same checksum unchanged', () => {
    // The whole reason the checksum is read at all. A rebuilt archive rewrites
    // every timestamp and can re-compress at a different level, so comparing
    // stored bytes would report every entry as changed on every rebuild.
    const comparison = compareArchives(
      [entry('a.txt', { crc: 0xdeadbeef, compressedSize: 8 })],
      [entry('a.txt', { crc: 0xdeadbeef, compressedSize: 9 })],
    );

    expect(statuses([...comparison.rows])).toEqual({ 'a.txt': 'unchanged' });
  });

  it('calls an entry with a different checksum changed, at the same size', () => {
    // The case a size comparison cannot see, and the common one: a word swapped
    // for another of the same length.
    const comparison = compareArchives(
      [entry('a.txt', { crc: 1, size: 10 })],
      [entry('a.txt', { crc: 2, size: 10 })],
    );

    expect(statuses([...comparison.rows])).toEqual({ 'a.txt': 'changed' });
  });
});

describe('what the comparison leaves out and how it is ordered', () => {
  it('drops directory records, which have a name and no content', () => {
    // A zip usually stores one record per directory. They carry nothing a
    // reviewer can read, and listing them doubles the length of a card whose
    // whole job is to be scannable.
    const comparison = compareArchives(
      [entry('docs/', { directory: true, size: 0 })],
      [entry('docs/', { directory: true, size: 0 }), entry('docs/a.txt')],
    );

    expect([...comparison.rows].map((row) => row.path)).toEqual(['docs/a.txt']);
  });

  it('orders by path rather than by where the archive happened to store it', () => {
    // Storage order is whatever the tool that wrote the archive chose, and two
    // sides written by different tools interleave differently. Sorting is what
    // lets a reviewer read the two halves of a rename as neighbours.
    const comparison = compareArchives(
      [entry('z.txt'), entry('a.txt')],
      [entry('m.txt'), entry('a.txt')],
    );

    expect([...comparison.rows].map((row) => row.path)).toEqual(['a.txt', 'm.txt', 'z.txt']);
  });
});

describe('an entry whose checksum the archive withholds', () => {
  // AES-encrypted members carry no usable CRC. Two of them at the same size
  // are not "unchanged" — they are two things this card cannot compare, and
  // saying so is the difference between a quiet card and a lying one.
  it('is unknown rather than unchanged when both sides are silent', () => {
    const comparison = compareArchives(
      [entry('secret.txt', { crc: null, encrypted: true })],
      [entry('secret.txt', { crc: null, encrypted: true })],
    );

    expect([...comparison.rows][0]?.status).toBe('unknown');
  });

  it('is unknown when only one side is silent', () => {
    const comparison = compareArchives(
      [entry('secret.txt', { crc: 7 })],
      [entry('secret.txt', { crc: null, encrypted: true })],
    );

    expect([...comparison.rows][0]?.status).toBe('unknown');
  });

  it('is still changed when the two sides are different sizes', () => {
    // Nothing needs a checksum to see this one, and refusing to say so would
    // be as unhelpful as guessing.
    const comparison = compareArchives(
      [entry('secret.txt', { crc: null, size: 10 })],
      [entry('secret.txt', { crc: null, size: 20 })],
    );

    expect([...comparison.rows][0]?.status).toBe('changed');
  });
});

describe('readArchive', () => {
  it('reads every member, with the size and checksum its index declares', async () => {
    const read = await readArchive(decodeBase64(PAIR_ARCHIVE));

    expect(read).toEqual({
      status: 'ok',
      entries: [
        {
          path: 'data/values.csv',
          directory: false,
          size: 8,
          compressedSize: 8,
          crc: 177670011,
          encrypted: false,
        },
        {
          path: 'readme.txt',
          directory: false,
          size: 5,
          compressedSize: 5,
          crc: 907060870,
          encrypted: false,
        },
      ],
    });
  });

  it('says which record is a directory rather than a file', async () => {
    const read = await readArchive(decodeBase64(NESTED_ARCHIVE));
    const directories =
      read.status === 'ok'
        ? read.entries.filter((one) => one.directory).map((one) => one.path)
        : [];

    expect(directories).toEqual(['docs/']);
  });

  it('reads nothing out of bytes that are not an archive', async () => {
    // A `.zip` that is a Git LFS pointer, or a truncated download. There is
    // nothing to draw and the card has to say so rather than show an
    // archive with no files in it.
    const read = await readArchive(new Uint8Array([0x6e, 0x6f, 0x70, 0x65]));

    expect(read.status).toBe('unreadable');
  });
});

/**
 * The archive's members as things a search can look at.
 *
 * A `.zip` is binary to GitHub, so its patch is empty and the find panel can
 * only ever match the archive's own name — which makes the one question a
 * reviewer has about an archive, *what is inside it*, the one question search
 * could not answer.
 */
describe('entryLines', () => {
  const comparison = compareArchives(
    [entry('readme.txt', { size: 5 }), entry('gone.txt', { size: 1 })],
    [entry('readme.txt', { size: 9 }), entry('notes.md', { size: 2 })],
  );

  it('offers every member, whatever happened to it', () => {
    expect(entryLines(comparison).map((line) => line.text).sort()).toEqual([
      'gone.txt',
      'notes.md',
      'readme.txt',
    ]);
  });

  it('says what happened to each, in the word the card uses', () => {
    const status = (path: string): string | undefined =>
      entryLines(comparison).find((line) => line.text === path)?.status;

    expect(status('notes.md')).toBe('added');
    expect(status('gone.txt')).toBe('removed');
    expect(status('readme.txt')).toBe('changed');
  });

  it('leaves out directory records, which are not files anyone searches for', () => {
    const nested = compareArchives(
      [],
      [entry('docs/', { directory: true }), entry('docs/a.txt', { size: 5 })],
    );

    expect(entryLines(nested).map((line) => line.text)).toEqual(['docs/a.txt']);
  });
});
