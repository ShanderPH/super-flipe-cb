"""Reproduce ARMv7 runtime + C++ adapter on Linux. Never connects to a TV."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps/tv-native"
LOCK = json.loads((APP / "runtime.lock.json").read_text())


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(command, *, cwd=None, env=None, log):
    print("Running", command[0], "log:", log, flush=True)
    with Path(log).open("w") as output:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            stdout=output,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if result.returncode:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {command}; inspect {log}"
        )


def fetch(spec, downloads):
    # The core codeload URL has no useful filename.
    name = spec.get("directory", spec["url"].rsplit("/", 1)[1])
    if "codeload.github.com" in spec["url"]:
        name += ".tar.gz"
    elif "directory" in spec:
        name = spec["url"].rsplit("/", 1)[1]
    target = downloads / name
    if not target.exists():
        temporary = target.with_suffix(target.suffix + ".part")
        try:
            with (
                urllib.request.urlopen(spec["url"], timeout=120) as source,
                temporary.open("wb") as output,
            ):
                shutil.copyfileobj(source, output)
            if sha(temporary) != spec["sha256"]:
                raise ValueError("Download checksum mismatch: " + name)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    if sha(target) != spec["sha256"]:
        raise ValueError("Cached input checksum mismatch: " + name)
    return target


def extract(spec, archive, work):
    dest = work / spec["directory"]
    marker = dest / ".superflip-source.sha256"
    if dest.exists():
        if not marker.exists() or marker.read_text().strip() != spec["sha256"]:
            raise ValueError(
                f"Refusing unverified pre-existing work tree: {dest}. Use a new --work directory."
            )
        return dest
    with tarfile.open(archive) as source:
        source.extractall(work, filter="data")
    marker.write_text(spec["sha256"] + "\n")
    return dest


def verify_source(archive, work):
    """A cache marker proves origin, not that source files stayed unmodified."""
    count = 0
    with tarfile.open(archive) as original:
        for member in original:
            if not member.isfile():
                continue
            target = work / member.name
            if (
                not target.resolve().is_relative_to(work.resolve())
                or target.is_symlink()
            ):
                raise ValueError("Source tree contains an unsafe path: " + member.name)
            expected = hashlib.file_digest(
                original.extractfile(member), "sha256"
            ).hexdigest()
            if not target.is_file() or sha(target) != expected:
                raise ValueError("Upstream source changed: " + member.name)
            count += 1
    return count


def needed(binary, readelf):
    import re

    output = subprocess.check_output([readelf, "-d", str(binary)], text=True)
    return re.findall(r"\(NEEDED\).*\[(.*?)\]", output)


def bundle(stage, sysroot, readelf):
    # webOS platform libraries and libc MUST come from the device. SDK GPU,
    # Wayland, PulseAudio and font libraries are link-time platform stubs.
    platform = {
        "libc.so.6",
        "libm.so.6",
        "libpthread.so.0",
        "libdl.so.2",
        "librt.so.1",
        "ld-linux.so.3",
        "libEGL.so",
        "libEGL.so.1",
        "libGLESv2.so",
        "libGLESv2.so.2",
        "libwayland-client.so.0",
        "libwayland-cursor.so.0",
        "libwayland-egl.so.1",
        "libpulse.so.0",
        "libpulse-simple.so.0",
        "libfontconfig.so.1",
        "libfreetype.so.6",
        "libudev.so.1",
        "libasound.so.2",
        "libxkbcommon.so.0",
    }
    binaries = [
        stage / "retroarch",
        stage / "superflip-native",
        stage / "native-probe",
        stage / "cores/snes9x_libretro.so",
        stage / "lib/libSDL2-2.0.so.0",
    ]
    binaries.extend((stage / "cores").glob("*pcsx*.so"))
    binaries.extend((stage / "lib").glob("libsfcb*.so"))
    requirements = set()
    visited = set()
    while binaries:
        binary = binaries.pop()
        if binary in visited:
            continue
        visited.add(binary)
        for name in needed(binary, readelf):
            if name in platform:
                requirements.add(name)
                continue
            dest = stage / "lib" / name
            if not dest.exists():
                candidates = [sysroot / "usr/lib" / name, sysroot / "lib" / name]
                source = next((p for p in candidates if p.is_file()), None)
                if source is None:
                    raise ValueError(
                        f"Unresolved shared library {name} needed by {binary}"
                    )
                shutil.copyfile(source.resolve(), dest)
            binaries.append(dest)
    for binary in (stage / "lib").iterdir():
        # Developer Mode exports LD_LIBRARY_PATH=/lib:/usr/lib. RUNPATH comes
        # after that environment and can mix system SSL with bundled crypto.
        # RPATH keeps each bundled dependency family together, scoped to this app.
        subprocess.run(
            ["patchelf", "--force-rpath", "--set-rpath", "$ORIGIN", str(binary)],
            check=True,
        )
        subprocess.run(["patchelf", "--clear-execstack", str(binary)], check=True)
    return sorted(requirements)


def build(args):
    if os.name == "nt":
        raise ValueError(
            "Use build.ps1 with a Linux WSL distro, or run this script on Linux"
        )
    work = args.work.resolve()
    if " " in str(work):
        raise ValueError(
            "--work must be on the Linux filesystem without spaces (upstream Makefiles)"
        )
    output = args.output.resolve()
    if output.exists():
        raise ValueError("Refusing to overwrite output; choose a new --output")
    work.mkdir(parents=True, exist_ok=True)
    import fcntl

    build_lock = (work / ".build.lock").open("w")
    fcntl.flock(build_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    downloads = ROOT / "artifacts/native/downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archives = {
        name: fetch(spec, downloads)
        for name, spec in LOCK.items()
        if isinstance(spec, dict)
    }
    sdk = extract(LOCK["toolchain"], archives["toolchain"], work)
    ra = extract(LOCK["retroarch"], archives["retroarch"], work)
    core = extract(LOCK["core"], archives["core"], work)
    ps1 = extract(LOCK["ps1"], archives["ps1"], work)
    verified_sources = {
        name: verify_source(archives[name], work)
        for name in ["retroarch", "core", "ps1"]
    }
    from patch_runtime import patched_files

    source_ra = ra
    ra = work / "retroarch-native-build"
    if not ra.exists():
        shutil.copytree(source_ra, ra)
    for relative, content in patched_files(source_ra).items():
        target = ra / relative
        if target.read_text() != content:
            target.write_text(content)
    logs = work / "logs" / args.config
    logs.mkdir(parents=True, exist_ok=True)
    run(["bash", str(sdk / "relocate-sdk.sh")], log=logs / "relocate.log")
    # Source the SDK in a child shell, without changing the host environment.
    raw = subprocess.check_output(
        [
            "bash",
            "-c",
            'source "$1/environment-setup" >/dev/null; env -0',
            "sdk-env",
            str(sdk),
        ]
    )
    env = dict(item.decode().split("=", 1) for item in raw.split(b"\0") if b"=" in item)
    for key in ["CC", "CXX", "READELF", "STRIP", "OBJCOPY"]:
        executable = shutil.which(env[key], path=env["PATH"])
        if executable is None:
            raise ValueError("Missing SDK tool: " + key)
        env[key] = executable
    debug = "1" if args.config == "Debug" else "0"
    cc = env["CC"].split()[0]
    for key in ["CFLAGS", "CXXFLAGS"]:
        env[key] = env.get(key, "").replace("-g0", "-g1")
    signature = hashlib.sha256(
        (sha(__file__) + sha(APP / "runtime.lock.json") + args.config).encode()
    ).hexdigest()
    signature_file = work / ".build-signature"
    changed = not signature_file.exists() or signature_file.read_text() != signature
    if changed:
        run(
            ["make", "-f", "Makefile.webos", "clean"],
            cwd=ra,
            env=env,
            log=logs / "retroarch-clean.log",
        )
    (ra / "retroarch").unlink(missing_ok=True)
    # GCC 16 defaults to C23; the released 1.22.2 sources require C99 semantics.
    run(
        [
            "make",
            "-f",
            "Makefile.webos",
            "retroarch",
            f"CC={cc} -std=gnu99 -g1",
            f"CXX={env['CXX']} -g1",
            f"LINK={cc} -Wl,-z,noexecstack",
            "APP_PACKAGE_NAME=com.superflipcb.native",
            f"DEBUG={debug}",
            f"-j{args.jobs}",
        ],
        cwd=ra,
        env=env,
        log=logs / "retroarch.log",
    )
    # Clean only this verified experimental core's objects when changing profile.
    previous = core / ".superflip-build-profile"
    if changed or not previous.exists() or previous.read_text() != args.config:
        run(
            ["make", "clean", "platform=armv7"],
            cwd=core / "libretro",
            env=env,
            log=logs / "core-clean.log",
        )
    run(
        [
            "make",
            "platform=armv7",
            f"CC={cc} -std=gnu99",
            f"CXX={env['CXX']}",
            f"DEBUG={debug}",
            "LTO=",
            f"-j{args.jobs}",
        ],
        cwd=core / "libretro",
        env=env,
        log=logs / "core.log",
    )
    previous.write_text(args.config)
    adapter = work / ("adapter-" + args.config)
    run(
        [
            "cmake",
            "-S",
            str(APP),
            "-B",
            str(adapter),
            "-G",
            "Ninja",
            f"-DCMAKE_BUILD_TYPE={args.config}",
            "-DCMAKE_CXX_FLAGS_RELEASE=-O2 -g1 -DNDEBUG",
            f"-DCMAKE_TOOLCHAIN_FILE={sdk}/share/buildroot/toolchainfile.cmake",
        ],
        env=env,
        log=logs / "cmake.log",
    )
    run(
        ["cmake", "--build", str(adapter), "--parallel", str(args.jobs)],
        env=env,
        log=logs / "adapter.log",
    )
    signature_file.write_text(signature)
    # Patch only the VFS acquisition seam in a separate, verified source copy.
    # Upstream algorithms, disc layout, dynarec and graphics remain unchanged.
    ps1_build = work / "pcsx-native-build"
    patch_signature = hashlib.sha256(
        (LOCK["ps1"]["sha256"] + sha(__file__)).encode()
    ).hexdigest()
    patch_marker = ps1_build / ".superflip-patch"
    if not patch_marker.exists() or patch_marker.read_text() != patch_signature:
        if ps1_build.exists():
            shutil.rmtree(ps1_build)
        verify_source(archives["ps1"], work)
        shutil.copytree(ps1, ps1_build)
        path = ps1_build / "frontend/libretro.c"
        text = path.read_text()
        needle = "\t   filestream_vfs_init(&vfs_iface_info);"
        if text.count(needle) != 1:
            raise ValueError("PCSX VFS seam changed")
        text = text.replace(
            needle,
            "       extern void sfcb_vfs_install(struct retro_vfs_interface_info*);\n       sfcb_vfs_install(&vfs_iface_info);\n"
            + needle,
        )
        deinit = text.index("void retro_deinit(void)")
        end = text.index("\n}", deinit)
        text = (
            text[:end]
            + "\n   { extern void sfcb_vfs_shutdown(void); sfcb_vfs_shutdown(); }\n"
            + text[end:]
        )
        path.write_text(text)
        patch_marker.write_text(patch_signature)
    run(
        [
            "make",
            "-f",
            "Makefile.libretro",
            "platform=unix",
            "ARCH=arm",
            "DYNAREC=ari64",
            "BUILTIN_GPU=neon",
            "HAVE_NEON_ASM=1",
            "HAVE_PHYSICAL_CDROM=0",
            "USE_ASYNC_GPU=0",
            "USE_ASYNC_SPU=0",
            "USE_ASYNC_CDROM=1",
            "USE_LIBRETRO_VFS=1",
            "HAVE_CHD=1",
            f"CC={cc} -std=gnu99 -marm -march=armv7-a -mfpu=neon -mfloat-abi=softfp -g1",
            f"CXX={env['CXX']}",
            f"AR={env.get('AR', 'arm-webos-linux-gnueabi-ar')}",
            f"MAIN_LDLIBS=-L{adapter} -lsfcb-disc -lpthread -lm -ldl",
            f"DEBUG={debug}",
            f"-j{args.jobs}",
        ],
        cwd=ps1_build,
        env=env,
        log=logs / "ps1.log",
    )
    stage = output / "app"
    for directory in [
        stage / "lib",
        stage / "cores",
        output / "symbols",
        stage / "licenses",
    ]:
        directory.mkdir(parents=True, exist_ok=True)
    for name in [
        "appinfo.json",
        "retroarch.cfg",
        "runtime.lock.json",
        "session.json.example",
    ]:
        shutil.copyfile(APP / name, stage / name)
    shutil.copyfile(ROOT / "apps/webos-launcher/icon.png", stage / "icon.png")
    shutil.copytree(APP / "assets", stage / "assets")
    for name, source in {
        "retroarch": ra / "retroarch",
        "superflip-native": adapter / "superflip-native",
        "native-probe": adapter / "native-probe",
        "cores/snes9x_libretro.so": core / "libretro/snes9x_libretro.so",
        "cores/pcsx_rearmed_libretro.so": ps1_build / "pcsx_rearmed_libretro.so",
        "lib/libsfcb-disc.so": adapter / "libsfcb-disc.so",
    }.items():
        dest = stage / name
        shutil.copy2(source, dest)
        rpath = (
            "$ORIGIN/../lib"
            if name.startswith("cores/")
            else "$ORIGIN"
            if name.startswith("lib/")
            else "$ORIGIN/lib"
        )
        subprocess.run(
            ["patchelf", "--force-rpath", "--set-rpath", rpath, str(dest)], check=True
        )
        # NX stack is explicit for all our ELF executables and the P0 core.
        subprocess.run(["patchelf", "--clear-execstack", str(dest)], check=True)
        symbol = output / "symbols" / (Path(name).name + ".debug")
        subprocess.run(
            [env["OBJCOPY"], "--only-keep-debug", str(dest), str(symbol)], check=True
        )
        if args.config == "Release":
            subprocess.run([env["STRIP"], "--strip-unneeded", str(dest)], check=True)
            subprocess.run(
                [env["OBJCOPY"], "--add-gnu-debuglink=" + str(symbol), str(dest)],
                check=True,
            )
    # The released webOS ABI SDL is deliberately packaged instead of a generic SDL.
    sdl_dir = work / ("sdl-" + LOCK["sdl"]["sha256"][:12])
    if not sdl_dir.exists():
        sdl_dir.mkdir()
        with tarfile.open(archives["sdl"]) as source:
            source.extractall(sdl_dir, filter="data")
    shutil.copyfile(sdl_dir / "lib/libSDL2-2.0.so.0", stage / "lib/libSDL2-2.0.so.0")
    sysroot = sdk / "arm-webos-linux-gnueabi/sysroot"
    requirements = bundle(stage, sysroot, env["READELF"])
    shutil.copyfile(ra / "COPYING", stage / "licenses/RetroArch-GPL-3.txt")
    shutil.copyfile(core / "LICENSE", stage / "licenses/Snes9x.txt")
    shutil.copyfile(ps1 / "COPYING", stage / "licenses/PCSX-ReARMed-GPL-2.txt")
    shutil.copyfile(APP / "THIRD-PARTY.md", stage / "licenses/THIRD-PARTY.md")
    shutil.copytree(APP / "licenses", stage / "licenses/dependencies")
    # Preserve the complete SDK license inventory, including bundled libraries.
    legal = sdk / "share/buildroot/legal-info"
    if legal.exists():
        shutil.copytree(legal, output / "sdk-legal-info")
    shutil.copytree(logs, output / "logs")
    files = {
        str(p.relative_to(stage)): sha(p)
        for p in stage.rglob("*")
        if p.is_file() and p.name != "package.properties"
    }
    compiler = subprocess.check_output(
        [cc, "--version"], env=env, text=True
    ).splitlines()[0]
    report = {
        "schemaVersion": 1,
        "profile": args.config,
        "compiler": compiler,
        "inputs": LOCK,
        "platformLibrariesRequired": requirements,
        "files": files,
        "targetTested": False,
        "sourcePatches": [
            "RetroArch main exit bridge to native UI; signal/window-close guards",
            "PCSX frontend VFS acquisition: sfcb_vfs_install",
            "PCSX retro_deinit: sfcb_vfs_shutdown",
        ],
        "verifiedSourceFiles": verified_sources,
        "cStandard": "gnu99",
        "coreLTO": False,
        "ps1Dynarec": "ari64 ARMv7",
        "ps1Renderer": "NEON, original resolution",
        "discCacheBytes": 16777216,
        "discBlockBytes": 131072,
        "gameplayOwner": "RetroArch",
        "legacySavesAccessed": False,
        "sourceFiles": {
            str(path.relative_to(ROOT)): sha(path)
            for path in [
                *APP.glob("src/*"),
                APP / "CMakeLists.txt",
                APP / "third_party/libretro.h",
                Path(__file__),
                ROOT / "scripts/native/patch_runtime.py",
            ]
        },
    }
    (output / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Built:", output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, default=Path("/opt/superflip-native"))
    parser.add_argument(
        "--output", type=Path, default=ROOT / "artifacts/native/Release"
    )
    parser.add_argument("--config", choices=["Debug", "Release"], default="Release")
    parser.add_argument("--jobs", type=int, default=4)
    options = parser.parse_args()
    if not 1 <= options.jobs <= 32:
        parser.error("--jobs must be between 1 and 32")
    build(options)
