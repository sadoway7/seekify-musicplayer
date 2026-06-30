#!/usr/bin/env python3
"""Generate the three PNG icons for the MusicApp Cookie Sync extension.

Pure standard library (struct + zlib), so it runs anywhere python3 does.

It writes, into the 'icons' folder next to this script:
    icons/icon16.png
    icons/icon48.png
    icons/icon128.png

Each file is a valid 8-bit truecolor (RGB) PNG of the exact pixel size:
a solid blue (#3b82f6) square with a white circle in the center.

Usage:
    python3 extension/musicapp-cookies/generate_icons.py
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(HERE, "icons")

BG = (0x3b, 0x82, 0xF6)  # blue
FG = (0xFF, 0xFF, 0xFF)  # white

# 89 50 4E 47 0D 0A 1A 0A
PNG_SIGNATURE = bytes([137, 80, 78, 71, 13, 10, 26, 10])


def _chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def make_png(size, path):
    cx = cy = (size - 1) / 2.0
    radius = size * 0.30  # radius of the white circle
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # scanline filter type 0 (None)
        for x in range(size):
            dx = x - cx
            dy = y - cy
            raw.extend(FG if dx * dx + dy * dy <= radius * radius else BG)

    # IHDR: width, height, bit_depth=8, color_type=2 (truecolor RGB), compression=0, filter=0, interlace=0
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)

    with open(path, "wb") as f:
        f.write(PNG_SIGNATURE)
        f.write(_chunk(b"IHDR", ihdr))
        f.write(_chunk(b"IDAT", idat))
        f.write(_chunk(b"IEND", b""))


def verify_png(path, expected):
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(PNG_SIGNATURE):
        return False, "bad signature"
    ihdr_len = struct.unpack(">I", data[8:12])[0]
    tag = data[12:16]
    if tag != b"IHDR" or ihdr_len != 13:
        return False, "bad IHDR"
    width, height, bit_depth, color_type = struct.unpack(">IIBB", data[16:26])
    if (width, height) != (expected, expected):
        return False, "dims %dx%d" % (width, height)
    if bit_depth != 8 or color_type != 2:
        return False, "bitdepth/colortype %d/%d" % (bit_depth, color_type)
    return True, "ok %dx%d" % (width, height)


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    all_ok = True
    for s in (16, 48, 128):
        path = os.path.join(ICON_DIR, "icon%d.png" % s)
        make_png(s, path)
        ok, info = verify_png(path, s)
        all_ok = all_ok and ok
        print("icon%d.png: %s (%d bytes) -> %s" % (
            s, "VALID" if ok else "INVALID", os.path.getsize(path), info))
    print("ALL OK" if all_ok else "SOME INVALID")


if __name__ == "__main__":
    main()
