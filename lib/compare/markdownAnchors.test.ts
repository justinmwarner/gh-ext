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
  it('names a side and the range the block occupies', () => {
    expect(anchorValue(NONCE, 'RIGHT', 12, 14)).toBe(`${NONCE}-R12-14`);
    expect(anchorValue(NONCE, 'LEFT', 3, 7)).toBe(`${NONCE}-L3-7`);
  });

  // One shape, not two. A block on a single line repeats the number rather
  // than dropping the second half, so there is one thing to parse.
  it('writes a one-line block as a range of one', () => {
    expect(anchorValue(NONCE, 'LEFT', 3, 3)).toBe(`${NONCE}-L3-3`);
  });
});

describe('parseAnchor', () => {
  it('reads back what anchorValue wrote', () => {
    expect(parseAnchor(anchorValue(NONCE, 'RIGHT', 12, 14), NONCE)).toEqual({
      side: 'RIGHT',
      line: 12,
      endLine: 14,
    });
    expect(parseAnchor(anchorValue(NONCE, 'LEFT', 3, 3), NONCE)).toEqual({
      side: 'LEFT',
      line: 3,
      endLine: 3,
    });
  });

  // The forgery case, and the reason the nonce exists. A `.md` file in a pull
  // request can write `data-md-anchor` itself; it cannot know a value minted
  // after it was authored.
  it('refuses a value bearing another nonce', () => {
    expect(parseAnchor(anchorValue('other-nonce', 'RIGHT', 12, 14), NONCE)).toBeNull();
  });

  it.each([
    '',
    NONCE,
    `${NONCE}-`,
    `${NONCE}-R`,
    `${NONCE}-X1-2`,
    `${NONCE}-R0-2`,
    `${NONCE}-R1-0`,
    `${NONCE}-R-4`,
  ])('refuses %p', (value) => {
    expect(parseAnchor(value, NONCE)).toBeNull();
  });

  // A range needs both ends. The single-line form was the obvious kindness and
  // is what this format deliberately does not have, so a value carrying it is
  // one nothing in this codebase wrote.
  it.each([`${NONCE}-R12`, `${NONCE}-R12-`, `${NONCE}-R12-14-16`])(
    'refuses %p, which is not a whole range',
    (value) => {
      expect(parseAnchor(value, NONCE)).toBeNull();
    },
  );

  // A range that ends before it starts contains nothing, so believing it would
  // cost a block its comment button by a route no one could see. Refused on
  // arrival instead, which is what lets every caller take `line <= endLine`.
  it('refuses a range that runs backwards', () => {
    expect(parseAnchor(`${NONCE}-R9-2`, NONCE)).toBeNull();
  });

  // A nonce nobody minted matches nothing. Without the guard the prefix is a
  // bare `-`, and every anchor a pull request wrote by hand would validate.
  it('refuses everything when there is no nonce to check against', () => {
    expect(parseAnchor('-R1', '')).toBeNull();
    expect(parseAnchor('', '')).toBeNull();
  });

  // The nonce is a UUID and a UUID has hyphens in it, so the split between the
  // nonce and the rest cannot be "at the first hyphen".
  it('is not confused by hyphens inside the nonce', () => {
    expect(parseAnchor(`${NONCE}-L7-9`, NONCE)).toEqual({
      side: 'LEFT',
      line: 7,
      endLine: 9,
    });
    expect(parseAnchor('b3f1c0de-L7-9', NONCE)).toBeNull();
  });

  // `Number` would accept every one of these. The digits are read from an
  // attribute on a document a stranger wrote, so the test has to be the strict
  // one rather than the convenient one. Both ends of the range, because a check
  // applied to the start alone leaves the end reading whatever `Number` says.
  it.each([
    `${NONCE}-R1e3-5`,
    `${NONCE}-R 1-5`,
    `${NONCE}-R1.0-5`,
    `${NONCE}-R+1-5`,
    `${NONCE}-R01-5`,
    `${NONCE}-R1-5e3`,
    `${NONCE}-R1- 5`,
    `${NONCE}-R1-5.0`,
    `${NONCE}-R1-+5`,
    `${NONCE}-R1-05`,
  ])('refuses %p, which Number would have accepted', (value) => {
    expect(parseAnchor(value, NONCE)).toBeNull();
  });
});
