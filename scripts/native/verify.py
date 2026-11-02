"""Inspect the actual native IPK, ABI, execution permissions and build hashes."""

import argparse
import hashlib
import io
import json
import struct
import tarfile
from pathlib import Path, PurePosixPath

APP_ID = "com.superflipcb.native"


def ar_members(raw):
    if raw[:8] != b"!<arch>\n":
        raise ValueError("Not an ar/IPK archive")
    offset = 8
    seen = set()
    while offset < len(raw):
        header = raw[offset : offset + 60]
        if len(header) != 60 or header[58:60] != b"`\n":
            raise ValueError("Invalid ar member header")
        size = int(header[48:58])
        name = header[:16].decode("ascii").strip().rstrip("/")
        if name in seen or size < 0 or offset + 60 + size > len(raw):
            raise ValueError("Duplicate or truncated ar member")
        seen.add(name)
        yield name, raw[offset + 60 : offset + 60 + size]
        offset += 60 + size + size % 2
    if offset != len(raw):
        raise ValueError("Truncated ar padding")


def elf(data):
    if len(data) < 52 or data[:7] != b"\x7fELF\x01\x01\x01":
        raise ValueError("Expected a little-endian ELF32 binary")
    kind, machine = struct.unpack_from("<HH", data, 16)
    flags = struct.unpack_from("<I", data, 36)[0]
    if (
        machine != 40
        or kind not in (2, 3)
        or flags & 0xFF000000 != 0x05000000
        or flags & 0x400
    ):
        raise ValueError("Expected ARM EABI5 without the hard-float ABI")
    offset = struct.unpack_from("<I", data, 28)[0]
    entry_size, count = struct.unpack_from("<HH", data, 42)
    if entry_size < 32 or offset + entry_size * count > len(data):
        raise ValueError("Invalid ELF program headers")
    interpreter = None
    nx_stack = False
    for n in range(count):
        p = offset + n * entry_size
        segment, start = struct.unpack_from("<II", data, p)
        size = struct.unpack_from("<I", data, p + 16)[0]
        permissions = struct.unpack_from("<I", data, p + 24)[0]
        if start + size > len(data):
            raise ValueError("Truncated ELF segment")
        if segment == 3:
            interpreter = data[start : start + size].rstrip(b"\0").decode("ascii")
            if interpreter != "/lib/ld-linux.so.3":
                raise ValueError("Unexpected target ELF interpreter")
        if segment == 2:
            if size % 8:
                raise ValueError("Invalid ELF dynamic table")
            for position in range(start, start + size, 8):
                tag = struct.unpack_from("<I", data, position)[0]
                if tag == 0:
                    break
                if tag == 29:
                    raise ValueError(
                        "RUNPATH can mix bundled and system libraries on webOS; use RPATH"
                    )
        if segment == 0x6474E551:
            if permissions & 1:
                raise ValueError("Executable stack is not permitted")
            nx_stack = True
    if not nx_stack:
        raise ValueError("Missing non-executable stack declaration")
    return {
        "class": 32,
        "machine": "ARM",
        "eabi": 5,
        "hardFloat": False,
        "interpreter": interpreter,
        "nonExecutableStack": True,
    }


def inspect(ipk, build):
    raw = ipk.read_bytes()
    members = dict(ar_members(raw))
    if members.get("debian-binary") != b"2.0\n":
        raise ValueError("Missing Debian archive format version")
    controls = [
        data for name, data in members.items() if name.startswith("control.tar")
    ]
    payloads = [data for name, data in members.items() if name.startswith("data.tar")]
    if len(controls) != 1 or len(payloads) != 1:
        raise ValueError("Expected one control and one data archive")
    with tarfile.open(fileobj=io.BytesIO(controls[0]), mode="r:*") as archive:
        control = [
            item
            for item in archive
            if item.name.lstrip("./") == "control" and item.isfile()
        ]
        if len(control) != 1:
            raise ValueError("Expected one package control file")
        fields = archive.extractfile(control[0]).read().decode()
        if f"Package: {APP_ID}\n" not in fields or "Architecture: arm\n" not in fields:
            raise ValueError("Wrong package ID or architecture")
    files = {}
    modes = {}
    prefix = f"usr/palm/applications/{APP_ID}/"
    with tarfile.open(fileobj=io.BytesIO(payloads[0]), mode="r:*") as archive:
        for item in archive:
            path = PurePosixPath(item.name)
            if path.is_absolute() or ".." in path.parts or item.issym() or item.islnk():
                raise ValueError("Unsafe package member")
            name = str(path)
            if item.isfile() and name.startswith(prefix):
                relative = name[len(prefix) :]
                if relative in files:
                    raise ValueError("Duplicate app member")
                files[relative] = archive.extractfile(item).read()
                modes[relative] = item.mode
    manifest = json.loads(files["appinfo.json"])
    if not (
        manifest["id"] == APP_ID
        and manifest["type"] == "native"
        and manifest["main"] == "superflip-native"
        and manifest["version"] == "0.1.0"
        and manifest["cloudgame_active"] is True
    ):
        raise ValueError("Wrong native app manifest")
    if set(files) != set(build["files"]):
        raise ValueError(
            "App payload differs from the build manifest (do not package runtime userdata)"
        )
    for name, expected in build["files"].items():
        if hashlib.sha256(files[name]).hexdigest() != expected:
            raise ValueError("Packaged file checksum mismatch: " + name)
    binaries = {}
    for name, data in files.items():
        if data[:4] == b"\x7fELF":
            binaries[name] = elf(data)
        elif name.endswith((".sfc", ".smc", ".chd", ".cue", ".iso", ".wasm")):
            raise ValueError("Game media and WASM do not belong in this PoC IPK")
    for name in ["superflip-native", "native-probe", "retroarch"]:
        if name not in binaries or not modes[name] & 0o111:
            raise ValueError("Native executable missing execution permission: " + name)
    for required in [
        "cores/snes9x_libretro.so",
        "cores/pcsx_rearmed_libretro.so",
        "lib/libsfcb-disc.so",
    ]:
        if required not in binaries:
            raise ValueError("Missing native runtime component: " + required)
    return {
        "package": ipk.name,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "manifest": manifest,
        "elf": binaries,
        "platformLibrariesRequired": build["platformLibrariesRequired"],
        "physicalValidation": "pending; structural verification is not device acceptance",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipk", type=Path)
    parser.add_argument("--build", type=Path, required=True)
    args = parser.parse_args()
    report = inspect(args.ipk, json.loads((args.build / "build.json").read_text()))
    args.ipk.with_suffix(".verified.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                key: report[key]
                for key in ["package", "sha256", "bytes", "physicalValidation"]
            },
            indent=2,
        )
    )
