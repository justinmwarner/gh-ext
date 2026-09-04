/**
 * An image's dimensions, read from its header rather than from a decoder.
 *
 * This exists because of a scroll bug. `ImageCompare` draws both images
 * absolutely positioned so they can share one coordinate space, which means the
 * stage contributes no height of its own — it is **zero pixels tall until the
 * browser has decoded something**, and then it inflates by the full height of
 * the image. That happens after the card has mounted, which in a virtualized
 * column means underneath a reviewer who is already scrolling through it: the
 * scroll sticks, bounces, and eventually gets past.
 *
 * Every format here states its size in the first few dozen bytes. Reading it at
 * the moment the bytes arrive is the difference between a card that is the
 * right size from its first paint and one that grows once it is on screen.
 *
 * Returns null rather than guessing. The caller reserves a default box for
 * anything unrecognised, which is worse than the right box and far better than
 * a box of no height at all.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** Both dimensions or neither. A zero would collapse the stage it sizes. */
const sized = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

const starts = (bytes: Uint8Array, ...signature: number[]): boolean =>
  signature.length <= bytes.length && signature.every((byte, at) => bytes[at] === byte);

const ascii = (bytes: Uint8Array, at: number, text: string): boolean =>
  at + text.length <= bytes.length &&
  [...text].every((character, i) => bytes[at + i] === character.charCodeAt(0));

const be32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 24) |
  ((bytes[at + 1] ?? 0) << 16) |
  ((bytes[at + 2] ?? 0) << 8) |
  (bytes[at + 3] ?? 0);

const be16 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);

const le16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);

const le24 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);

/** Signed, because a BMP stores a top-down bitmap as a negative height. */
const le32s = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) |
    ((bytes[at + 1] ?? 0) << 8) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 3] ?? 0) << 24)) |
  0;

/** `IHDR` is required to be the first chunk, so the offsets are fixed. */
function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) return null;
  return sized(be32(bytes, 16), be32(bytes, 20));
}

function gifSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 10) return null;
  return sized(le16(bytes, 6), le16(bytes, 8));
}

function bmpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 26) return null;
  // A negative height means the rows are stored top to bottom. It is still
  // that many rows, and a negative aspect ratio would collapse the stage.
  return sized(le32s(bytes, 18), Math.abs(le32s(bytes, 22)));
}

/**
 * Frame markers, which is the part of JPEG that catches people out.
 *
 * `0xC0`–`0xCF` looks like a contiguous range of start-of-frame markers and is
 * not: `0xC4` is a Huffman table, `0xC8` is reserved, and `0xCC` is arithmetic
 * coding conditioning. Reading dimensions out of any of those returns whatever
 * happened to be in those bytes.
 */
const isFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  // Bounded by the buffer, and every step advances by at least two, so this
  // cannot spin on malformed input.
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    // Padding and standalone markers carry no length to skip.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    if (isFrameMarker(marker)) {
      return at + 9 <= bytes.length
        ? sized(be16(bytes, at + 7), be16(bytes, at + 5))
        : null;
    }
    const length = be16(bytes, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * WebP, which stores its size three different ways depending on the chunk.
 *
 * `VP8X` is the extended form and states the canvas directly, minus one.
 * `VP8 ` is lossy, and the dimensions sit inside the keyframe header after a
 * three-byte start code. `VP8L` is lossless and packs 14 bits each, also minus
 * one, straight after its one-byte signature.
 */
function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30 || !ascii(bytes, 8, 'WEBP')) return null;

  if (ascii(bytes, 12, 'VP8X')) {
    return sized(le24(bytes, 24) + 1, le24(bytes, 27) + 1);
  }

  if (ascii(bytes, 12, 'VP8L')) {
    const packed =
      (bytes[21] ?? 0) |
      ((bytes[22] ?? 0) << 8) |
      ((bytes[23] ?? 0) << 16) |
      ((bytes[24] ?? 0) << 24);
    return sized((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
  }

  if (ascii(bytes, 12, 'VP8 ')) {
    // 14 bits of dimension and 2 of scale, which is not part of the size.
    return sized(le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff);
  }

  return null;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return pngSize(bytes);
  if (ascii(bytes, 0, 'GIF8')) return gifSize(bytes);
  if (starts(bytes, 0xff, 0xd8)) return jpegSize(bytes);
  if (ascii(bytes, 0, 'BM')) return bmpSize(bytes);
  if (ascii(bytes, 0, 'RIFF')) return webpSize(bytes);
  // AVIF and ICO among the rest. Saying nothing is the honest answer.
  return null;
}
