/**
 * Two archives compared by their indexes.
 *
 * A zip carries its own table of contents at the end — one record per member
 * with a name, two sizes and a CRC-32 of the content — so the question a
 * reviewer actually has, *which files inside this thing changed*, is answered
 * without decompressing anything.
 *
 * Pure, and deliberately knows nothing about zip: it is handed two lists of
 * entries and reads only the fields above. Whatever produced them — this build
 * uses `@zip.js/zip.js` — is somebody else's problem, and the tests for this
 * file need no archive.
 */

/**
 * What happened to one member between the two sides.
 *
 * `unknown` is the one worth arguing for. An archive can withhold the checksum
 * of a member it encrypted, and two such members of the same size are not
 * unchanged — they are two things this card cannot compare. Reporting them as
 * unchanged would be the one failure a reviewer has no way to catch.
 */
export type ArchiveStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'unknown';

/** One member of an archive, as its index describes it. */
export interface ArchiveEntry {
  /** The path inside the archive, as stored. */
  path: string;
  /** A directory record, which has a name and no content. */
  directory: boolean;
  /** Size once expanded. */
  size: number;
  /** Size as stored. */
  compressedSize: number;
  /** CRC-32 of the content, or null when the archive withholds it. */
  crc: number | null;
  encrypted: boolean;
}

/** One line of the comparison. Both sides are present unless it was added or removed. */
export interface ArchiveRow {
  path: string;
  status: ArchiveStatus;
  before: ArchiveEntry | null;
  after: ArchiveEntry | null;
}

export interface ArchiveComparison {
  rows: readonly ArchiveRow[];
}

/**
 * What became of a member both sides have.
 *
 * The expanded size settles it outright when the two disagree, and it is asked
 * first because it is the one field that is always there. After that only the
 * checksum answers honestly: a rebuilt archive rewrites every timestamp and may
 * store the same bytes at a different compression level, so comparing what is
 * *stored* would report an untouched file as changed on every rebuild.
 */
function verdict(before: ArchiveEntry, after: ArchiveEntry): ArchiveStatus {
  if (before.size !== after.size) return 'changed';
  if (before.crc === null || after.crc === null) return 'unknown';
  return before.crc === after.crc ? 'unchanged' : 'changed';
}

/**
 * Members worth listing, by path.
 *
 * Directory records are dropped: they are a name and nothing else, and keeping
 * them doubles the length of a card whose whole job is to be scannable. A zip
 * may legally store the same name twice; the last record wins, which is what
 * most extractors do and therefore what the reviewer's own unzip would show.
 */
function byPath(entries: readonly ArchiveEntry[]): Map<string, ArchiveEntry> {
  const kept = new Map<string, ArchiveEntry>();
  for (const entry of entries) {
    if (entry.directory) continue;
    kept.set(entry.path, entry);
  }
  return kept;
}

export function compareArchives(
  before: readonly ArchiveEntry[],
  after: readonly ArchiveEntry[],
): ArchiveComparison {
  const old = byPath(before);
  const fresh = byPath(after);

  const rows: ArchiveRow[] = [];
  for (const path of new Set([...old.keys(), ...fresh.keys()])) {
    const one = old.get(path) ?? null;
    const two = fresh.get(path) ?? null;
    rows.push({
      path,
      status: one === null ? 'added' : two === null ? 'removed' : verdict(one, two),
      before: one,
      after: two,
    });
  }

  // Codepoint order rather than `localeCompare`, which sorts by the reviewer's
  // locale: two people reading the same pull request would see the same
  // archive in two different orders, and neither would match their `unzip -l`.
  rows.sort((one, two) => (one.path < two.path ? -1 : one.path > two.path ? 1 : 0));
  return { rows };
}

/** What came of trying to read an archive's index. */
export type ArchiveRead =
  | { status: 'ok'; entries: readonly ArchiveEntry[] }
  /** Not an archive, or damaged past the point of listing. */
  | { status: 'unreadable' };

/**
 * An archive's index, read from its bytes.
 *
 * `@zip.js/zip.js` does the reading, and the import is dynamic so that the
 * library is fetched the first time a reviewer opens an archive rather than
 * sitting in the review page's bundle for everybody else. It is the same
 * arrangement Mermaid has, for the same reason.
 *
 * Only the central directory is touched — the table of records at the end of
 * the file — so nothing here decompresses anything. That is what makes the
 * comparison cheap, and it is also the safe way round: a four megabyte archive
 * can expand to gigabytes, and this never asks it to.
 *
 * A failure is a value rather than an exception, like every other read in this
 * codebase: a `.zip` that is really a Git LFS pointer is an ordinary thing to
 * find in a repository, and the card has to say so rather than draw an archive
 * with nothing in it.
 */
export async function readArchive(bytes: Uint8Array): Promise<ArchiveRead> {
  const zip = await import('@zip.js/zip.js');
  // The pool would be built from a blob URL, which an extension page's content
  // security policy refuses. Nothing here needs one: listing an index runs no
  // codec at all.
  zip.configure({ useWebWorkers: false });

  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    return {
      status: 'ok',
      entries: entries.map((entry) => ({
        path: entry.filename,
        directory: entry.directory,
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        // `undefined` for a member encrypted with AES, which is the whole
        // reason `ArchiveStatus` has an `unknown`. A real zero — the checksum
        // of an empty file — survives.
        crc: entry.crc32 ?? null,
        encrypted: entry.encrypted,
      })),
    };
  } catch {
    return { status: 'unreadable' };
  } finally {
    // Its own catch: closing a reader that never opened throws in turn, and
    // that would replace a handled failure with an unhandled one.
    await reader.close().catch(() => undefined);
  }
}
