"""Generate an original 32 KiB LoROM diagnostic. No commercial ROM/BIOS assets."""

import argparse
import hashlib
import struct
from pathlib import Path


def generate():
    code = bytearray()
    labels = {}
    branches = []

    def emit(*values):
        code.extend(values)

    def label(name):
        labels[name] = len(code)

    def branch(opcode, name):
        emit(opcode, 0)
        branches.append((len(code) - 1, name))

    emit(0x78, 0x18, 0xFB, 0xC2, 0x10, 0xA2, 0xFF, 0x1F, 0x9A, 0xE2, 0x20)
    emit(0xA9, 0x80, 0x8D, 0x00, 0x21)  # Force blank.
    emit(0x9C, 0x00, 0x42, 0x9C, 0x05, 0x21, 0x9C, 0x2C, 0x21)
    emit(0xA9, 0x0F, 0x8D, 0x00, 0x21, 0xA9, 0x01, 0x8D, 0x00, 0x42)
    emit(0xA9, 0x53, 0x8F, 0x00, 0x00, 0x70)  # Original diagnostic SRAM marker.
    emit(0xA2, 0x00, 0x00)
    label("wait_end")
    emit(0xAD, 0x12, 0x42)
    branch(0x30, "wait_end")  # Wait until previous vblank ends.
    label("wait_begin")
    emit(0xAD, 0x12, 0x42)
    branch(0x10, "wait_begin")
    emit(0x9C, 0x21, 0x21, 0x8A, 0x8D, 0x22, 0x21, 0xA9, 0x00, 0x8D, 0x22, 0x21)
    emit(0xAF, 0x00, 0x00, 0x70, 0x1A, 0x8F, 0x00, 0x00, 0x70, 0xE8)
    branch(0x80, "wait_end")
    for offset, name in branches:
        distance = labels[name] - offset - 1
        if not -128 <= distance <= 127:
            raise ValueError("Diagnostic branch out of range")
        code[offset] = distance & 0xFF
    rom = bytearray(32768)
    rom[: len(code)] = code
    rom[0x7FC0:0x7FD5] = b"SUPER FLIP NATIVE TEST"
    rom[0x7FD5:0x7FDC] = bytes([0x20, 0x02, 0x05, 0x01, 0x01, 0x00, 0x00])
    struct.pack_into("<HH", rom, 0x7FDC, 0xFFFF, 0)
    for vector in [
        0x7FE4,
        0x7FE6,
        0x7FE8,
        0x7FEA,
        0x7FEE,
        0x7FF4,
        0x7FF8,
        0x7FFA,
        0x7FFC,
        0x7FFE,
    ]:
        struct.pack_into("<H", rom, vector, 0x8000)
    checksum = sum(rom) & 0xFFFF
    struct.pack_into("<HH", rom, 0x7FDC, checksum ^ 0xFFFF, checksum)
    return bytes(rom)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with args.output.open("xb") as output:
        data = generate()
        output.write(data)
    print("sha256=" + hashlib.sha256(data).hexdigest())
