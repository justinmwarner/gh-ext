/**
 * Which comparison modes a file offers, and which one it opens in.
 *
 * The rule the whole feature rests on is that `raw` is never absent. Every
 * smart view is a guess about what the reviewer wants to see, and a guess that
 * cannot be backed out of is worse than no guess at all — so the escape hatch
 * is asserted for every kind here rather than trusted to the registry.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_MODE_IDS,
  RAW,
  type ComparableFile,
  comparisonKind,
  changeSides,
  defaultModeFor,
  modeIndex,
  modesFor,
  resolveMode,
} from './modes';

const file = (overrides: Partial<ComparableFile> = {}): ComparableFile => ({
  path: 'src/app.ts',
  oldPath: 'src/app.ts',
  isBinary: false,
  patch: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n',
  changeType: 'MODIFIED',
  noise: false,
  ...overrides,
});

describe('comparisonKind', () => {
  it('recognises the raster formats a pull request actually carries', () => {
    for (const name of [
      'a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif',
      'a.bmp', 'a.ico', 'a.apng',
    ]) {
      expect(comparisonKind(file({ path: name, isBinary: true }))).toBe('image');
    }
  });

  it('keeps SVG apart from the rasters, because it also has a source', () => {
    // The difference is not cosmetic: an SVG has a text diff worth reading and
    // a PNG has none, so the two kinds cannot share a mode set.
    expect(comparisonKind(file({ path: 'icons/logo.svg' }))).toBe('svg');
  });

  it('sees CSV and TSV as one tabular kind', () => {
    expect(comparisonKind(file({ path: 'data/rows.csv' }))).toBe('table');
    expect(comparisonKind(file({ path: 'data/rows.tsv' }))).toBe('table');
  });

  it('does not mistake a notebook for plain JSON', () => {
    // `.ipynb` is JSON on the wire, and reading it as JSON would bury the one
    // thing a reviewer wants — the cells — under the output blobs.
    expect(comparisonKind(file({ path: 'analysis.ipynb' }))).toBe('notebook');
    expect(comparisonKind(file({ path: 'tsconfig.json' }))).toBe('json');
  });

  it('reads the extension off the name, not off the directory', () => {
    // A directory called `img.png/` is legal, and a file inside it is not one.
    expect(comparisonKind(file({ path: 'img.png/readme.md' }))).toBe('none');
  });

  it('has no smart view for an extensionless or unknown file', () => {
    expect(comparisonKind(file({ path: 'Makefile' }))).toBe('none');
    expect(comparisonKind(file({ path: 'app.wasm', isBinary: true }))).toBe('none');
  });

  it('uses the old path when the head side no longer exists', () => {
    // A deleted image has an empty `path` on some diff shapes and its name only
    // on the base side. Classifying it as unknown would lose the one view that
    // could still show what was removed.
    expect(
      comparisonKind(
        file({ path: '', oldPath: 'assets/old.png', isBinary: true, changeType: 'DELETED' }),
      ),
    ).toBe('image');
  });
});

describe('changeSides', () => {
  it('reads "added" off the patch header', () => {
    expect(
      changeSides(
        file({
          patch:
            'diff --git a/a.png b/a.png\nnew file mode 100644\nindex 0000000..1111111\n',
          changeType: 'MODIFIED',
        }),
      ),
    ).toBe('added');
  });

  it('reads "deleted" off the patch header', () => {
    expect(
      changeSides(
        file({
          patch:
            'diff --git a/a.png b/a.png\ndeleted file mode 100644\nindex 1111111..0000000\n',
        }),
      ),
    ).toBe('deleted');
  });

  it('falls back to the change type when there is no patch to read', () => {
    // The files endpoint sends no patch for an oversized file, and it is the
    // only source of truth left.
    expect(changeSides(file({ patch: '', changeType: 'ADDED' }))).toBe('added');
    expect(changeSides(file({ patch: '', changeType: 'DELETED' }))).toBe('deleted');
  });

  it('reads the header, and only the header', () => {
    // `new file mode` sits directly under `diff --git` in every real patch, so
    // the scan stops at the top of it. Unbounded, this walks a megabyte of CSV
    // on every render of every card to learn what the first four lines said.
    const buried =
      'diff --git a/a.csv b/a.csv\n' + ' unchanged\n'.repeat(200) + 'new file mode 100644\n';

    expect(changeSides(file({ patch: buried }))).toBe('both');
  });

  it('does not mistake an added body line for the header it quotes', () => {
    // Every body line carries a prefix, so this is already true of the regex —
    // asserted because a future rewrite to `includes()` would lose it silently.
    expect(
      changeSides(
        file({
          patch:
            'diff --git a/doc.md b/doc.md\n@@ -1,2 +1,3 @@\n git prints\n+new file mode 100644\n',
        }),
      ),
    ).toBe('both');
  });
});

describe('modesFor', () => {
  it('offers raw for every kind there is', () => {
    const kinds = ['image', 'svg', 'table', 'json', 'notebook', 'none'] as const;
    for (const kind of kinds) {
      expect(modesFor(kind, 'both').map((mode) => mode.id)).toContain(RAW.id);
    }
  });

  it('puts raw last, because it is the fallback rather than the offer', () => {
    const ids = modesFor('image', 'both').map((mode) => mode.id);
    expect(ids[ids.length - 1]).toBe(RAW.id);
  });

  it('offers nothing but raw for a file with no smart view', () => {
    expect(modesFor('none', 'both')).toEqual([RAW]);
  });

  it('drops the overlay modes when there is only one image to look at', () => {
    // Onion-skinning one image against nothing is not a comparison, and a
    // control that does nothing is worse than a control that is absent.
    const added = modesFor('image', 'added').map((mode) => mode.id);
    expect(added).toContain('image:side-by-side');
    expect(added).not.toContain('image:onion');
    expect(added).not.toContain('image:swipe');
    expect(added).not.toContain('image:difference');
  });

  it('drops the SVG overlay for a one-sided change too', () => {
    expect(modesFor('svg', 'deleted').map((mode) => mode.id)).not.toContain(
      'svg:difference',
    );
  });

  it('keeps the tabular and structural modes for one-sided changes', () => {
    // A new CSV still has a grid worth reading, and a new JSON file still has
    // key paths — both simply compare against nothing.
    expect(modesFor('table', 'added').map((mode) => mode.id)).toContain('table:grid');
    expect(modesFor('json', 'deleted').map((mode) => mode.id)).toContain('json:keys');
  });

  it('gives every mode a label and a sentence explaining what it answers', () => {
    for (const mode of ALL_MODE_IDS.map((id) => resolveMode(id))) {
      expect(mode?.label).toBeTruthy();
      expect(mode?.hint).toBeTruthy();
    }
  });
});

describe('defaultModeFor', () => {
  it('opens an image in its smart view, because raw says only that it changed', () => {
    expect(defaultModeFor(file({ path: 'a.png', isBinary: true }))).toBe(
      'image:side-by-side',
    );
  });

  it('opens a notebook on its cells with the outputs left out', () => {
    expect(defaultModeFor(file({ path: 'a.ipynb' }))).toBe('notebook:cells');
  });

  it('opens a lockfile raw, whatever its extension promises', () => {
    // A `package-lock.json` is JSON, and its structural view would fetch two
    // multi-megabyte blobs to tell a reviewer something they did not ask. The
    // smart mode is still one press away.
    expect(defaultModeFor(file({ path: 'package-lock.json', noise: true }))).toBe(RAW.id);
  });

  it('opens an ordinary file raw', () => {
    expect(defaultModeFor(file())).toBe(RAW.id);
  });
});

describe('resolveMode and modeIndex', () => {
  it('gives every declared id a stable index', () => {
    const seen = new Set(ALL_MODE_IDS.map((id) => modeIndex(id)));
    expect(seen.size).toBe(ALL_MODE_IDS.length);
  });

  it('answers for an id it does not know rather than throwing', () => {
    // The mode lives in component state keyed by path. A file list replaced
    // underneath it can leave a mode that no longer applies, and a throw there
    // would blank the column.
    expect(resolveMode('image:nonsense')).toBeNull();
    expect(modeIndex('image:nonsense')).toBe(0);
  });
});
