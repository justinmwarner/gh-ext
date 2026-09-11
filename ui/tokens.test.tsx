/**
 * The two rules that keep a chosen theme from being a patchwork.
 *
 * Neither is about React, and neither renders anything. They are here because
 * this is where `tokens.css` lives, and because they are the only mechanical
 * check on a property that is otherwise a matter of somebody remembering.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHROME_TOKENS } from '@/lib/theme/tokens';

/** Repository-relative, which is what `process.cwd()` is under vitest. */
const read = (file: string): string =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

/** Every `--name:` declared at the top level of `tokens.css`. */
function declaredTokens(): string[] {
  return [...read('ui/tokens.css').matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((match) => match[1]!);
}

describe('ui/tokens.css and lib/theme/tokens.ts', () => {
  /**
   * The contract that makes the feature whole rather than mostly whole.
   *
   * A token declared here but absent from `CHROME_TOKENS` has no themed value,
   * so it keeps its Primer pair while everything around it turns into the
   * reviewer's theme — one grey control on a Dracula page, with nothing to say
   * why. One in `CHROME_TOKENS` but not here is a value derived, stored for all
   * seventy-five themes and never read.
   */
  it('declare exactly the same tokens', () => {
    expect([...declaredTokens()].sort()).toEqual([...CHROME_TOKENS].sort());
  });

  it('gives every token both halves of a light-dark pair, or no pair at all', () => {
    // A single-value colour inside `light-dark()` is a bug in one of the two
    // themes; DESIGN.md states the rule and this is the check for it. Flat
    // values are allowed — the `--on-*` labels are white in both modes — but a
    // half-written pair is not.
    //
    // Declaration lines only. The prose above the rule names `light-dark()`
    // several times while explaining it, and those are not declarations.
    const declarations = read('ui/tokens.css').matchAll(/^\s{2}--[a-z0-9-]+:([^;]*);/gm);
    for (const [, value] of declarations) {
      const call = /light-dark\(([^)]*)\)/.exec(value!);
      if (call === null) continue;
      expect(call[1]!.split(','), value!.trim()).toHaveLength(2);
    }
  });
});

/**
 * Colour literals outside `tokens.css`.
 *
 * This used to be a style rule with a comment attached — a hex in a stylesheet
 * was a duplicate of a value that already had a name, and duplicates drift.
 * It is now a correctness rule: a literal cannot follow the reviewer's theme,
 * so it is a patch of Primer left behind on a themed page.
 */
describe('the surfaces', () => {
  const SURFACES = [
    'entrypoints/review/style.css',
    'entrypoints/options/style.css',
    'entrypoints/content/card.ts',
  ];

  /**
   * The one literal that is still correct.
   *
   * The plate behind an image diff's difference blend. It is an operand of
   * `mix-blend-mode`, not a surface: the blend is defined against black, and
   * "black" does not become "whatever the theme's page colour is" because the
   * reviewer picked Solarized.
   */
  const ALLOWED = new Set(['entrypoints/review/style.css: background: #000000;']);

  /**
   * Comments are stripped first, and that is not a loophole.
   *
   * The rule is about declarations — colours that reach a pixel. Prose *about* a
   * colour is how this repository explains why a value is what it is, and
   * several of the notes left by this change quote the literals they replaced so
   * the next reader can see what moved. Scanning those would make the test
   * punish the documentation it wants.
   */
  const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

  it.each(SURFACES)('%s names its colours rather than spelling them', (file) => {
    const found = [
      ...withoutComments(read(file)).matchAll(/^\s*([a-z-]+:[^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*;)/gm),
    ]
      .map((match) => `${file}: ${match[1]!.trim()}`)
      .filter((line) => !ALLOWED.has(line));
    expect(found).toEqual([]);
  });
});
