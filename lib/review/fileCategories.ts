/**
 * What sort of file each type is: code, images, fonts and the rest.
 *
 * For the filter menu's two type lists, which group their rows under these
 * headings. A pull request that touches thirty types is a list nobody can find
 * `.woff2` in by reading it. With the images together and the fonts together,
 * the reviewer reads nine headings instead of thirty rows.
 *
 * The table is by extension and deliberately plain: what a reviewer would call
 * the file at a glance, not what a build tool does with it. `.svg` is an image
 * even though it is text, and `.pdf` is a document even though it is binary. A
 * longer type (`.spec.tsx`) goes wherever its extension goes. The two types
 * that are not an extension, and any extension not in the table, go under
 * Other. That is the honest heading for a file this cannot place.
 *
 * Pure by contract: no DOM, no `chrome.*`, no transport.
 */

import { parentType } from './fileFilters';

export type FileCategory =
  | 'code'
  | 'styles'
  | 'docs'
  | 'data'
  | 'images'
  | 'fonts'
  | 'media'
  | 'archives'
  | 'other';

/**
 * The order the groups are listed in: what a reviewer reads closely first,
 * what they mostly skim after, and what cannot be placed last.
 */
export const CATEGORY_ORDER: readonly FileCategory[] = [
  'code',
  'styles',
  'docs',
  'data',
  'images',
  'fonts',
  'media',
  'archives',
  'other',
];

/** Each group's heading. Sentence case, as every heading on the page is. */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  code: 'Code',
  styles: 'Styles',
  docs: 'Docs',
  data: 'Data and config',
  images: 'Images',
  fonts: 'Fonts',
  media: 'Audio and video',
  archives: 'Archives and binaries',
  other: 'Other',
};

/** Extensions, without the dot, for each group but Other. */
const TABLE: Record<Exclude<FileCategory, 'other'>, readonly string[]> = {
  code: [
    'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyi', 'go', 'rs', 'java',
    'kt', 'kts', 'scala', 'groovy', 'gradle', 'rb', 'php', 'c', 'h', 'cc', 'cpp', 'cxx',
    'hpp', 'hh', 'cs', 'fs', 'vb', 'swift', 'm', 'mm', 'dart', 'lua', 'ex', 'exs', 'erl',
    'hrl', 'hs', 'clj', 'cljs', 'elm', 'ml', 'mli', 'r', 'jl', 'pl', 'pm', 'sh', 'bash',
    'zsh', 'fish', 'ps1', 'bat', 'cmd', 'vue', 'svelte', 'astro', 'sql', 'graphql', 'gql',
    'proto', 'tf', 'hcl', 'nix', 'zig', 'sol', 'ipynb',
  ],
  styles: ['css', 'scss', 'sass', 'less', 'styl', 'pcss'],
  docs: [
    'md', 'mdx', 'markdown', 'rst', 'adoc', 'asciidoc', 'txt', 'tex', 'html', 'htm',
    'org', 'rtf', 'pdf',
  ],
  data: [
    'json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv',
    'ini', 'cfg', 'conf', 'properties', 'lock', 'plist', 'snap', 'sum', 'mod', 'env',
  ],
  images: [
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'avif', 'heic',
    'psd',
  ],
  fonts: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
  media: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4', 'mov', 'webm', 'avi', 'mkv'],
  archives: [
    'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'exe', 'dll', 'so',
    'dylib', 'bin', 'wasm', 'class', 'o', 'a', 'dmg', 'iso', 'apk',
  ],
};

const BY_EXTENSION = new Map<string, FileCategory>(
  Object.entries(TABLE).flatMap(([category, extensions]) =>
    extensions.map((extension): [string, FileCategory] => [`.${extension}`, category as FileCategory]),
  ),
);

/** Which group a type is listed under. A longer type follows its extension. */
export function fileCategory(type: string): FileCategory {
  return BY_EXTENSION.get(parentType(type) ?? type) ?? 'other';
}

/** One group of a type list, as the menu draws it. */
export interface CategoryGroup {
  category: FileCategory;
  types: string[];
}

/**
 * Types grouped under their headings, in {@link CATEGORY_ORDER}.
 *
 * The types keep the order they were handed in within each group, which is
 * the facets' own order, so `.spec.tsx` still follows `.tsx`. Empty groups
 * are left out.
 */
export function byCategory(types: Iterable<string>): CategoryGroup[] {
  const grouped = new Map<FileCategory, string[]>();
  for (const type of types) {
    const category = fileCategory(type);
    grouped.set(category, [...(grouped.get(category) ?? []), type]);
  }
  return CATEGORY_ORDER.flatMap((category) => {
    const members = grouped.get(category);
    return members === undefined ? [] : [{ category, types: members }];
  });
}
