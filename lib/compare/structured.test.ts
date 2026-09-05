/**
 * Comparing two JSON documents by structure rather than by line.
 *
 * The two things a text diff of JSON gets wrong are reformatting and array
 * insertion. Re-indenting a file changes every line and nothing at all;
 * inserting one element at the head of an array changes every line after it and
 * one thing. Both are asserted here, because both are why the mode exists.
 */

import { describe, expect, it } from 'vitest';
import { JSON_LIMITS, compareStructured } from './structured';

describe('compareStructured', () => {
  it('finds nothing when only the formatting moved', () => {
    // The headline case. Minified against pretty-printed is a hundred per cent
    // of the lines and none of the meaning.
    const result = compareStructured('{"a":1,"b":[2,3]}', '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}', 'json');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([]);
  });

  it('names a changed value by its path', () => {
    const result = compareStructured('{"server":{"port":80}}', '{"server":{"port":443}}', 'json');

    expect(result.changes).toEqual([
      { path: 'server.port', type: 'changed', before: '80', after: '443' },
    ]);
  });

  it('quotes a key that is not an identifier, so the path can be read back', () => {
    const result = compareStructured('{"a.b":1}', '{"a.b":2}', 'json');

    expect(result.changes[0]?.path).toBe('["a.b"]');
  });

  it('reports an added and a removed key separately', () => {
    const result = compareStructured('{"gone":1}', '{"fresh":2}', 'json');

    expect(result.changes).toEqual([
      { path: 'gone', type: 'removed', before: '1', after: null },
      { path: 'fresh', type: 'added', before: null, after: '2' },
    ]);
  });

  it('distinguishes a null value from an absent key', () => {
    // `{"a": null}` and `{}` are different documents, and a flattener that
    // treats a null leaf as nothing would call them the same.
    expect(compareStructured('{"a":null}', '{}', 'json').changes).toEqual([
      { path: 'a', type: 'removed', before: 'null', after: null },
    ]);
  });

  it('keeps a value that became an empty container visible', () => {
    // An empty object has no leaves under it, so a flattener that emitted
    // nothing for one would report this as `a` merely being removed — losing
    // that the key is still there with nothing in it.
    expect(compareStructured('{"a":1}', '{"a":{}}', 'json').changes).toEqual([
      { path: 'a', type: 'changed', before: '1', after: '{}' },
    ]);
    // Emptying a list is the removal of its elements and nothing more: there
    // is no second fact to report, and reporting one would double-count.
    expect(compareStructured('{"a":[1]}', '{"a":[]}', 'json').changes).toEqual([
      { path: 'a[0]', type: 'removed', before: '1', after: null },
    ]);
  });

  it('does not call every element after an insertion changed', () => {
    // Index by index this is four changes and an append. Aligned, it is one
    // insertion, which is what the author actually did.
    const result = compareStructured('["b","c","d"]', '["a","b","c","d"]', 'json');

    expect(result.changes).toEqual([
      { path: '[0]', type: 'added', before: null, after: '"a"' },
    ]);
  });

  it('aligns an array nested inside an element that was edited', () => {
    // The recursion has to go back through the object walk rather than
    // straight back into the array one, or a list inside a changed element is
    // compared index by index and an insertion into it reads as a rewrite.
    const result = compareStructured(
      '[{"name":"a","tags":["b","c"]}]',
      '[{"name":"a","tags":["new","b","c"]}]',
      'json',
    );

    expect(result.changes).toEqual([
      { path: '[0].tags[0]', type: 'added', before: null, after: '"new"' },
    ]);
  });

  it('recurses into an array element that was edited in place', () => {
    const result = compareStructured(
      '[{"id":1,"name":"old"}]',
      '[{"id":1,"name":"new"}]',
      'json',
    );

    expect(result.changes).toEqual([
      { path: '[0].name', type: 'changed', before: '"old"', after: '"new"' },
    ]);
  });

  it('says which side could not be parsed', () => {
    const result = compareStructured('{"a":1}', '{ not json', 'json');

    expect(result.status).toBe('unparseable');
    expect(result.reason).toMatch(/new/i);
  });

  it('reads the comments in a .json file instead of refusing it', () => {
    // Half the `.json` files in a TypeScript repository are really JSONC —
    // `tsconfig.json`, `.eslintrc.json`, everything under `.vscode/`. This
    // used to answer "not valid JSON" about a file the reviewer can see is
    // fine, which reads as a defect in this page rather than a fact about the
    // format. Trailing commas come along for the same reason.
    const result = compareStructured('{\n  // why\n  "a": 1,\n}', '{"a":2}', 'json');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([
      { path: 'a', type: 'changed', before: '1', after: '2' },
    ]);
  });

  it('names the syntax it could not read, so the sentence is about this file', () => {
    const result = compareStructured('a: 1\n', 'a: [1\n', 'yaml');

    expect(result.status).toBe('unparseable');
    expect(result.reason).toMatch(/YAML/);
    expect(result.reason).not.toMatch(/JSON/);
  });

  it('gives up above the node budget rather than walking a generated file', () => {
    // A `package-lock.json` is hundreds of thousands of leaves. Flattening it
    // to find that four versions moved is minutes of main thread for an answer
    // nobody waited for.
    const wide = JSON.stringify(
      Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, index])),
    );
    const result = compareStructured(wide, wide, 'json', { ...JSON_LIMITS, maxNodes: 50 });

    expect(result.status).toBe('too-large');
  });

  it('stops listing changes at the cap and says it did', () => {
    const before = JSON.stringify(
      Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, 0])),
    );
    const after = JSON.stringify(
      Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, 1])),
    );
    const result = compareStructured(before, after, 'json', { ...JSON_LIMITS, maxChanges: 10 });

    expect(result.changes).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('compares an added file against nothing', () => {
    const result = compareStructured(null, '{"a":1}', 'json');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([
      { path: 'a', type: 'added', before: null, after: '1' },
    ]);
  });
});


describe('the other two syntaxes', () => {
  it('compares YAML by structure, so re-indenting shows as nothing', () => {
    // The failure that motivated this mode, in the format that suffers it
    // worst: YAML indentation is semantic, so a reformat rewrites every line
    // of a file in which nothing but one port moved.
    const before = `server:
  port: 80
  hosts:
    - a
    - b
`;
    const after = `server:
    port: 443
    hosts:
        - a
        - b
`;

    const result = compareStructured(before, after, 'yaml');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([
      { path: 'server.port', type: 'changed', before: '80', after: '443' },
    ]);
  });

  it('does not call every entry after a YAML insertion changed', () => {
    const result = compareStructured(
      `a:
  - b
  - c
`,
      `a:
  - new
  - b
  - c
`,
      'yaml',
    );

    expect(result.changes).toEqual([
      { path: 'a[0]', type: 'added', before: null, after: '"new"' },
    ]);
  });

  it('compares TOML by structure, so promoting a key to a table shows as nothing', () => {
    // Inline table to section header is the TOML reformat, and every line of
    // it changes while one version is the only thing that moved.
    const before = `name = "x"
deps = { serde = "1.0" }
`;
    const after = `name = "x"

[deps]
serde = "1.1"
`;

    const result = compareStructured(before, after, 'toml');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([
      { path: 'deps.serde', type: 'changed', before: '"1.0"', after: '"1.1"' },
    ]);
  });

  it('reports a TOML file that will not parse rather than half of one', () => {
    const result = compareStructured('a = 1\n', 'a = \n', 'toml');

    expect(result.status).toBe('unparseable');
    expect(result.reason).toMatch(/TOML/);
  });
});
