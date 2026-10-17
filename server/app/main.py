import hashlib
import ipaddress
import json
import logging
import re
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .catalog import Catalog, Game, confined
from .config import Settings
from .runtime import CORE_BUILD, CORE_HASHES
from .saves import SaveStore
from .schemas import Capabilities, GamePage, SaveMetadata

PLAYER_CSP = (
    "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob:; "
    "object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
)


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings()
    catalog = Catalog(cfg.data)
    saves = SaveStore(cfg.data)
    # Verify once at startup. Runtime updates require a stopped server.
    runtime_valid = False
    try:
        manifest = json.loads((cfg.runtime / "superflip-build.json").read_text())
        runtime_valid = (
            manifest["patch"] == 1
            and all(
                hashlib.sha256((cfg.runtime / "cores" / name).read_bytes()).hexdigest() == digest
                for name, digest in CORE_HASHES.items()
            )
            and all(
                hashlib.sha256((cfg.runtime / name).read_bytes()).hexdigest()
                == manifest["files"][name]
                for name in ("emulator.min.js", "emulator.min.css", "loader.js")
            )
        )
    except (OSError, ValueError, KeyError, TypeError):
        pass
    app = FastAPI(title="Super Flip CB", version="0.0.1", docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=cfg.hosts)

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        hostname = request.url.hostname or ""
        try:
            address = ipaddress.ip_address(hostname)
            if not (address.is_private or address.is_loopback):
                return Response(status_code=403)
        except ValueError:
            pass  # DNS names still require the explicit TrustedHost allowlist.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            fetch_site = request.headers.get("sec-fetch-site")
            if fetch_site == "cross-site" or (
                origin is not None and origin != str(request.base_url).rstrip("/")
            ):
                return Response(status_code=403)
            if request.headers.get("x-super-flip") != "1":
                return Response(status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        if request.method in ("GET", "HEAD") and response.status_code in (200, 304):
            if request.url.path.startswith(("/emulatorjs/data/", "/fonts/")):
                response.headers["Cache-Control"] = "public, no-cache"
            elif re.fullmatch(r"/assets/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2)", request.url.path):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers["Content-Security-Policy"] = (
            PLAYER_CSP
            if request.url.path.startswith("/player")
            else "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'; "
            "object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
        )
        return response

    @app.exception_handler(OSError)
    async def storage_error(request: Request, exc: OSError):
        logging.getLogger("superflip").error("Storage operation failed: %s", type(exc).__name__)
        return JSONResponse({"detail": "Falha de armazenamento; preserve seu progresso"}, 500)

    @app.exception_handler(ValueError)
    async def corrupt_storage(request: Request, exc: ValueError):
        return JSONResponse({"detail": "Dados locais inválidos; verifique os backups"}, 500)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.0.1", "hardwareValidated": False}

    @app.get("/api/capabilities", response_model=Capabilities)
    def capabilities():
        return {
            "systems": ["snes"],
            "engine": "EmulatorJS",
            "engineVersion": "4.2.3",
            "runtimeInstalled": runtime_valid,
            "saveMode": "explicit-sram-opt-in-sync",
            "statesExperimental": True,
            "hardwareValidated": False,
            "warnings": ["Compatibilidade, áudio, cache e gamepad pendentes de aceite na LG."],
        }

    @app.get("/api/runtime")
    def runtime():
        if not runtime_valid:
            raise HTTPException(503, "Runtime ausente ou alterado; execute o build verificado")
        return {
            "engine": "EmulatorJS",
            "engineVersion": "4.2.3",
            "sourceCommit": "e150dc0491ae747028919fb82d6598954976ede6",
            "inputPatch": 1,
            "core": "snes9x",
            "coreBuild": CORE_BUILD,
            "coreHashes": CORE_HASHES,
            "verifiedAtStartup": True,
        }

    @app.get("/api/systems")
    def systems():
        return [
            {
                "id": "snes",
                "name": "Super Nintendo",
                "core": "snes9x",
                "formats": ["sfc", "smc"],
                "hardwareValidated": False,
            }
        ]

    @app.get("/api/games", response_model=GamePage)
    def games(
        system: Literal["snes"] = "snes",
        page: int = Query(1, ge=1),
        pageSize: int = Query(24, ge=1, le=100),
        search: str = Query("", max_length=200),
    ):
        items = sorted(
            (g for g in catalog.games.values() if search.casefold() in g.title.casefold()),
            key=lambda game: (game.title.casefold(), game.id),
        )
        start = (page - 1) * pageSize
        return {
            "items": items[start : start + pageSize],
            "total": len(items),
            "page": page,
            "pageSize": pageSize,
        }

    @app.get("/api/games/{game_id}", response_model=Game)
    def game(game_id: str):
        return catalog.get(game_id)

    @app.get("/api/games/{game_id}/rom")
    @app.head("/api/games/{game_id}/rom")
    def rom(game_id: str):
        path = catalog.rom(game_id)
        return FileResponse(
            path, media_type="application/octet-stream", filename=f"{game_id}{path.suffix}"
        )

    @app.get("/api/games/{game_id}/cover")
    def cover(game_id: str):
        catalog.get(game_id)
        path = confined(cfg.data, cfg.data / "covers" / f"{game_id}.png")
        if not path.is_file():
            raise HTTPException(404, "Capa indisponível")
        return FileResponse(path, media_type="image/png")

    def save_path(game_id: str, kind: str, slot: str) -> Path:
        catalog.get(game_id)
        if not re.fullmatch(r"[a-z0-9_-]{1,32}", slot):
            raise HTTPException(422, "Slot inválido")
        return saves.path(game_id, "sram" if kind == "saves" else "state", slot)

    @app.get("/api/games/{game_id}/{kind}/{slot}")
    def read_save(game_id: str, kind: Literal["saves", "states"], slot: str):
        metadata, data = saves.read(save_path(game_id, kind, slot))
        if (metadata["gameId"], metadata["kind"], metadata["slot"]) != (
            game_id,
            "sram" if kind == "saves" else "state",
            slot,
        ):
            raise HTTPException(409, "Save incompatível com o jogo ou slot")
        return Response(
            data,
            media_type="application/octet-stream",
            headers={
                "ETag": f'"{metadata["version"]}"',
                "X-Save-SHA256": metadata["sha256"],
                "X-Core-Version": metadata["coreVersion"],
                "X-Core-Build": metadata.get("coreBuild", CORE_BUILD),
            },
        )

    @app.put("/api/games/{game_id}/{kind}/{slot}", response_model=SaveMetadata)
    async def write_save(
        game_id: str, kind: Literal["saves", "states"], slot: str, request: Request
    ):
        save_path(game_id, kind, slot)
        if request.headers.get("content-type", "").split(";")[0] != "application/octet-stream":
            raise HTTPException(415, "Envie um save binário")
        if request.headers.get("x-core-version") != "emulatorjs-4.2.3":
            raise HTTPException(409, "Versão do core incompatível")
        if request.headers.get("x-core-build", CORE_BUILD) != CORE_BUILD:
            raise HTTPException(409, "Build do core incompatível")
        if request.headers.get("if-match") is None:
            raise HTTPException(428, "Versão de save obrigatória")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > cfg.max_save:
                raise HTTPException(413, "Save excede 2 MiB")
            data.extend(chunk)
        if not data:
            raise HTTPException(422, "Save vazio")
        metadata = await run_in_threadpool(
            saves.write,
            game_id,
            "sram" if kind == "saves" else "state",
            slot,
            bytes(data),
            request.headers.get("if-match"),
        )
        return JSONResponse(metadata, headers={"ETag": f'"{metadata["version"]}"'})

    @app.api_route(
        "/api/{unknown:path}",
        methods=["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
        include_in_schema=False,
    )
    def unknown_api(unknown: str):
        raise HTTPException(404, "Route API indisponível")

    if cfg.runtime.is_dir():
        app.mount("/emulatorjs/data", StaticFiles(directory=cfg.runtime), name="engine")
    if cfg.ui.is_dir():
        app.mount("/", StaticFiles(directory=cfg.ui, html=True), name="ui")
    return app
