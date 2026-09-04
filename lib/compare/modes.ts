/**
 * What kind of thing a changed file is, and the ways it can be compared.
 *
 * A unified text diff answers exactly one question — which lines moved — and
 * for a great many files that is not the question. Two versions of a PNG have
 * no lines at all. Two versions of a CSV have lines, but a column inserted in
 * the middle rewrites every one of them and tells the reviewer nothing about
 * what actually changed. Two versions of a notebook are lines of base64 image
 * output with a one-word edit buried in them.
 *
 * So a file type does not get *a* renderer. It gets a small set of **modes**,
 * because the ways of comparing an image are genuinely different questions —
 * "what does it look like now", "what moved", "how much moved" — and no single
 * one of them is the answer.
 *
 * Two rules hold for every kind, and both are enforced here rather than left to
 * the renderers:
 *
 * - **`raw` is always present, and always last.** Every smart view is a guess
 *   about intent, every guess is sometimes wrong, and a guess that cannot be
 *   backed out of is worse than none. Raw is the escape hatch: the ordinary
 *   text diff for a text file, and the honest "this is binary" for the rest.
 * - **A mode that cannot work is not offered.** Onion-skinning a newly added
 *   image against nothing is not a comparison, and a control that visibly does
 *   nothing reads as a defect rather than as an absence.
 *
 * Pure, like everything under `lib/`. It names no DOM, no `chrome.*` and no
 * component — the renderers live in `ui/` and read their instructions here.
 */

import type { PatchStatus } from '../github/types';

/** The families of content that get their own mode set. */
export type ComparisonKind = 'image' | 'svg' | 'table' | 'json' | 'notebook' | 'none';

/** Which sides of the change exist at all. */
export type ChangeSides = 'both' | 'added' | 'deleted';

/**
 * The fields of a changed file that decide how it can be compared.
 *
 * Structural rather than `ReviewFile`, which lives in `ui/`. Nothing under
 * `lib/` may import from there, and the four fields below are the whole of what
 * this module reads.
 */
export interface ComparableFile {
  path: string;
  oldPath: string;
  isBinary: boolean;
  patch: string;
  changeType: PatchStatus;
  /** Matched a noise pattern — a lockfile, a vendored tree, generated output. */
  noise: boolean;
}

export interface ComparisonMode {
  id: string;
  /** What the button says. */
  label: string;
  /** The question this mode answers, for the button's title and its label. */
  hint: string;
}

/**
 * The escape hatch, shared by every kind.
 *
 * Its meaning is per-file rather than fixed: for a CSV it is the unified text
 * diff, and for a PNG it is the sentence saying there is no text diff to show.
 * Both are "what this page did before rich comparison existed", which is what
 * makes it a hatch worth having.
 */
export const RAW: ComparisonMode = {
  id: 'raw',
  label: 'Raw',
  hint: 'The unified text diff, or the plain statement that there is none.',
};

/**
 * Every mode, by kind, in the order the buttons appear — smart views first,
 * `raw` appended by `modesFor` so no entry here can forget it.
 *
 * `needsBothSides` marks the modes that compare two things and therefore have
 * nothing to say about a file that was only added or only deleted.
 */
interface ModeSpec extends ComparisonMode {
  needsBothSides?: true;
}

const MODES: Record<Exclude<ComparisonKind, 'none'>, ModeSpec[]> = {
  image: [
    {
      id: 'image:side-by-side',
      label: 'Side by side',
      hint: 'Both versions at their own size, with their dimensions and weight.',
    },
    {
      id: 'image:swipe',
      label: 'Swipe',
      hint: 'One image over the other, revealed by dragging a divider across.',
      needsBothSides: true,
    },
    {
      id: 'image:onion',
      label: 'Onion skin',
      hint: 'The new image faded over the old one, for spotting small shifts.',
      needsBothSides: true,
    },
    {
      id: 'image:difference',
      label: 'Difference',
      hint: 'The two blended so that anything unchanged goes black.',
      needsBothSides: true,
    },
  ],
  svg: [
    {
      id: 'svg:side-by-side',
      label: 'Rendered',
      hint: 'Both versions drawn, rather than their markup.',
    },
    {
      id: 'svg:difference',
      label: 'Difference',
      hint: 'The two drawings blended so that anything unchanged goes black.',
      needsBothSides: true,
    },
  ],
  table: [
    {
      id: 'table:grid',
      label: 'Grid',
      hint: 'The whole table, with changed cells marked in place.',
    },
    {
      id: 'table:changed-rows',
      label: 'Changed rows',
      hint: 'Only the rows that moved, without the ones that did not.',
    },
  ],
  json: [
    {
      id: 'json:keys',
      label: 'Key paths',
      hint: 'Every value that changed, named by its path through the document.',
    },
    {
      id: 'json:formatted',
      label: 'Formatted',
      hint: 'Both sides re-indented identically, so only real edits show.',
    },
  ],
  notebook: [
    {
      id: 'notebook:cells',
      label: 'Cells',
      hint: 'Cell by cell, with the outputs left out.',
    },
    {
      id: 'notebook:outputs',
      label: 'Cells and outputs',
      hint: 'The same, with each cell’s output shown underneath it.',
    },
  ],
};

/**
 * The extension → kind table.
 *
 * Extensions rather than sniffed bytes, because the decision has to be made
 * before anything is fetched: which mode a card opens in is what decides
 * whether it fetches at all.
 */
const KINDS_BY_EXTENSION: Record<string, ComparisonKind> = {
  png: 'image',
  apng: 'image',
  jpg: 'image',
  jpeg: 'image',
  jfif: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'svg',
  csv: 'table',
  tsv: 'table',
  json: 'json',
  ipynb: 'notebook',
};

/**
 * The extension of a path, lowercased, or the empty string.
 *
 * The last segment only. A repository may legally contain a directory named
 * `img.png`, and a `readme.md` inside it is not an image.
 */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  // `<= 0` rather than `=== -1`: a dotfile like `.gitignore` has no extension,
  // it has a name that begins with a dot.
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Which family this file belongs to.
 *
 * The head path first and the base path second, because a deleted file's head
 * path is empty on some diff shapes and its name survives only on the base
 * side — where reading it is what lets a deletion still show what was removed.
 */
export function comparisonKind(file: ComparableFile): ComparisonKind {
  const named = file.path === '' ? file.oldPath : file.path;
  return KINDS_BY_EXTENSION[extensionOf(named)] ?? 'none';
}

/**
 * What to tell the browser a file's bytes are.
 *
 * Derived from the path rather than taken from GitHub's `content-type`, because
 * this is what decides how the browser will interpret bytes we are about to
 * hand it and that decision belongs here. An SVG labelled this way is loaded
 * through `<img>`, which is the mode that runs no script and fetches nothing —
 * whereas the same markup inlined into the document would be a page on
 * github.com's content executing inside the extension.
 */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

export function imageMediaType(path: string): string | null {
  return MEDIA_TYPES[extensionOf(path)] ?? null;
}

/**
 * How much of a patch to read looking for its mode header.
 *
 * `new file mode` and `deleted file mode` sit immediately under `diff --git`,
 * so the answer is always in the first few lines. Scanning the whole patch
 * would let a documentation file *describing* git output classify itself as an
 * addition, and would walk a megabyte of CSV on every render to do it.
 */
const HEADER_SCAN = 400;

/**
 * Which sides of this change exist.
 *
 * The patch header is authoritative and is checked first: `changeType` is
 * inferred rather than known on several paths through `reviewFiles`, and an
 * inferred `MODIFIED` on a file that was actually added would send the loader
 * after a base blob that has never existed.
 */
export function changeSides(file: ComparableFile): ChangeSides {
  const header = file.patch.slice(0, HEADER_SCAN);
  if (/^new file mode /m.test(header)) return 'added';
  if (/^deleted file mode /m.test(header)) return 'deleted';
  if (file.changeType === 'ADDED') return 'added';
  if (file.changeType === 'DELETED') return 'deleted';
  return 'both';
}

/** The modes this kind offers, given how many sides there are to compare. */
export function modesFor(kind: ComparisonKind, sides: ChangeSides): ComparisonMode[] {
  if (kind === 'none') return [RAW];

  const offered = MODES[kind]
    .filter((mode) => sides === 'both' || mode.needsBothSides !== true)
    .map(({ id, label, hint }): ComparisonMode => ({ id, label, hint }));

  return [...offered, RAW];
}

/** The modes one file offers. */
export function modesForFile(file: ComparableFile): ComparisonMode[] {
  return modesFor(comparisonKind(file), changeSides(file));
}

/**
 * The mode a card opens in.
 *
 * The smart view wins wherever there is one, because for an image and a
 * notebook the raw view is close to useless and a reviewer who has to press a
 * button to see anything will mostly not press it.
 *
 * The exception is noise. A `package-lock.json` is JSON by extension and would
 * open on the structural view, which means two multi-megabyte blob reads to
 * tell a reviewer something they did not ask about a file they were never going
 * to read. It opens raw; the structural view is still one press away.
 */
export function defaultModeFor(file: ComparableFile): string {
  if (file.noise) return RAW.id;
  return modesForFile(file)[0]?.id ?? RAW.id;
}

/**
 * The mode a card should actually be in, given what it was last set to.
 *
 * The stored mode can outlive the file it was chosen for: "changes since my
 * last review" replaces the whole file list, and a path that used to be a PNG
 * may be gone or may now be offered a different set. Falling back to the
 * default is the only answer that cannot render a control the file does not
 * have.
 */
export function resolveModeForFile(
  file: ComparableFile,
  chosen: string | undefined,
): string {
  if (chosen === undefined) return defaultModeFor(file);
  const offered = modesForFile(file);
  return offered.some((mode) => mode.id === chosen) ? chosen : defaultModeFor(file);
}

/**
 * Every mode id there is, in a fixed order.
 *
 * Exported for two reasons: the tests hold the registry to having a label and a
 * hint for each, and `diffItems` folds the index into the `CodeView` item
 * version so that switching modes is a change the viewer notices.
 */
export const ALL_MODE_IDS: string[] = [
  RAW.id,
  ...Object.values(MODES).flatMap((modes) => modes.map((mode) => mode.id)),
];

const BY_ID = new Map<string, ComparisonMode>(
  [RAW, ...Object.values(MODES).flat()].map((mode) => [
    mode.id,
    { id: mode.id, label: mode.label, hint: mode.hint },
  ]),
);

/** One mode by id, or null. Null rather than a throw — see `resolveModeForFile`. */
export function resolveMode(id: string): ComparisonMode | null {
  return BY_ID.get(id) ?? null;
}

/** A mode's position in `ALL_MODE_IDS`. Unknown ids collapse onto `raw`'s 0. */
export function modeIndex(id: string): number {
  const at = ALL_MODE_IDS.indexOf(id);
  return at === -1 ? 0 : at;
}

/** How many distinct indices `modeIndex` can return. */
export const MODE_SLOTS = ALL_MODE_IDS.length;
