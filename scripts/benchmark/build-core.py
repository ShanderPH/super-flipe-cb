"""Compile the pinned experimental core; never modifies the production runtime."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHA = "a79dfe9047e7fec58808aefe48ad2bf499c7af11"


def build(lto=False, heap=64, repeat=False):
    source = ROOT / "vendor/experiments/snes9x2005-source"
    if (
        subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=source, text=True
        ).strip()
        != SHA
    ):
        raise ValueError("Wrong core source commit")
    if subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=source, text=True
    ).strip():
        raise ValueError("Core source must be pristine")
    emcc = ROOT / "vendor/experiments/emsdk/upstream/emscripten/emcc.py"
    version = subprocess.check_output(
        [sys.executable, str(emcc), "--version"], text=True
    )
    if "6.0.12" not in version:
        raise ValueError("Emscripten 6.0.12 required")
    name = f"snes9x2005-lab1-o3{'-lto' if lto else ''}-heap{heap}"
    if repeat:
        name += "-repeat"
    target = ROOT / "vendor/experiments" / name
    target.mkdir(exist_ok=False)
    common = (source / "Makefile.common").read_text().split("ifeq")[0]
    sources = re.findall(r"\$\((?:CORE|LIBRETRO)_DIR\)/[\w/]+\.c", common)
    sources = [
        s.replace("$(CORE_DIR)", "source").replace("$(LIBRETRO_DIR)", ".")
        for s in sources
    ]
    sources += ["source/apu.c", "source/soundux.c", "source/spc700.c"]
    shim = ROOT / "scripts/benchmark/libretro-lab.c"
    flags = [
        "-O3",
        "-DNDEBUG",
        "-DLOAD_FROM_MEMORY",
        "-DLAGFIX",
        "-Isource",
        "-I.",
        "-Ilibretro-common/include",
        "-Wno-incompatible-pointer-types",
        "-Wno-implicit-function-declaration",
    ]
    if lto:
        flags += ["-flto"]
    exports = [
        "malloc",
        "free",
        "lab_load",
        "lab_run",
        "lab_profile",
        "lab_input",
        "lab_metric",
        "lab_fps",
        "lab_rate",
        "lab_width",
        "lab_height",
        "lab_pixels",
        "lab_audio",
        "lab_samples",
        "lab_overflow",
    ]
    command = [
        sys.executable,
        str(emcc),
        *flags,
        *sources,
        str(shim),
        "--no-entry",
        "--profiling-funcs",
        "-sMODULARIZE=1",
        "-sEXPORT_ES6=1",
        "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16",
        "-sENVIRONMENT=web,node",
        "-sALLOW_MEMORY_GROWTH=1",
        f"-sINITIAL_MEMORY={heap * 1024 * 1024}",
        "-sMAXIMUM_MEMORY=536870912",
        "-sSTACK_SIZE=5242880",
        "-sEXPORTED_FUNCTIONS=" + json.dumps(["_" + e for e in exports]),
        "-o",
        str(target / "core.js"),
    ]
    log = target / "build.log"
    with log.open("w", encoding="utf-8") as output:
        subprocess.run(
            command, cwd=source, stdout=output, stderr=subprocess.STDOUT, check=True
        )
    shutil.copyfile(source / "copyright", target / "COPYING.core")
    (target / "package.json").write_text('{"type":"module"}\n', encoding="utf-8")
    hashes = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in target.iterdir()
        if p.is_file()
    }
    manifest = {
        "core": "snes9x2005",
        "coreSha": SHA,
        "frontendShimSha256": hashlib.sha256(shim.read_bytes()).hexdigest(),
        "buildScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "sdkRelease": "6e9f6885cb17a3d6c8fd488a5cff730f50aba61d",
        "emscripten": version,
        "flags": flags,
        "command": command,
        "asyncify": False,
        "threads": False,
        "profiling": "opt-in runtime timers; function names retained",
        "saveNamespace": "volatile-lab-only",
        "files": hashes,
    }
    (target / "build.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (target / "verified.json").write_text(
        json.dumps(
            {
                p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in target.iterdir()
                if p.is_file()
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(target)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lto", action="store_true")
    parser.add_argument("--heap", type=int, choices=[32, 64], default=64)
    parser.add_argument("--repeat-build", action="store_true")
    args = parser.parse_args()
    build(args.lto, args.heap, args.repeat_build)
