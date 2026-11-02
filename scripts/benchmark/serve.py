"""Isolated, read-only lab. A fresh temporary catalog never loads real saves."""

import argparse
import hashlib
import ipaddress
import json
import re
import sys
import tempfile
from pathlib import Path, PureWindowsPath

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from app.catalog import confined
from app.config import Settings
from app.main import create_app


def lab_app(
    temporary,
    rom=None,
    alternative=None,
    ps1_image=None,
    bios=None,
    host="127.0.0.1",
    core=None,
):
    cfg = Settings(data=Path(temporary))
    game_id = None
    if rom:
        rom = Path(rom).resolve(strict=True)
        if rom.suffix.lower() not in (".sfc", ".smc"):
            raise ValueError("SNES requires .sfc or .smc")
        # Copy to isolated storage, never link or mount the user's data tree.
        data = rom.read_bytes()
        game_id = "snes-" + hashlib.sha256(data).hexdigest()
        (cfg.data / "roms/snes" / ("Benchmark" + rom.suffix.lower())).write_bytes(data)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", host]
    )

    @app.middleware("http")
    async def read_only(request, call_next):
        if request.method not in ("GET", "HEAD"):
            return Response("Read-only benchmark", status_code=405)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/lab/config")
    def config():
        return {"gameId": game_id, "scene": "cold-boot/no-input", "realSaves": False}

    for runtime, mount in ((alternative, "/independent"), (core, "/experimental-core")):
        if not runtime:
            continue
        directory = Path(runtime).resolve(strict=True)
        manifest = json.loads((directory / "verified.json").read_text())
        for name, digest in manifest.items():
            path = confined(directory, directory / name)
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("Changed alternative runtime: " + name)
        app.mount(mount, StaticFiles(directory=directory), name=mount[1:])

    if ps1_image or bios:
        if not ps1_image or not bios:
            raise ValueError(
                "PS1 requires both --ps1-image and --bios from legitimate sources"
            )
        image, firmware = (
            Path(ps1_image).resolve(strict=True),
            Path(bios).resolve(strict=True),
        )
        if image.suffix.lower() not in (".pbp", ".bin", ".img", ".cue"):
            raise ValueError(
                "This PoC accepts PBP/BIN/IMG or a single-BIN CUE; multidisc is pending"
            )
        image_format = image.suffix[1:].lower()
        cue = None
        if image_format == "cue":
            if image.stat().st_size > 64 * 1024:
                raise ValueError("CUE exceeds 64 KiB")
            text = image.read_text(encoding="utf-8-sig")
            files = re.findall(
                r'^\s*FILE\s+"([^"]+)"\s+BINARY\s*$', text, re.MULTILINE | re.IGNORECASE
            )
            if (
                len(files) != 1
                or len(re.findall(r"^\s*FILE\b", text, re.MULTILINE | re.IGNORECASE))
                != 1
            ):
                raise ValueError("CUE must reference exactly one BINARY file")
            # Old rips can retain an obsolete absolute Windows path. Only a
            # sibling basename is admitted; never read a path from the CUE.
            name = PureWindowsPath(files[0]).name
            if Path(name).suffix.lower() != ".bin":
                raise ValueError("CUE requires a sibling BIN")
            binary = confined(image.parent, image.parent / name).resolve(strict=True)
            cue = re.sub(
                r'^\s*FILE\s+"[^"]+"\s+BINARY[^\S\r\n]*',
                'FILE "disc.bin" BINARY',
                text,
                count=1,
                flags=re.MULTILINE | re.IGNORECASE,
            ).encode()
            image = binary
        with image.open("rb") as media:
            image_sha = hashlib.file_digest(media, "sha256").hexdigest()
        if firmware.stat().st_size != 512 * 1024:
            raise ValueError(
                "PS1 BIOS must be a 512 KiB dump; provenance remains the operator's responsibility"
            )
        bios_name = firmware.name.lower()
        if not re.fullmatch(r"scph[0-9]{3,4}\.bin", bios_name):
            raise ValueError("Preserve the BIOS model filename, e.g. scph5501.bin")
        cores = ROOT / "vendor/experiments/pcsx-rearmed-ejs-4.2.3"
        manifest = json.loads((cores / "verified.json").read_text())
        for name, digest in manifest.items():
            if (
                hashlib.sha256(confined(cores, cores / name).read_bytes()).hexdigest()
                != digest
            ):
                raise ValueError("Changed PS1 runtime: " + name)

        @app.get("/lab/ps1-config")
        def ps1_config():
            return {
                "format": image_format,
                "mediaSha256": image_sha,
                "mediaBytes": image.stat().st_size,
                "gameUrl": "/lab/game." + image_format,
                "externalFiles": {"/disc.bin": "/lab/disc"} if cue else {},
                "coreHashes": manifest,
                "core": "pcsx_rearmed",
                "experimental": True,
                "biosName": bios_name,
                "biosSha256": hashlib.sha256(firmware.read_bytes()).hexdigest(),
            }

        @app.get("/lab/disc")
        @app.head("/lab/disc")
        def disc():
            return FileResponse(image, media_type="application/octet-stream")

        @app.get("/lab/game." + image_format)
        @app.head("/lab/game." + image_format)
        def game_file():
            return (
                Response(cue, media_type="application/octet-stream")
                if cue
                else FileResponse(image, media_type="application/octet-stream")
            )

        @app.get("/lab/bios/" + bios_name)
        @app.head("/lab/bios/" + bios_name)
        def ps1_bios():
            return FileResponse(firmware, media_type="application/octet-stream")

        app.mount("/ps1-cores", StaticFiles(directory=cores), name="ps1-cores")
    app.mount(
        "/lab/assets", StaticFiles(directory=ROOT / "scripts/benchmark/web"), name="lab"
    )
    cfg.hosts = ["127.0.0.1", "localhost", host]
    app.mount("/", create_app(cfg))
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom", type=Path)
    parser.add_argument("--alternative", type=Path)
    parser.add_argument("--core", type=Path)
    parser.add_argument("--ps1-image", type=Path)
    parser.add_argument("--bios", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8798)
    args = parser.parse_args()
    address = ipaddress.ip_address(args.host)
    if not address.is_private or address.is_unspecified:
        parser.error(
            "Bind to loopback or the explicit private LAN IP, never 0.0.0.0/public IP"
        )
    with tempfile.TemporaryDirectory(prefix="superflip-benchmark-") as directory:
        uvicorn.run(
            lab_app(
                directory,
                args.rom,
                args.alternative,
                args.ps1_image,
                args.bios,
                args.host,
                args.core,
            ),
            host=args.host,
            port=args.port,
        )
