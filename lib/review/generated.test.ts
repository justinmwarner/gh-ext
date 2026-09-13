/**
 * Deciding which files nobody wrote.
 *
 * Two things are worth pinning hardest. The repository's own declaration has to
 * win in **both** directions — a `-linguist-generated` that does not exempt is
 * worse than no support at all, because the repository was explicit and the
 * page ignored it. And the last matching line has to win, because that is how
 * every real `.gitattributes` that marks a tree and then carves an exception is
 * written.
 */

import { describe, expect, it } from 'vitest';
import {
  GENERATED_PATTERNS,
  NO_ATTRIBUTES,
  attributeGlobs,
  isGenerated,
  parseGitAttributes,
} from './generated';

describe('the built-in patterns', () => {
  it.each([
    'package-lock.json',
    'web/yarn.lock',
    'Cargo.lock',
    'go.sum',
    'deep/nested/pnpm-lock.yaml',
    'static/app.min.js',
    'static/app.min.css',
    'static/app.js.map',
    'api/service.pb.go',
    'api/service_pb2.py',
    'lib/model.g.dart',
    'src/__snapshots__/App.test.tsx.snap',
    'src/Button.test.tsx.snap',
    'vendor/github.com/pkg/errors/errors.go',
    'dist/bundle.js',
    'src/generated/schema.ts',
  ])('calls %s generated', (path) => {
    expect(isGenerated(path, NO_ATTRIBUTES)).toBe(true);
  });

  it.each([
    'src/app.ts',
    'package.json',
    'README.md',
    'build/make.sh',
    'lib/lockfile.ts',
    'src/distance.ts',
    'docs/vendors.md',
  ])('leaves %s alone', (path) => {
    // The bias is asymmetric on purpose: a hand-written file wrongly folded is
    // a review someone does not do, and `build/` in particular is a directory
    // plenty of repositories keep written source in.
    expect(isGenerated(path, NO_ATTRIBUTES)).toBe(false);
  });

  it('matches a lockfile however deep it is', () => {
    expect(isGenerated('a/b/c/d/package-lock.json', NO_ATTRIBUTES)).toBe(true);
  });

  it('compiles every pattern it ships', () => {
    // A pattern that throws when compiled would take the whole column down.
    for (const pattern of GENERATED_PATTERNS) {
      expect(() => isGenerated('some/path.ts', [{ globs: [pattern], generated: true }])).not.toThrow();
    }
  });
});

describe('attributeGlobs', () => {
  it('lets a pattern with no slash match at any depth', () => {
    // `*.min.js` is written to catch every minified file, not the one that
    // happens to sit in the root.
    expect(attributeGlobs('*.min.js')).toEqual(['**/*.min.js']);
  });

  it('anchors a leading slash to the root and drops it', () => {
    expect(attributeGlobs('/dist')).toEqual(['dist', 'dist/**']);
  });

  it('treats a slash anywhere as spelling the path out', () => {
    expect(attributeGlobs('docs/*.md')).toEqual(['docs/*.md']);
  });

  it('takes everything under a directory, wherever it is', () => {
    // A trailing slash with no other slash still matches at any depth, so a
    // `generated/` two packages down is caught the same as one in the root.
    expect(attributeGlobs('generated/')).toEqual(['**/generated/**']);
    expect(attributeGlobs('/generated/')).toEqual(['generated/**']);
  });

  it('reads a bare name as either a file or a directory', () => {
    // Git cannot tell from the pattern either, so both readings are kept.
    expect(attributeGlobs('schema')).toEqual(['**/schema', '**/schema/**']);
  });

  it('ignores an empty pattern rather than matching everything', () => {
    expect(attributeGlobs('   ')).toEqual([]);
    expect(attributeGlobs('/')).toEqual([]);
  });
});

describe('parseGitAttributes', () => {
  it('takes the lines that mention it and skips the rest', () => {
    const rules = parseGitAttributes(
      [
        '# generated files',
        '',
        '* text=auto',
        'vendor/** linguist-vendored',
        'api/*.pb.go linguist-generated=true',
        'schema.json linguist-generated',
      ].join('\n'),
    );

    expect(rules.map((rule) => rule.generated)).toEqual([true, true]);
    expect(rules[0]?.globs).toEqual(['api/*.pb.go']);
  });

  it('reads both spellings of the negative', () => {
    const rules = parseGitAttributes(
      ['a.js -linguist-generated', 'b.js linguist-generated=false'].join('\n'),
    );

    expect(rules.map((rule) => rule.generated)).toEqual([false, false]);
  });

  it('keeps file order, because the last match is the one that counts', () => {
    const rules = parseGitAttributes(
      ['*.lock linguist-generated', 'keep.lock -linguist-generated'].join('\n'),
    );

    expect(rules.map((rule) => rule.globs[0])).toEqual(['**/*.lock', '**/keep.lock']);
  });

  it('skips a macro definition rather than half-understanding it', () => {
    const rules = parseGitAttributes('[attr]binary -diff -merge -text');

    expect(rules).toEqual([]);
  });

  it('survives a file with nothing in it', () => {
    expect(parseGitAttributes('')).toEqual([]);
    expect(parseGitAttributes('\n\n# only a comment\n')).toEqual([]);
  });

  it('takes the last attribute on a line that says both', () => {
    const rules = parseGitAttributes('x.js linguist-generated -linguist-generated');

    expect(rules.map((rule) => rule.generated)).toEqual([false]);
  });
});

describe('what the repository says', () => {
  it('folds a file the repository declares generated', () => {
    const rules = parseGitAttributes('src/schema.ts linguist-generated');

    expect(isGenerated('src/schema.ts', rules)).toBe(true);
    expect(isGenerated('src/app.ts', rules)).toBe(false);
  });

  it('shows a file the repository exempts, pattern or no pattern', () => {
    // The direction that matters most. Somebody went out of their way to say
    // this lockfile is worth reading, and a page that folded it anyway would be
    // overruling the repository with a guess.
    const rules = parseGitAttributes('yarn.lock -linguist-generated');

    expect(isGenerated('yarn.lock', NO_ATTRIBUTES)).toBe(true);
    expect(isGenerated('yarn.lock', rules)).toBe(false);
  });

  it('lets a later line carve an exception out of an earlier one', () => {
    const rules = parseGitAttributes(
      ['api/** linguist-generated', 'api/handwritten.go -linguist-generated'].join('\n'),
    );

    expect(isGenerated('api/service.pb.go', rules)).toBe(true);
    expect(isGenerated('api/handwritten.go', rules)).toBe(false);
  });

  it('falls back to the built-ins for a path it says nothing about', () => {
    const rules = parseGitAttributes('docs/api.md linguist-generated');

    expect(isGenerated('docs/api.md', rules)).toBe(true);
    // Untouched by the file, so the patterns still get their say.
    expect(isGenerated('package-lock.json', rules)).toBe(true);
    expect(isGenerated('src/app.ts', rules)).toBe(false);
  });
});

/**
 * The reviewer's own globs, in the tier below the repository's answer.
 *
 * Three properties, and the middle one is the decision this tier was added to
 * make. They sit *beside* the built-in patterns, not above them and not above
 * `.gitattributes`: every team has one generated path no heuristic could guess,
 * and none of them has a claim on a path the repository has already spoken
 * about. A glob typed on an options page is a standing guess about every
 * repository the reviewer opens; a `.gitattributes` line is a statement about
 * one path by someone who knows what is in it.
 */
describe('what the reviewer says', () => {
  const MINE = ['src/api/**/*.gen.ts', 'proto/**'];

  it('folds a path the built-in list would never have caught', () => {
    expect(isGenerated('src/api/client.gen.ts', NO_ATTRIBUTES)).toBe(false);
    expect(isGenerated('src/api/client.gen.ts', NO_ATTRIBUTES, MINE)).toBe(true);
  });

  it('adds to the built-in list rather than replacing it', () => {
    expect(isGenerated('package-lock.json', NO_ATTRIBUTES, MINE)).toBe(true);
  });

  it('leaves a path neither list names alone', () => {
    expect(isGenerated('src/app.ts', NO_ATTRIBUTES, MINE)).toBe(false);
  });

  it('loses to a repository that exempts the same path', () => {
    // The precedence decision. The reviewer's glob is about every repository
    // they will ever open; this line is about this file.
    const rules = parseGitAttributes('src/api/client.gen.ts -linguist-generated');

    expect(isGenerated('src/api/client.gen.ts', rules, MINE)).toBe(false);
  });

  it('loses to a repository exemption reached through a wildcard, too', () => {
    // Precedence is by tier, not by how specifically the winning rule was
    // written — otherwise a precise glob here would beat a broad line there.
    const rules = parseGitAttributes('src/** -linguist-generated');

    expect(isGenerated('src/api/client.gen.ts', rules, MINE)).toBe(false);
  });

  it('is not needed for a path the repository already declares generated', () => {
    const rules = parseGitAttributes('src/api/client.gen.ts linguist-generated');

    expect(isGenerated('src/api/client.gen.ts', rules, [])).toBe(true);
  });

  it('changes nothing when it is empty, which is the default', () => {
    expect(isGenerated('src/app.ts', NO_ATTRIBUTES, [])).toBe(false);
    expect(isGenerated('yarn.lock', NO_ATTRIBUTES, [])).toBe(true);
  });

  it('is optional, so a caller asking only what the heuristic says need not pass one', () => {
    expect(isGenerated('yarn.lock', NO_ATTRIBUTES)).toBe(true);
  });

  it('can only widen, never narrow', () => {
    // There is no subtractive form and this is what says so. A reviewer who
    // wants one lockfile back opens that card; `Settings.generatedPatterns`
    // explains why that is per file rather than a second pattern list.
    const everything = ['**'];

    expect(isGenerated('src/app.ts', NO_ATTRIBUTES, everything)).toBe(true);
    expect(isGenerated('yarn.lock', NO_ATTRIBUTES, ['nothing-matches-this'])).toBe(true);
  });
});
