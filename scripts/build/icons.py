"""Original geometric SF monogram. PNG encoding uses only the Python standard library."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
glyphs = [
    "111101111",
    "100001000",
    "100001000",
    "111101110",
    "000101000",
    "000101000",
    "111101000",
]


def monogram_png(size):
    scale = size // 13
    start_x = (size - 9 * scale) // 2
    start_y = (size - 7 * scale) // 2
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            gx, gy = (x - start_x) // scale, (y - start_y) // scale
            marked = 0 <= gx < 9 and 0 <= gy < 7 and glyphs[gy][gx] == "1"
            pixels.extend((16, 19, 33) if marked else (168, 137, 247))

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data))
        )

    output = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )
    return output


launcher = ROOT / "apps/webos-launcher"
public = ROOT / "apps/tv-client/public"
for size, name in [(80, "icon.png"), (130, "largeIcon.png")]:
    (launcher / name).write_bytes(monogram_png(size))

# The browser assets share the launcher monogram, rather than introducing a new mark.
path = "".join(
    f"M{x + 2} {y + 3}h1v1h-1z"
    for y, row in enumerate(glyphs)
    for x, pixel in enumerate(row)
    if pixel == "1"
)
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13" '
    'shape-rendering="crispEdges"><rect width="13" height="13" fill="#a889f7"/>'
    f'<path fill="#101321" d="{path}"/></svg>\n'
)
images = [(size, monogram_png(size)) for size in (16, 32, 48)]
ico = bytearray(struct.pack("<HHH", 0, 1, len(images)))
offset = 6 + 16 * len(images)
for size, png in images:
    ico.extend(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 24, len(png), offset))
    offset += len(png)
for _, png in images:
    ico.extend(png)
for target in (public, launcher):
    (target / "favicon.svg").write_text(svg, encoding="utf-8")
    (target / "favicon.ico").write_bytes(ico)
    (target / "favicon-32.png").write_bytes(monogram_png(32))
