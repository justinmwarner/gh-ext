# -*- coding: utf-8 -*-
"""The one image fixture the drawing API cannot make: an animated GIF.

`generate-images.ps1` builds every other image through System.Drawing, which
writes exactly one frame however many you hand it — so `animation.gif` was a
still, and a still GIF tests nothing a PNG does not.

The encoder is here rather than a dependency because this repository has none,
and a fixture whose generator needs ImageMagick installed is a fixture nobody
can regenerate. What it gives up is compression: every pixel is emitted as its
own LZW literal, with a clear code often enough that the code width never has
to grow past nine bits. That is correct by construction — there is no
dictionary state for the decoder to disagree with — and it costs about 9 bits
per pixel, so a six-frame 100x100 GIF lands near 68 kB. For a fixture that is
a fine trade; for anything shipped it would not be.

Usage:  python generate-gif.py before|after <out-dir>
"""
import os
import struct
import sys

WIDTH = HEIGHT = 100
FRAMES = 6
DELAY_CS = 12  # centiseconds between frames, so roughly eight a second

# Index 0 is the ground, index 1 the bar. Everything else is padding: the
# global table has to be a power of two, and 256 entries is what lets the LZW
# minimum code size be 8 and every pixel value be its own literal.
PALETTE = [(0, 128, 128), (255, 255, 0)]

CLEAR = 256
END = 257
# After a clear the decoder has codes 258..511 to fill before nine bits stop
# being enough. Emitting no more than that many literals in between keeps the
# width fixed, which is the whole reason this needs no dictionary.
RUN = 254


def lzw_literals(indexes):
    """Every pixel as a literal code, at a fixed nine bits."""
    out = bytearray()
    acc = 0
    held = 0

    def emit(code):
        nonlocal acc, held
        acc |= code << held
        held += 9
        while held >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            held -= 8

    emit(CLEAR)
    since = 0
    for index in indexes:
        if since == RUN:
            emit(CLEAR)
            since = 0
        emit(index)
        since += 1
    emit(END)
    if held:
        out.append(acc & 0xFF)
    return bytes(out)


def sub_blocks(data):
    """GIF carries image data in length-prefixed runs of at most 255 bytes."""
    out = bytearray()
    for at in range(0, len(data), 255):
        chunk = data[at : at + 255]
        out.append(len(chunk))
        out += chunk
    out.append(0)
    return bytes(out)


def animated_gif(width, height, palette, frames, delay_cs, loop=0):
    table = bytearray()
    for colour in palette:
        table += bytes(colour)
    table += bytes(3 * (256 - len(palette)))

    out = bytearray(b'GIF89a')
    out += struct.pack('<HH', width, height)
    # Global table present, 8-bit colour resolution, 256 entries.
    out += bytes([0xF7, 0, 0])
    out += table
    # The block that makes it loop. Without it every decoder plays once and
    # stops, which looks exactly like the still this replaces.
    out += b'\x21\xFF\x0BNETSCAPE2.0\x03\x01' + struct.pack('<H', loop) + b'\x00'

    for frame in frames:
        # Disposal method 1: leave the frame up. Each frame here is a full
        # replacement, so there is nothing to restore between them.
        out += b'\x21\xF9\x04\x04' + struct.pack('<H', delay_cs) + b'\x00\x00'
        out += b'\x2C' + struct.pack('<HHHH', 0, 0, width, height) + b'\x00'
        out += bytes([8])
        out += sub_blocks(lzw_literals(frame))

    out += b'\x3B'
    return bytes(out)


def bar_frame(left):
    """The ground, with a 35x50 bar standing on it at `left`."""
    pixels = bytearray(WIDTH * HEIGHT)
    for y in range(25, 75):
        row = y * WIDTH
        for x in range(left, min(left + 35, WIDTH)):
            pixels[row + x] = 1
    return pixels


def main():
    variant, out_dir = sys.argv[1], sys.argv[2]
    after = variant == 'after'

    # The still this replaces had the bar at x=10 before and x=55 after, so the
    # first frame of each side is unchanged and the comparison a reviewer sees
    # on a paused decoder is the same one it always was. What is new is that
    # the bar now travels — and travels the other way on the other side, so
    # every frame after the first differs too.
    stops = [10 + round(i * 45 / (FRAMES - 1)) for i in range(FRAMES)]
    if after:
        stops = list(reversed(stops))

    data = animated_gif(
        WIDTH, HEIGHT, PALETTE, [bar_frame(x) for x in stops], DELAY_CS
    )
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'animation.gif')
    with open(path, 'wb') as handle:
        handle.write(data)
    print('wrote %s, %d frames, %d bytes' % (path, FRAMES, len(data)))


if __name__ == '__main__':
    main()
