"""Regression checks for the native IPK trust boundary, using synthetic ELF fixtures."""

import importlib.util
import io
import json
import struct
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "native_verify", ROOT / "scripts/native/verify.py"
)
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


def elf_fixture(machine=40, flags=0x05000200, executable_stack=False):
    data = bytearray(84)
    data[:7] = b"\x7fELF\x01\x01\x01"
    struct.pack_into("<HH", data, 16, 2, machine)
    struct.pack_into("<I", data, 28, 52)
    struct.pack_into("<I", data, 36, flags)
    struct.pack_into("<HH", data, 42, 32, 1)
    struct.pack_into("<I", data, 52, 0x6474E551)
    struct.pack_into("<I", data, 76, 7 if executable_stack else 6)
    return bytes(data)


class PackageTests(unittest.TestCase):
    def test_softfp_arm32_eabi5_is_accepted(self):
        self.assertTrue(VERIFY.elf(elf_fixture())["nonExecutableStack"])

    def test_wrong_architecture_abi_and_executable_stack_are_rejected(self):
        for data in [
            elf_fixture(machine=62),
            elf_fixture(flags=0x05000400),
            elf_fixture(flags=0x04000200),
            elf_fixture(executable_stack=True),
            b"\x00asm",
        ]:
            with self.assertRaises(ValueError):
                VERIFY.elf(data)

    def test_truncated_program_headers_are_rejected(self):
        with self.assertRaises(ValueError):
            VERIFY.elf(elf_fixture()[:-1])

    def test_runpath_cannot_defer_bundled_dependencies_to_device_environment(self):
        # Add a PT_DYNAMIC segment after two ELF32 program headers.
        data = bytearray(elf_fixture()) + bytearray(48)
        struct.pack_into("<H", data, 44, 2)
        struct.pack_into("<II", data, 84, 2, 116)
        struct.pack_into("<I", data, 100, 16)
        struct.pack_into("<II", data, 116, 29, 0)  # DT_RUNPATH
        with self.assertRaisesRegex(ValueError, "RUNPATH"):
            VERIFY.elf(bytes(data))
        struct.pack_into("<I", data, 116, 15)  # DT_RPATH is permitted.
        self.assertTrue(VERIFY.elf(bytes(data))["nonExecutableStack"])

    def test_truncated_archive_and_duplicate_members_are_rejected(self):
        for data in [b"broken", b"!<arch>\nabc"]:
            with self.assertRaises(ValueError):
                list(VERIFY.ar_members(data))

    def test_packaged_manifest_and_file_modes_are_checked(self):
        import hashlib

        files = {
            name: elf_fixture()
            for name in [
                "superflip-native",
                "retroarch",
                "native-probe",
                "cores/snes9x_libretro.so",
                "cores/pcsx_rearmed_libretro.so",
                "lib/libsfcb-disc.so",
            ]
        }
        files["appinfo.json"] = json.dumps(
            {
                "id": VERIFY.APP_ID,
                "version": "0.1.0",
                "type": "native",
                "main": "superflip-native",
                "cloudgame_active": True,
            }
        ).encode()
        build = {
            "files": {
                name: hashlib.sha256(data).hexdigest() for name, data in files.items()
            },
            "platformLibrariesRequired": [],
        }

        def package(mode=0o755, wrong_hash=False, link=False):
            payload = io.BytesIO()
            with tarfile.open(fileobj=payload, mode="w:gz") as archive:
                for name, data in files.items():
                    item = tarfile.TarInfo(
                        f"usr/palm/applications/{VERIFY.APP_ID}/{name}"
                    )
                    item.mode = mode
                    item.size = len(data)
                    if link:
                        item.type = tarfile.SYMTYPE
                        item.linkname = "/etc/passwd"
                        item.size = 0
                    archive.addfile(item, io.BytesIO(data))
            control_bytes = f"Package: {VERIFY.APP_ID}\nArchitecture: arm\n".encode()
            control = io.BytesIO()
            with tarfile.open(fileobj=control, mode="w:gz") as archive:
                item = tarfile.TarInfo("control")
                item.size = len(control_bytes)
                archive.addfile(item, io.BytesIO(control_bytes))
            result = bytearray(b"!<arch>\n")
            for name, body in [
                ("debian-binary", b"2.0\n"),
                ("control.tar.gz", control.getvalue()),
                ("data.tar.gz", payload.getvalue()),
            ]:
                result += f"{name + '/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(body):<10}`\n".encode()
                result += body + (b"\n" if len(body) % 2 else b"")
            with tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "test.ipk"
                path.write_bytes(result)
                manifest = json.loads(json.dumps(build))
                if wrong_hash:
                    manifest["files"]["retroarch"] = "0" * 64
                return VERIFY.inspect(path, manifest)

        self.assertEqual(package()["manifest"]["type"], "native")
        for arguments in [{"mode": 0o644}, {"wrong_hash": True}, {"link": True}]:
            with self.assertRaises(ValueError):
                package(**arguments)


if __name__ == "__main__":
    unittest.main()
