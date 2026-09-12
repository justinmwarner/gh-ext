/**
 * The anchor a rendered block carries, and the forgery it has to refuse.
 *
 * Two halves, and the second is the one worth reading. Round-tripping a value
 * is arithmetic; refusing a value somebody else minted is the reason the format
 * has a nonce in it at all. The cases below are the shapes a `.md` file in a
 * pull request can actually write into its own raw HTML.
 */

import { describe, expect, it } from 'vitest';
import { anchorValue, parseAnchor } from './markdownAnchors';

const NONCE = 'b3f1c0de-0000-4000-8000-000000000000';

describe('anchorValue', () => {
  it('names a side and a line', () => {
    expect(anchorValue(NONCE, 'RIGHT', 12)).toBe(`${NONCE}-R12`);
    expect(anchorValue(NONCE, 'LEFT', 3)).toBe(`${NONCE}-L3`);
  });
});

describe('parseAnchor', () => {
  it('reads back what anchorValue wrote', () => {
    expect(parseAnchor(anchorValue(NONCE, 'RIGHT', 12), NONCE)).toEqual({
      side: 'RIGHT',
      line: 12,
    });
  });

  // The forgery case, and the reason the nonce exists. A `.md` file in a pull
  // request can write `data-md-anchor` itself; it cannot know a value minted
  // after it was authored.
  it('refuses a value bearing another nonce', () => {
    expect(parseAnchor(anchorValue('other-nonce', 'RIGHT', 12), NONCE)).toBeNull();
  });

  it.each(['', NONCE, `${NONCE}-`, `${NONCE}-R`, `${NONCE}-X1`, `${NONCE}-R0`, `${NONCE}-R-4`])(
    'refuses %p',
    (value) => {
      expect(parseAnchor(value, NONCE)).toBeNull();
    },
  );

  // A nonce nobody minted matches nothing. Without the guard the prefix is a
  // bare `-`, and every anchor a pull request wrote by hand would validate.
  it('refuses everything when there is no nonce to check against', () => {
    expect(parseAnchor('-R1', '')).toBeNull();
    expect(parseAnchor('', '')).toBeNull();
  });

  // The nonce is a UUID and a UUID has hyphens in it, so the split between the
  // nonce and the rest cannot be "at the first hyphen".
  it('is not confused by hyphens inside the nonce', () => {
    expect(parseAnchor(`${NONCE}-L7`, NONCE)).toEqual({ side: 'LEFT', line: 7 });
    expect(parseAnchor('b3f1c0de-L7', NONCE)).toBeNull();
  });

  // `Number` would accept every one of these. The digits are read from an
  // attribute on a document a stranger wrote, so the test has to be the strict
  // one rather than the convenient one.
  it.each([`${NONCE}-R1e3`, `${NONCE}-R 1`, `${NONCE}-R1.0`, `${NONCE}-R+1`, `${NONCE}-R01`])(
    'refuses %p, which Number would have accepted',
    (value) => {
      expect(parseAnchor(value, NONCE)).toBeNull();
    },
  );
});
