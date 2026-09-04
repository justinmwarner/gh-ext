/**
 * Reading an image's dimensions out of its header bytes.
 *
 * This exists because of a scroll bug, not because anyone wanted an image
 * parser. The comparison stage draws both images absolutely positioned, so it
 * contributes no height of its own and stays **zero pixels tall** until the
 * browser has decoded something — at which point the card inflates by the full
 * height of the image, underneath a reviewer who is already scrolling through
 * it. In a virtualized column that reads as the scroll sticking and bouncing.
 *
 * Every format below states its size in the first few dozen bytes, long before
 * a decoder is involved. Knowing it at first paint is the difference between a
 * card that is the right size immediately and one that grows once it is on
 * screen.
 *
 * The fixtures are hand-built headers rather than real files: they are exact,
 * they document the layout, and a test that needs a 300 kB PNG to prove an
 * offset is a test nobody will maintain.
 */

import { describe, expect, it } from 'vitest';
import { imageSize } from './imageSize';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const ascii = (text: string): Uint8Array =>
  new Uint8Array([...text].map((character) => character.charCodeAt(0)));

const be32 = (value: number): Uint8Array =>
  bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

const le16 = (value: number): Uint8Array => bytes(value & 0xff, (value >>> 8) & 0xff);

const le32 = (value: number): Uint8Array =>
  bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);

const png = (width: number, height: number): Uint8Array =>
  concat(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    be32(13),
    ascii('IHDR'),
    be32(width),
    be32(height),
    bytes(8, 6, 0, 0, 0),
  );

const gif = (width: number, height: number, version = '89a'): Uint8Array =>
  concat(ascii(`GIF${version}`), le16(width), le16(height), bytes(0x70, 0, 0));

const bmp = (width: number, height: number): Uint8Array =>
  concat(
    ascii('BM'),
    le32(70),
    le32(0),
    le32(54),
    le32(40),
    le32(width),
    // Signed: a positive height is a bottom-up bitmap, a negative one top-down.
    le32(height >>> 0),
    le16(1),
    le16(24),
  );

const jpeg = (width: number, height: number, marker = 0xc0): Uint8Array =>
  concat(
    bytes(0xff, 0xd8),
    // A comment segment first, so the scan has to skip something to get there.
    bytes(0xff, 0xfe),
    bytes(0x00, 0x06, 0x68, 0x69, 0x21, 0x00),
    bytes(0xff, marker),
    bytes(0x00, 0x11, 0x08),
    bytes((height >>> 8) & 0xff, height & 0xff),
    bytes((width >>> 8) & 0xff, width & 0xff),
    bytes(3),
  );

const webpVp8x = (width: number, height: number): Uint8Array =>
  concat(
    ascii('RIFF'),
    le32(30),
    ascii('WEBP'),
    ascii('VP8X'),
    le32(10),
    bytes(0, 0, 0, 0),
    // Canvas dimensions are stored minus one, 24 bits little-endian each.
    bytes((width - 1) & 0xff, ((width - 1) >>> 8) & 0xff, ((width - 1) >>> 16) & 0xff),
    bytes((height - 1) & 0xff, ((height - 1) >>> 8) & 0xff, ((height - 1) >>> 16) & 0xff),
  );

describe('imageSize', () => {
  it('reads a PNG from its IHDR', () => {
    expect(imageSize(png(1600, 1200))).toEqual({ width: 1600, height: 1200 });
  });

  it('reads a GIF, which counts little-endian where PNG counts big', () => {
    expect(imageSize(gif(100, 80))).toEqual({ width: 100, height: 80 });
  });

  it('reads the older GIF version too', () => {
    expect(imageSize(gif(12, 34, '87a'))).toEqual({ width: 12, height: 34 });
  });

  it('reads a BMP', () => {
    expect(imageSize(bmp(32, 32))).toEqual({ width: 32, height: 32 });
  });

  it('reports a top-down BMP’s height as a size, not as a direction', () => {
    // A negative height means the rows are stored top to bottom. It is still
    // that many rows, and a negative aspect ratio would collapse the stage.
    expect(imageSize(bmp(32, -20))).toEqual({ width: 32, height: 20 });
  });

  it('scans past a JPEG’s other segments to reach the frame header', () => {
    expect(imageSize(jpeg(240, 160))).toEqual({ width: 240, height: 160 });
  });

  it('reads a progressive JPEG, which uses a different frame marker', () => {
    expect(imageSize(jpeg(240, 160, 0xc2))).toEqual({ width: 240, height: 160 });
  });

  it('does not mistake a JPEG’s huffman table for a frame header', () => {
    // 0xC4 sits in the middle of the SOF range and is not one.
    expect(imageSize(jpeg(240, 160, 0xc4))).toBeNull();
  });

  it('reads an extended WebP, whose dimensions are stored minus one', () => {
    expect(imageSize(webpVp8x(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('has no answer for a format it does not know', () => {
    // AVIF and ICO among them. The caller reserves a default box instead, which
    // is worse than the right box and much better than none.
    expect(imageSize(ascii('ftypavif not really'))).toBeNull();
  });

  it('has no answer for bytes that run out mid-header', () => {
    // A truncated download must not read past the end and invent a dimension.
    expect(imageSize(png(100, 100).slice(0, 18))).toBeNull();
  });

  it('has no answer for an empty file', () => {
    expect(imageSize(new Uint8Array())).toBeNull();
  });

  it('refuses a dimension of zero rather than returning one', () => {
    // Zero is not a size, and an `aspect-ratio` built from it collapses the
    // stage to nothing — which is the exact bug this function exists to stop.
    expect(imageSize(png(0, 100))).toBeNull();
  });
});
