/**
 * The pull request description.
 *
 * GitHub sends it as `bodyHTML`. This project injects no HTML and takes no
 * sanitizer dependency, so the markup is reduced to text and rendered as text —
 * formatting is lost, and that is the trade being made deliberately.
 */

import { describe, expect, it } from 'vitest';
import { htmlToParagraphs } from './prBody';

describe('htmlToParagraphs', () => {
  it('returns nothing for an empty description', () => {
    expect(htmlToParagraphs('')).toEqual([]);
    expect(htmlToParagraphs(null)).toEqual([]);
    expect(htmlToParagraphs(undefined)).toEqual([]);
  });

  it('keeps the words and drops the tags', () => {
    const parts = htmlToParagraphs('<p>Caches the diff on <code>headRefOid</code>.</p>');

    expect(parts).toEqual(['Caches the diff on headRefOid.']);
  });

  it('never leaves markup in the text it returns', () => {
    const parts = htmlToParagraphs('<p>Fixes <a href="/x">#12</a></p>');

    expect(parts.join('\n')).not.toContain('<');
    expect(parts.join('\n')).toContain('#12');
  });

  it('decodes the entities GitHub escapes', () => {
    const parts = htmlToParagraphs('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>');

    expect(parts).toEqual(['a & b <c> "d"']);
  });

  it('keeps blocks apart instead of running their words together', () => {
    const parts = htmlToParagraphs('<p>First.</p><p>Second.</p>');

    expect(parts).toEqual(['First.', 'Second.']);
  });

  it('breaks a list into one line per item', () => {
    const parts = htmlToParagraphs('<ul><li>one</li><li>two</li></ul>');

    expect(parts.join('\n')).toContain('one');
    expect(parts.join('\n')).toContain('two');
    expect(parts.join('\n')).not.toBe('onetwo');
  });

  it('honours a line break', () => {
    const parts = htmlToParagraphs('<p>one<br />two</p>');

    expect(parts.join(' ')).not.toContain('onetwo');
  });

  it('discards script and style content rather than reading it aloud', () => {
    const parts = htmlToParagraphs(
      '<p>hello</p><script>alert(1)</script><style>p{color:red}</style>',
    );

    expect(parts.join('\n')).toBe('hello');
  });

  it('collapses the blank runs a long description leaves behind', () => {
    const parts = htmlToParagraphs('<p>one</p><div></div><div></div><p>two</p>');

    expect(parts).toEqual(['one', 'two']);
  });
});
