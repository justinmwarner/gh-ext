/**
 * Which icon a file or a folder gets, given the theme's tables.
 *
 * The rules are VS Code's, because the tables are Material Icon Theme's and
 * were written against them. Three of them, in order of how much they know
 * about the file:
 *
 * 1. **The whole name.** `readme.md`, `dockerfile`, `package.json` — a rule
 *    written about this file rather than about its kind.
 * 2. **The longest extension.** `app.spec.ts` is a test before it is
 *    TypeScript, so the candidates run from the longest suffix inwards:
 *    `spec.ts`, then `ts`.
 * 3. **The fallback.** A plain sheet of paper, or a plain folder. Never
 *    nothing: a rail where some rows have a glyph and others have a gap reads
 *    as broken rather than as unrecognised.
 *
 * The tables are handed in rather than imported. They are the best part of a
 * quarter of a megabyte and the review page loads them after its first paint —
 * see `ui/useFileIcons.ts` — so this module has to work without them being
 * present, and `lib/` may not reach for something that is not.
 */

/** One theme's mappings, as the generated module supplies them. */
export interface IconAssociations {
  fileExtensions: Readonly<Record<string, string>>;
  fileNames: Readonly<Record<string, string>>;
  folderNames: Readonly<Record<string, string>>;
}

export interface IconTables extends IconAssociations {
  /**
   * What changes on a light page, and only what changes.
   *
   * A partial overlay rather than a second whole table: the overrides exist
   * for the couple of hundred icons drawn nearly white, and the other nine
   * hundred read on both. Falling through is what keeps this small.
   */
  light?: Partial<IconAssociations>;
}

export type ColourScheme = 'light' | 'dark';

/** What a file with nothing recognisable about it gets. */
export const DEFAULT_FILE = 'file';
/** What a folder with nothing recognisable about it gets. */
export const DEFAULT_FOLDER = 'folder';
/**
 * The suffix every open folder is spelled with.
 *
 * All 4,654 of the theme's expanded entries are the closed name plus this, so
 * the second table is derived rather than shipped — a hundred and fifty
 * kilobytes of mapping that says nothing the closed one does not.
 * `scripts/make-file-icons.mjs` re-checks that on every run and refuses to
 * generate if it has stopped being true.
 */
export const OPEN_SUFFIX = '-open';

/**
 * Look one key up in the light overlay first, then in the base table.
 *
 * Both are tried for every lookup rather than picking a table up front,
 * because the overlay is partial: a light page uses its `readme-light` and the
 * base table's `typescript` in the same tree.
 */
function find(
  tables: IconTables,
  scheme: ColourScheme,
  table: keyof IconAssociations,
  key: string,
): string | undefined {
  const overlay = scheme === 'light' ? tables.light?.[table]?.[key] : undefined;
  return overlay ?? tables[table][key];
}

/** The last segment of a path, which is the only part any rule reads. */
function basename(path: string): string {
  const body = path.endsWith('/') ? path.slice(0, -1) : path;
  return body.slice(body.lastIndexOf('/') + 1);
}

export function fileIcon(
  path: string,
  tables: IconTables,
  scheme: ColourScheme,
): string {
  const name = basename(path);

  // Exact before lowercased. A handful of the theme's rows are `APKBUILD` and
  // `PKGBUILD` — names capitalised by convention — and lowercasing both sides
  // would leave those rows unreachable by anything.
  const named =
    find(tables, scheme, 'fileNames', name) ??
    find(tables, scheme, 'fileNames', name.toLowerCase());
  if (named !== undefined) return named;

  // Longest suffix first, so `spec.ts` is preferred to the `ts` inside it. The
  // split is of the *basename*: splitting the path would read a directory like
  // `my.app/` as the start of an extension.
  const segments = name.toLowerCase().split('.');
  for (let at = 1; at < segments.length; at += 1) {
    const extension = segments.slice(at).join('.');
    const found = find(tables, scheme, 'fileExtensions', extension);
    if (found !== undefined) return found;
  }

  return DEFAULT_FILE;
}

export function folderIcon(
  path: string,
  expanded: boolean,
  tables: IconTables,
  scheme: ColourScheme,
): string {
  const name = basename(path).toLowerCase();
  const found = find(tables, scheme, 'folderNames', name) ?? DEFAULT_FOLDER;
  return expanded ? `${found}${OPEN_SUFFIX}` : found;
}
