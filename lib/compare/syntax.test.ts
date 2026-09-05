/**
 * Reading the three syntaxes that answer to the same walker.
 *
 * The structural comparison never cared that its input was JSON — it cares
 * that it is a tree of plain values. YAML and TOML are the same tree written
 * differently, and both have the failure that motivated the mode in the first
 * place: reindent a block, reorder a table, and the text diff repaints
 * everything while nothing moved.
 *
 * So this is the seam. Three parsers in, one plain value out, and one honest
 * sentence when a parser refuses.
 */

import { describe, expect, it } from 'vitest';
import { formatStructured, parseStructured } from './syntax';

describe('parsing', () => {
  it('reads JSON that has comments in it', () => {
    // The whole of decision 3. `tsconfig.json`, `.eslintrc.json` and
    // everything under `.vscode/` are JSONC, `JSON.parse` refuses them, and
    // refusing the most-edited config file in a TypeScript repository made
    // this view look broken on the one file it should be best at.
    const parsed = parseStructured('{\n  // why\n  "a": 1,\n}', 'json');

    expect(parsed).toEqual({ ok: true, value: { a: 1 } });
  });

  it('still reads ordinary JSON', () => {
    expect(parseStructured('{"a":[1,{"b":null}]}', 'json')).toEqual({
      ok: true,
      value: { a: [1, { b: null }] },
    });
  });

  it('reads YAML into the same plain values', () => {
    const parsed = parseStructured('# note\na: 1\nb:\n  - x\n  - y\n', 'yaml');

    expect(parsed).toEqual({ ok: true, value: { a: 1, b: ['x', 'y'] } });
  });

  it('reads TOML into the same plain values', () => {
    const parsed = parseStructured('# note\ntitle = "x"\n\n[a]\nb = 1\n', 'toml');

    expect(parsed).toEqual({ ok: true, value: { title: 'x', a: { b: 1 } } });
  });
});

describe('refusing', () => {
  it('refuses broken JSON rather than returning half a document', () => {
    // The comment-tolerant parser is recovering by nature: handed `{ not json`
    // it returns `{}` and a list of errors. Reading the value and ignoring the
    // errors would report every key in the file as deleted.
    const parsed = parseStructured('{ not json', 'json');

    expect(parsed.ok).toBe(false);
  });

  it('refuses broken YAML', () => {
    expect(parseStructured('a:\n\t- b\n  c: {', 'yaml').ok).toBe(false);
  });

  it('refuses broken TOML', () => {
    expect(parseStructured('a = ', 'toml').ok).toBe(false);
  });

  it('says where the parser gave up, not just that it did', () => {
    // "Not valid YAML" on a four-hundred-line manifest is a shrug. The parsers
    // all know the line; passing it through costs nothing and is the whole
    // difference between a reviewer fixing it and a reviewer guessing.
    const parsed = parseStructured('a: 1\nb: [1, 2\nc: 3\n', 'yaml');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.detail.length).toBeGreaterThan(0);
  });
});

describe('formatting', () => {
  it('re-indents JSON without throwing its comments away', () => {
    // The formatted view exists so that a reformatting shows as nothing. A
    // formatter that dropped comments would make a comment-only change show as
    // nothing too, which is a different and much worse claim.
    const out = formatStructured('{\n// why\n"a":   1\n}', 'json');

    expect(out).toContain('// why');
    expect(out).toContain('"a": 1');
  });

  it('re-indents YAML without throwing its comments away', () => {
    const out = formatStructured('# top\na:   1\nb:\n  -   x\n', 'yaml');

    expect(out).toContain('# top');
    expect(out).toContain('a: 1');
  });

  it('has nothing to offer for a document it cannot read', () => {
    expect(formatStructured('{ not json', 'json')).toBeNull();
    expect(formatStructured('a: [1', 'yaml')).toBeNull();
  });
});
