/**
 * Comparing two JSON documents by structure rather than by line.
 *
 * The two things a text diff of JSON gets wrong are reformatting and array
 * insertion. Re-indenting a file changes every line and nothing at all;
 * inserting one element at the head of an array changes every line after it and
 * one thing. Both are asserted here, because both are why the mode exists.
 */

import { describe, expect, it } from 'vitest';
import { JSON_LIMITS, compareJson, formatJson } from './structured';

describe('formatJson', () => {
  it('re-indents both sides the same way', () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns null for something that is not JSON', () => {
    // The caller needs to say "this could not be read" rather than show an
    // empty diff, which reads as "nothing changed".
    expect(formatJson('{oops')).toBeNull();
  });

  it('leaves the key order alone', () => {
    // Sorting would hide a reordering, and key order is meaningful in enough
    // documents — a `files` list, an ordered pipeline — that hiding it is a
    // decision this mode has no business making.
    expect(formatJson('{"b":1,"a":2}')).toContain('"b"');
    expect(formatJson('{"b":1,"a":2}')?.indexOf('"b"')).toBeLessThan(
      formatJson('{"b":1,"a":2}')?.indexOf('"a"') ?? 0,
    );
  });
});

describe('compareJson', () => {
  it('finds nothing when only the formatting moved', () => {
    // The headline case. Minified against pretty-printed is a hundred per cent
    // of the lines and none of the meaning.
    const result = compareJson('{"a":1,"b":[2,3]}', '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([]);
  });

  it('names a changed value by its path', () => {
    const result = compareJson('{"server":{"port":80}}', '{"server":{"port":443}}');

    expect(result.changes).toEqual([
      { path: 'server.port', type: 'changed', before: '80', after: '443' },
    ]);
  });

  it('quotes a key that is not an identifier, so the path can be read back', () => {
    const result = compareJson('{"a.b":1}', '{"a.b":2}');

    expect(result.changes[0]?.path).toBe('["a.b"]');
  });

  it('reports an added and a removed key separately', () => {
    const result = compareJson('{"gone":1}', '{"fresh":2}');

    expect(result.changes).toEqual([
      { path: 'gone', type: 'removed', before: '1', after: null },
      { path: 'fresh', type: 'added', before: null, after: '2' },
    ]);
  });

  it('distinguishes a null value from an absent key', () => {
    // `{"a": null}` and `{}` are different documents, and a flattener that
    // treats a null leaf as nothing would call them the same.
    expect(compareJson('{"a":null}', '{}').changes).toEqual([
      { path: 'a', type: 'removed', before: 'null', after: null },
    ]);
  });

  it('keeps a value that became an empty container visible', () => {
    // An empty object has no leaves under it, so a flattener that emitted
    // nothing for one would report this as `a` merely being removed — losing
    // that the key is still there with nothing in it.
    expect(compareJson('{"a":1}', '{"a":{}}').changes).toEqual([
      { path: 'a', type: 'changed', before: '1', after: '{}' },
    ]);
    // Emptying a list is the removal of its elements and nothing more: there
    // is no second fact to report, and reporting one would double-count.
    expect(compareJson('{"a":[1]}', '{"a":[]}').changes).toEqual([
      { path: 'a[0]', type: 'removed', before: '1', after: null },
    ]);
  });

  it('does not call every element after an insertion changed', () => {
    // Index by index this is four changes and an append. Aligned, it is one
    // insertion, which is what the author actually did.
    const result = compareJson('["b","c","d"]', '["a","b","c","d"]');

    expect(result.changes).toEqual([
      { path: '[0]', type: 'added', before: null, after: '"a"' },
    ]);
  });

  it('aligns an array nested inside an element that was edited', () => {
    // The recursion has to go back through the object walk rather than
    // straight back into the array one, or a list inside a changed element is
    // compared index by index and an insertion into it reads as a rewrite.
    const result = compareJson(
      '[{"name":"a","tags":["b","c"]}]',
      '[{"name":"a","tags":["new","b","c"]}]',
    );

    expect(result.changes).toEqual([
      { path: '[0].tags[0]', type: 'added', before: null, after: '"new"' },
    ]);
  });

  it('recurses into an array element that was edited in place', () => {
    const result = compareJson(
      '[{"id":1,"name":"old"}]',
      '[{"id":1,"name":"new"}]',
    );

    expect(result.changes).toEqual([
      { path: '[0].name', type: 'changed', before: '"old"', after: '"new"' },
    ]);
  });

  it('says which side could not be parsed', () => {
    const result = compareJson('{"a":1}', '{ not json');

    expect(result.status).toBe('unparseable');
    expect(result.reason).toMatch(/new/i);
  });

  it('gives up above the node budget rather than walking a generated file', () => {
    // A `package-lock.json` is hundreds of thousands of leaves. Flattening it
    // to find that four versions moved is minutes of main thread for an answer
    // nobody waited for.
    const wide = JSON.stringify(
      Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, index])),
    );
    const result = compareJson(wide, wide, { ...JSON_LIMITS, maxNodes: 50 });

    expect(result.status).toBe('too-large');
  });

  it('stops listing changes at the cap and says it did', () => {
    const before = JSON.stringify(
      Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, 0])),
    );
    const after = JSON.stringify(
      Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, 1])),
    );
    const result = compareJson(before, after, { ...JSON_LIMITS, maxChanges: 10 });

    expect(result.changes).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('compares an added file against nothing', () => {
    const result = compareJson(null, '{"a":1}');

    expect(result.status).toBe('ok');
    expect(result.changes).toEqual([
      { path: 'a', type: 'added', before: null, after: '1' },
    ]);
  });
});
