/**
 * What sort of file each type is, for grouping the menu's type lists.
 *
 * A pull request with thirty types is a list nobody can find `.woff2` in. Put
 * the images together and the fonts together, and the reviewer reads the
 * headings instead of every row. What is pinned here is where each type goes,
 * that a longer type goes where its extension goes, and the order of the
 * groups.
 */

import { describe, expect, it } from 'vitest';
import { DOTFILE, NO_EXTENSION } from './fileFilters';
import { CATEGORY_LABELS, byCategory, fileCategory } from './fileCategories';

describe('fileCategory', () => {
  it.each([
    ['.tsx', 'code'],
    ['.py', 'code'],
    ['.scss', 'styles'],
    ['.md', 'docs'],
    ['.pdf', 'docs'],
    ['.json', 'data'],
    ['.snap', 'data'],
    ['.png', 'images'],
    ['.svg', 'images'],
    ['.woff2', 'fonts'],
    ['.mp4', 'media'],
    ['.zip', 'archives'],
  ])('files %s under %s', (type, category) => {
    expect(fileCategory(type)).toBe(category);
  });

  it('puts a longer type where its extension goes', () => {
    expect(fileCategory('.spec.tsx')).toBe('code');
    expect(fileCategory('.module.css')).toBe('styles');
    expect(fileCategory('.tar.gz')).toBe('archives');
  });

  it('puts dotfiles, files with no extension and anything it does not know under Other', () => {
    expect(fileCategory(DOTFILE)).toBe('other');
    expect(fileCategory(NO_EXTENSION)).toBe('other');
    expect(fileCategory('.qqq')).toBe('other');
  });

  it('names every category in words, sentence case', () => {
    expect(CATEGORY_LABELS.images).toBe('Images');
    expect(CATEGORY_LABELS.data).toBe('Data and config');
  });
});

describe('byCategory', () => {
  it('groups the types in a fixed order of categories, keeping their order within each', () => {
    const groups = byCategory(['.md', '.png', '.ts', '.spec.ts', '.svg', DOTFILE, '.json']);

    expect(groups).toEqual([
      { category: 'code', types: ['.ts', '.spec.ts'] },
      { category: 'docs', types: ['.md'] },
      { category: 'data', types: ['.json'] },
      { category: 'images', types: ['.png', '.svg'] },
      { category: 'other', types: [DOTFILE] },
    ]);
  });

  it('leaves out a category with no types in it', () => {
    expect(byCategory(['.png'])).toEqual([{ category: 'images', types: ['.png'] }]);
  });
});
