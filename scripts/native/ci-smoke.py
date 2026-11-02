"""Compile/test on Linux with system dependencies; no TV or commercial content."""

import argparse
import os
import sys
from pathlib import Path

from build import APP, LOCK, ROOT, extract, fetch, run, verify_source


def smoke(work):
    work.mkdir(parents=True, exist_ok=True)
    host = work / "host"
    run(
        [
            "cmake",
            "-S",
            str(APP),
            "-B",
            str(host),
            "-G",
            "Ninja",
            "-DCMAKE_BUILD_TYPE=Debug",
        ],
        log=work / "host-config.log",
    )
    run(["cmake", "--build", str(host), "--parallel", "4"], log=work / "host-build.log")
    run(
        [
            "g++",
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            str(ROOT / "tests/native/test_stick.cpp"),
            "-o",
            str(host / "test-stick"),
        ],
        log=work / "stick-build.log",
    )
    run([str(host / "test-stick")], log=work / "stick-tests.log")
    run(
        [
            sys.executable,
            str(ROOT / "tests/native/test_launcher.py"),
            "--binary",
            str(host / "superflip-native"),
            "-v",
        ],
        log=work / "launcher-tests.log",
    )
    run(
        [sys.executable, str(ROOT / "tests/native/test_package.py"), "-v"],
        log=work / "package-tests.log",
    )
    run(
        [
            "g++",
            "-std=c++17",
            str(ROOT / "tests/native/vfs_probe.cpp"),
            "-L" + str(host),
            "-lsfcb-disc",
            "-lcrypto",
            "-Wl,-rpath," + str(host),
            "-o",
            str(host / "vfs-probe"),
        ],
        log=work / "vfs-build.log",
    )
    run(
        [
            sys.executable,
            str(ROOT / "tests/native/test_disc_vfs.py"),
            "--probe",
            str(host / "vfs-probe"),
            "-v",
        ],
        log=work / "vfs-tests.log",
    )
    downloads = ROOT / "artifacts/native/downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive = fetch(LOCK["core"], downloads)
    source = extract(LOCK["core"], archive, work)
    verify_source(archive, work)
    env = dict(os.environ, CC="gcc", CXX="g++")
    run(
        ["make", "platform=unix", "CC=gcc", "CXX=g++", "LTO=", "-j4"],
        cwd=source / "libretro",
        env=env,
        log=work / "core-build.log",
    )
    run(
        [
            sys.executable,
            str(ROOT / "tests/native/test_core.py"),
            "--core",
            str(source / "libretro/snes9x_libretro.so"),
            "--report",
            str(work / "core-smoke.json"),
        ],
        log=work / "core-tests.log",
    )
    print("Native desktop contracts passed:", work)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    smoke(args.work.resolve())
