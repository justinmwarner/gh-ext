/**
 * Choosing which icon a path gets.
 *
 * The tables come from Material Icon Theme and are generated; the rules for
 * reading them are here, where they can be pinned without a megabyte of data
 * in the way. They are VS Code's rules, because the tables were written
 * against them — an exact file name beats an extension, a longer extension
 * beats a shorter one, and everything unrecognised falls back rather than
 * failing.
 */

import { describe, expect, it } from 'vitest';
import { type IconTables, fileIcon, folderIcon } from './lookup';

const TABLES: IconTables = {
  fileExtensions: { ts: 'typescript', 'spec.ts': 'test-ts', md: 'markdown', png: 'image' },
  fileNames: { 'readme.md': 'readme', dockerfile: 'docker', APKBUILD: 'apkbuild' },
  folderNames: { src: 'folder-src', docs: 'folder-docs' },
  light: {
    fileExtensions: { png: 'image-light' },
    fileNames: { 'readme.md': 'readme-light' },
    folderNames: { src: 'folder-src-light' },
  },
};

describe('fileIcon', () => {
  it('matches the extension', () => {
    expect(fileIcon('src/app.ts', TABLES, 'dark')).toBe('typescript');
  });

  it('prefers the whole file name to its extension', () => {
    // `readme.md` is a `.md` file and the table has both. The more specific
    // rule is the one that was written about this file.
    expect(fileIcon('docs/readme.md', TABLES, 'dark')).toBe('readme');
  });

  it('prefers the longer extension to the shorter one inside it', () => {
    expect(fileIcon('src/app.spec.ts', TABLES, 'dark')).toBe('test-ts');
  });

  it('reads the name and the extension without regard to case', () => {
    expect(fileIcon('README.md', TABLES, 'dark')).toBe('readme');
    expect(fileIcon('src/App.TS', TABLES, 'dark')).toBe('typescript');
  });

  it('still finds a name the table spells in capitals', () => {
    // A handful of entries are `APKBUILD`, `PKGBUILD` — file names that are
    // capitalised by convention rather than by accident. Lowercasing both
    // sides would make those rows unreachable.
    expect(fileIcon('APKBUILD', TABLES, 'dark')).toBe('apkbuild');
  });

  it('falls back to a plain file rather than to nothing', () => {
    expect(fileIcon('src/mystery.wat', TABLES, 'dark')).toBe('file');
  });

  it('falls back for a file with no extension at all', () => {
    expect(fileIcon('LICENSE', TABLES, 'dark')).toBe('file');
  });

  it('finds a dotfile the table names in full', () => {
    expect(fileIcon('.dockerfile'.slice(1), TABLES, 'dark')).toBe('docker');
  });

  it('does not read a directory in the path as an extension', () => {
    // `my.app/server` ends in no extension. Splitting the whole path rather
    // than its last segment would call this a `.app/server` file.
    expect(fileIcon('my.app/server', TABLES, 'dark')).toBe('file');
  });

  it('takes the light variant where the theme supplies one', () => {
    expect(fileIcon('logo.png', TABLES, 'light')).toBe('image-light');
    expect(fileIcon('docs/readme.md', TABLES, 'light')).toBe('readme-light');
  });

  it('keeps the ordinary icon on a light page where there is no variant', () => {
    // Most icons read on both. Only the ones drawn nearly white have a second
    // version, and falling through is what keeps the override table small.
    expect(fileIcon('src/app.ts', TABLES, 'light')).toBe('typescript');
  });
});

describe('folderIcon', () => {
  it('names a folder the theme knows', () => {
    expect(folderIcon('src', false, TABLES, 'dark')).toBe('folder-src');
  });

  it('opens it by suffix, which is how the theme spells every open folder', () => {
    // 4,654 of 4,654 expanded entries are the closed one plus `-open`, so the
    // second table is derived rather than stored. `make-file-icons.mjs` fails
    // if that ever stops being true.
    expect(folderIcon('src', true, TABLES, 'dark')).toBe('folder-src-open');
  });

  it('falls back to a plain folder, open or shut', () => {
    expect(folderIcon('mystery', false, TABLES, 'dark')).toBe('folder');
    expect(folderIcon('mystery', true, TABLES, 'dark')).toBe('folder-open');
  });

  it('reads the name without regard to case', () => {
    expect(folderIcon('Docs', false, TABLES, 'dark')).toBe('folder-docs');
  });

  it('takes the light variant, and still opens it', () => {
    expect(folderIcon('src', true, TABLES, 'light')).toBe('folder-src-light-open');
  });

  it('accepts the trailing slash the tree keys directories with', () => {
    // `treeRows` spells a directory `src/`. Making the caller strip it would
    // be one more place for the two spellings to disagree.
    expect(folderIcon('src/', false, TABLES, 'dark')).toBe('folder-src');
  });
});
