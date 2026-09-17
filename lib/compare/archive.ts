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

/**
 * What each status is drawn as, in one character.
 *
 * Here rather than in the card because two surfaces draw it now — the archive
 * comparison and the find panel's results — and a product that means one thing
 * by `~` should draw one `~`. U+2212 MINUS SIGN, which is what aligns with `+`.
 */
export const STATUS_MARKS: Record<ArchiveStatus, string> = {
  added: '+',
  removed: '−',
  changed: '~',
  unchanged: '',
  unknown: '?',
};

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

/**
 * One member of an archive, as something a search can look at.
 *
 * Structurally what `lib/review/search.ts` calls a `ParsedEntry`, and
 * deliberately not an import of it: this module is a comparison primitive and
 * has no business depending on the search. TypeScript is structural, so the
 * find panel can hand one straight to the other.
 */
export interface ArchiveEntryLine {
  /** The path inside the archive — what the reviewer is looking for. */
  text: string;
  /** What happened to it, in the word {@link ArchiveStatus} spells. */
  status: ArchiveStatus;
}

/**
 * An archive's members, flattened for searching.
 *
 * A `.zip` is binary to GitHub, so its patch is empty and a find panel sweeping
 * patch text can only ever match the archive's own name. That left the one
 * question a reviewer actually has about an archive — *what is inside it* — as
 * the one question search could not answer.
 *
 * Directory records are left out. They are names without content, and nobody
 * searching a bundle is looking for `docs/`.
 */
export function entryLines(comparison: ArchiveComparison): ArchiveEntryLine[] {
  const lines: ArchiveEntryLine[] = [];

  for (const row of comparison.rows) {
    if ((row.before ?? row.after)?.directory === true) continue;
    lines.push({ text: row.path, status: row.status });
  }

  return lines;
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
