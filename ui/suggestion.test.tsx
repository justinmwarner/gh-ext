/**
 * Suggestion blocks, in both directions.
 *
 * Writing one is a formatting job. Reading one is the interesting half: a
 * suggestion arrives inside an ordinary comment body, and showing it as the
 * fenced text it literally is hides the proposed result behind punctuation.
 */

import { describe, expect, it } from 'vitest';
import { splitBody, suggestionBlock } from './suggestion';

describe('suggestionBlock', () => {
  it('fences the selected lines as a suggestion', () => {
    expect(suggestionBlock(['const a = 1;', 'const b = 2;'])).toBe(
      '```suggestion\nconst a = 1;\nconst b = 2;\n```\n',
    );
  });

  it('produces an empty suggestion when there is nothing to seed it with', () => {
    expect(suggestionBlock([])).toBe('```suggestion\n\n```\n');
  });

  it('keeps a longer fence than any fence inside the selected lines', () => {
    // Selected code containing ``` would close the block early and turn the
    // rest of the suggestion into prose.
    expect(suggestionBlock(['```', 'x'])).toBe('````suggestion\n```\nx\n````\n');
  });
});

describe('splitBody', () => {
  it('leaves a body with no suggestion as one piece of text', () => {
    expect(splitBody('Just a comment.')).toEqual([
      { kind: 'text', text: 'Just a comment.' },
    ]);
  });

  it('pulls the proposed result out of a suggestion block', () => {
    const body = 'Try this:\n\n```suggestion\nconst a = 1;\n```\n\nThanks.';

    expect(splitBody(body)).toEqual([
      { kind: 'text', text: 'Try this:' },
      { kind: 'suggestion', code: 'const a = 1;' },
      { kind: 'text', text: 'Thanks.' },
    ]);
  });

  it('reads a suggestion that is the whole body', () => {
    expect(splitBody('```suggestion\nx\ny\n```')).toEqual([
      { kind: 'suggestion', code: 'x\ny' },
    ]);
  });

  it('leaves an ordinary fenced code block alone', () => {
    const body = '```ts\nconst a = 1;\n```';

    expect(splitBody(body)).toEqual([{ kind: 'text', text: body }]);
  });

  it('reads a suggestion fenced with more than three backticks', () => {
    expect(splitBody('````suggestion\n```\n````')).toEqual([
      { kind: 'suggestion', code: '```' },
    ]);
  });

  it('treats an unterminated suggestion fence as text', () => {
    const body = '```suggestion\nconst a = 1;';

    expect(splitBody(body)).toEqual([{ kind: 'text', text: body }]);
  });
});
