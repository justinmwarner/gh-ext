/**
 * Bakes Material Icon Theme into the two things the review page actually uses.
 *
 * Run with `npm run file-icons`. The source is the `material-icon-theme`
 * package, which is a devDependency and stays one: nothing it ships reaches
 * the built extension, only what this writes.
 *
 * ## Why this is a build step rather than a runtime one
 *
 * The same argument `make-palettes.mjs` makes, arriving at a different answer
 * for a different reason. That table is baked because a content script cannot
 * await a dynamic import before its first paint. This one is baked because the
 * package is not importable at all in the shape we need it: its manifest names
 * 1,173 SVG files by *relative path on disk*, which a bundler cannot follow
 * without a glob over `node_modules` — and a glob over someone else's package
 * is a build that breaks on their next patch release.
 *
 * Generating also lets us take only what is wanted. The manifest carries a
 * second folder table, `folderNamesExpanded`, which is 151 kilobytes saying
 * the closed name plus `-open` for all 4,654 of its rows. It is derived
 * instead, and the check below is what keeps that honest: if a future release
 * ever spells one of them differently, this refuses to generate rather than
 * quietly dropping that folder's open state.
 *
 * ## Two outputs, for two different costs
 *
 * **`public/file-icons/*.svg`** — the drawings, as files. WXT copies `public/`
 * verbatim, so each is fetched by `<img>` only when a pull request actually
 * contains that kind of file. Most reviews touch a dozen, so most of the
 * 851 kilobytes here is never read. Inlining them into a module instead would
 * have meant parsing all of it on every review, and — because a third of these
 * drawings use `<defs>` and `url(#…)` — 1,137 `id` attributes colliding the
 * moment two copies of one icon were in the document at once.
 *
 * **`lib/icons/material.ts`** — the mapping, as code. There is no way to look
 * up a file's icon without it, so it is imported rather than fetched, and
 * `ui/useFileIcons.ts` does that after the page has painted.
 */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));

const manifestPath = require.resolve('material-icon-theme/dist/material-icons.json');
const themeRoot = path.dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const OUT_SVG = path.join(root, 'public', 'file-icons');
const OUT_TS = path.join(root, 'lib', 'icons', 'material.ts');

/** The suffix `lib/icons/lookup.ts` derives every open folder with. */
const OPEN_SUFFIX = '-open';

/**
 * The derivation this generator is allowed to make, checked before making it.
 *
 * A release that spelled one expanded folder differently would otherwise show
 * that folder's closed icon while it was open, on one folder out of thousands,
 * with nothing to say why.
 */
const undrivable = Object.entries(manifest.folderNames).filter(
  ([name, icon]) => manifest.folderNamesExpanded[name] !== `${icon}${OPEN_SUFFIX}`,
);
if (undrivable.length > 0) {
  throw new Error(
    `material-icon-theme no longer spells every expanded folder as "<closed>${OPEN_SUFFIX}"; ` +
      `${undrivable.length} differ, starting with ${undrivable[0][0]}. ` +
      'Ship folderNamesExpanded rather than deriving it, and update lib/icons/lookup.ts.',
  );
}

/** Every icon name any table can reach, including the two fallbacks. */
const wanted = new Set([manifest.file, manifest.folder, manifest.folderExpanded]);
const TABLES = ['fileExtensions', 'fileNames', 'folderNames'];
for (const table of TABLES) {
  for (const icon of Object.values(manifest[table] ?? {})) wanted.add(icon);
  for (const icon of Object.values(manifest.light?.[table] ?? {})) wanted.add(icon);
}
// The open form of every folder icon, which no table names because it is
// derived. Without this the drawings for an expanded folder would be absent.
//
// `folderExpanded` is already in the set and already ends in the suffix, so it
// is skipped rather than turned into `folder-open-open` — a drawing nothing
// can ever ask for, shipped to the store for nobody to see.
for (const icon of [...wanted]) {
  if (icon.startsWith('folder') && !icon.endsWith(OPEN_SUFFIX)) {
    wanted.add(`${icon}${OPEN_SUFFIX}`);
  }
}

// Recreated rather than written over: an icon the theme has dropped should
// leave the build, and a stale file nobody references is a file the store
// review still has to be shipped.
rmSync(OUT_SVG, { recursive: true, force: true });
mkdirSync(OUT_SVG, { recursive: true });

/**
 * The drawing for a name, or the nearest one the theme does draw.
 *
 * Every name reached here has to end up as a file, because the review page
 * asks for icons by `<img src>` and a name with no file behind it is a broken
 * image in the rail — worse than a generic folder, and silent until someone
 * opens exactly that directory.
 *
 * Only the derived open-folder forms need it, and only a handful of those: the
 * theme draws `folder-jinja-open` but not `folder-jinja_light-open`, because
 * its own light overrides stop at the closed state. So the chain is the name
 * itself, then the same name without the `_light` marker, then the plain open
 * folder — each step giving up a little specificity and none of them giving up
 * the fact that this is a folder standing open.
 */
const drawingFor = (icon) => {
  const candidates = [icon];
  if (icon.includes('_light')) candidates.push(icon.replace('_light', ''));
  if (icon.endsWith(OPEN_SUFFIX)) candidates.push(`${manifest.folder}${OPEN_SUFFIX}`);
  else candidates.push(manifest.folder);

  for (const candidate of candidates) {
    const definition = manifest.iconDefinitions[candidate];
    if (definition !== undefined) return { name: candidate, definition };
  }
  return null;
};

let written = 0;
let bytes = 0;
const aliased = [];

for (const icon of [...wanted].sort()) {
  const found = drawingFor(icon);
  if (found === null) {
    throw new Error(`no drawing for ${icon}, and no fallback either`);
  }
  if (found.name !== icon) aliased.push(`${icon} -> ${found.name}`);

  const source = path.resolve(themeRoot, found.definition.iconPath);
  const svg = readFileSync(source, 'utf8');
  writeFileSync(path.join(OUT_SVG, `${icon}.svg`), svg);
  written += 1;
  bytes += svg.length;
}

/** One table as a sorted object literal, so a regeneration diffs cleanly. */
const literal = (table) => {
  const rows = Object.entries(table ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (rows.length === 0) return '{}';
  const body = rows.map(([key, icon]) => `  ${JSON.stringify(key)}: ${JSON.stringify(icon)},`);
  return `{\n${body.join('\n')}\n}`;
};

const associations = (source) =>
  TABLES.map((table) => `  ${table}: ${literal(source?.[table]).replace(/\n/g, '\n  ')},`).join(
    '\n',
  );

const module = `/**
 * Material Icon Theme's file, extension and folder mappings.
 *
 * GENERATED by \`npm run file-icons\` from the \`material-icon-theme\` package.
 * Do not edit: \`lib/icons/material.test.ts\` fails when this and the installed
 * version have drifted apart.
 *
 * The drawings are not here. They are \`public/file-icons/*.svg\`, fetched by
 * \`<img>\` only for the kinds of file a given pull request contains —
 * \`scripts/make-file-icons.mjs\` explains why that split is worth having.
 *
 * \`folderNamesExpanded\` is absent on purpose: every one of its rows is the
 * closed name plus \`-open\`, so \`lib/icons/lookup.ts\` derives it and the
 * generator refuses to run if that ever stops being true.
 *
 * ---
 *
 * Material Icon Theme is MIT licensed.
 * Copyright (c) 2025 Material Extensions.
 * https://github.com/material-extensions/vscode-material-icon-theme
 */

import type { IconTables } from './lookup';

export const MATERIAL_ICONS: IconTables = {
${associations(manifest)}
  light: {
${associations(manifest.light).replace(/\n/g, '\n  ')}
  },
};

/** What \`npm run file-icons\` drew, so a test can check none has gone missing. */
export const ICON_COUNT = ${written};
`;

mkdirSync(path.dirname(OUT_TS), { recursive: true });
writeFileSync(OUT_TS, module);

const onDisk = readdirSync(OUT_SVG).length;
console.log(
  `file-icons: ${written} drawings (${(bytes / 1024).toFixed(0)}KB) in public/file-icons, ` +
    `${onDisk} files on disk`,
);
console.log(`file-icons: ${(module.length / 1024).toFixed(0)}KB of mapping in lib/icons/material.ts`);
if (aliased.length > 0) {
  console.log(
    `file-icons: ${aliased.length} name(s) the theme does not draw, written from the nearest it ` +
      `does: ${aliased.slice(0, 3).join(', ')}${aliased.length > 3 ? ', …' : ''}`,
  );
}
