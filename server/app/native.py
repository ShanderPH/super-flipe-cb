"""Native-only catalog, immutable block transport and isolated save envelopes.

The legacy catalog/save protocol deliberately remains unchanged. The core owns
CUE/TOC/CHD interpretation; this service maps approved files, never arbitrary paths.
"""

import base64
import hashlib
import hmac
import json
import re
import secrets
from pathlib import Path, PureWindowsPath

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from filelock import FileLock

from .catalog import Catalog, confined
from .saves import SaveStore

BLOCK = 128 * 1024
BIOS = {
    "scph5501.bin": "490f666e1afb15b7362b406ed1cea246",
    "scph7001.bin": "1e68c231d0896b7eadcad1d7d8e76129",
    "scph1001.bin": "924e392ed05558ffdb115408c263dccf",
}


def file_identity(path):
    digest = hashlib.sha256()
    blocks = []
    with path.open("rb") as stream:
        before = stream.fileno()
        import os

        signature = os.fstat(before)
        while block := stream.read(BLOCK):
            digest.update(block)
            blocks.append(hashlib.sha256(block).hexdigest())
        after = os.fstat(before)
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
            signature.st_size,
            signature.st_mtime_ns,
            signature.st_ctime_ns,
        ):
            raise ValueError("Mídia mudou durante indexação")
    return {
        "size": signature.st_size,
        "sha256": digest.hexdigest(),
        "blocks": blocks,
        "signature": (signature.st_size, signature.st_mtime_ns, signature.st_ctime_ns),
    }


class NativeLibrary:
    def __init__(self, root: Path, catalog: Catalog):
        self.root = root
        self.storage = confined(root, root / "native")
        self.storage.mkdir(exist_ok=True)
        self.token_file = confined(root, self.storage / "pairing-token")
        if not self.token_file.exists():
            with self.token_file.open("x", encoding="ascii") as stream:
                stream.write(secrets.token_hex(32))
            self.token_file.chmod(0o600)
        self.token = self.token_file.read_text("ascii").strip()
        self.games = {g.id: g.model_dump() for g in catalog.games.values()}
        self.discs = {}
        self.files = {}
        self.errors = []
        self.bios = None
        psx = confined(root, root / "roms/psx")
        for name, expected in BIOS.items():
            for path in sorted((psx / "bios").glob("*")):
                if path.name.lower() != name:
                    continue
                confined(root, path)
                if path.stat().st_size == 512 * 1024:
                    data = path.read_bytes()
                    if hashlib.md5(data, usedforsecurity=False).hexdigest() == expected:
                        self.bios = (name, data, hashlib.sha256(data).hexdigest())
                        break
            if self.bios:
                break
        candidates = sorted(psx.rglob("*")) if psx.exists() else []
        for path in candidates:
            if path.suffix.lower() not in (".cue", ".chd", ".m3u"):
                continue
            try:
                self.index(path, psx)
            except (ValueError, OSError, HTTPException) as error:
                self.errors.append({"name": path.name, "error": str(error)[:160]})

    def index(self, path, psx):
        confined(self.root, path)
        assets = {}
        texts = {}
        visiting = set()

        def add(source):
            source = confined(self.root, source)
            if not source.is_relative_to(psx) or not source.is_file():
                raise ValueError("Arquivo do disco ausente ou fora da biblioteca PS1")
            if source in visiting:
                raise ValueError("Playlist cíclica")
            if source in assets:
                return assets[source]["name"]
            if len(assets) >= 100:
                raise ValueError("Disco excede limite de arquivos")
            suffix = source.suffix.lower()
            if suffix not in (".cue", ".bin", ".img", ".iso", ".chd", ".m3u", ".sub", ".sbi"):
                raise ValueError("Formato de mídia não suportado")
            identity = file_identity(source)
            item = {"name": f"file{len(assets):02}{suffix}", **identity}
            assets[source] = item
            visiting.add(source)

            def sibling(name):
                # Old CUEs may contain DOS absolute names. Resolve the basename
                # ONLY beside the CUE, never follow an absolute client path.
                win = PureWindowsPath(name)
                if win.is_absolute():
                    name = win.name
                if "\\" in name or Path(name).is_absolute() or ".." in Path(name).parts:
                    raise ValueError("Referência de disco insegura")
                proposed = source.parent / name
                matches = [
                    p for p in source.parent.iterdir() if p.name.casefold() == name.casefold()
                ]
                return (
                    proposed
                    if proposed.is_file()
                    else (matches[0] if len(matches) == 1 else proposed)
                )

            if suffix in (".cue", ".m3u"):
                if source.stat().st_size > 64 * 1024:
                    raise ValueError("Descritor excede limite")
                text = source.read_text("utf-8-sig")
                if suffix == ".cue":
                    count = 0

                    def replace(match):
                        nonlocal count
                        count += 1
                        target = sibling(match[1] or match[2])
                        if target.suffix.lower() not in (".bin", ".img", ".iso"):
                            raise ValueError("CUE requer arquivo binário")
                        return f'FILE "{add(target)}" BINARY'

                    text = re.sub(
                        r'^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+BINARY\s*$',
                        replace,
                        text,
                        flags=re.M | re.I,
                    )
                    if not count or len(re.findall(r"^\s*FILE\b", text, re.M | re.I)) != count:
                        raise ValueError("CUE sem arquivos BINARY válidos")
                    if not re.search(
                        r"^\s*TRACK\s+\d+\s+(MODE[12]/(?:2048|2352)|AUDIO)\s*$", text, re.M | re.I
                    ):
                        raise ValueError("Trilhas CUE não reconhecidas")
                else:
                    lines = [
                        x.strip() for x in text.splitlines() if x.strip() and not x.startswith("#")
                    ]
                    if not 1 <= len(lines) <= 8:
                        raise ValueError("Playlist requer de 1 a 8 discos")
                    refs = [sibling(line) for line in lines]
                    if any(ref.suffix.lower() not in (".cue", ".chd") for ref in refs):
                        raise ValueError("Playlist aceita CUE/CHD")
                    text = "\n".join(add(ref) for ref in refs) + "\n"
                texts[item["name"]] = text
            visiting.remove(source)
            return item["name"]

        entry = add(path)
        version = hashlib.sha256(
            json.dumps(
                {
                    "files": [{"name": a["name"], "sha256": a["sha256"]} for a in assets.values()],
                    "texts": texts,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        game_id = "ps1-" + version
        files = []
        for source, asset in assets.items():
            item = {k: v for k, v in asset.items() if k != "signature"}
            item["url"] = f"/api/native/discs/{game_id}/files/{asset['name']}"
            if asset["name"] not in texts:
                files.append(item)
                self.files[(game_id, asset["name"])] = (source, asset)
        self.discs[game_id] = {
            "id": game_id,
            "version": version,
            "entry": entry,
            "blockSize": BLOCK,
            "files": files,
            "texts": texts,
        }
        self.games[game_id] = {
            "id": game_id,
            "title": path.stem.replace("_", " "),
            "system": "ps1",
            "core": "pcsx_rearmed",
            "coverUrl": None,
            "media": {
                "format": path.suffix[1:].lower(),
                "sizeBytes": sum(a["size"] for a in assets.values()),
            },
        }


def native_router(root, catalog):
    library = NativeLibrary(root, catalog)
    router = APIRouter(prefix="/api/native")

    def authorize(request):
        if not hmac.compare_digest(request.headers.get("x-native-token", ""), library.token):
            raise HTTPException(401, "Pareamento nativo necessário")

    @router.get("/catalog")
    def games(request: Request):
        authorize(request)
        return {
            "items": sorted(
                library.games.values(), key=lambda g: (g["system"], g["title"].casefold())
            ),
            "errors": library.errors,
            "biosAvailable": library.bios is not None,
        }

    @router.get("/discs/{game}/manifest")
    def manifest(game: str, request: Request):
        authorize(request)
        if game not in library.discs:
            raise HTTPException(404, "Disco indisponível")
        return library.discs[game]

    @router.get("/discs/{game}/files/{name}")
    @router.head("/discs/{game}/files/{name}")
    def disc_file(game: str, name: str, request: Request):
        authorize(request)
        pair = library.files.get((game, name))
        if pair is None:
            raise HTTPException(404, "Arquivo indisponível")
        path, asset = pair
        confined(root, path)
        import os

        with path.open("rb") as stream:
            before = os.fstat(stream.fileno())
            signature = (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
            if signature != asset["signature"]:
                raise HTTPException(409, "Disco alterado; reinicie o índice")
            tag = f'"{asset["sha256"]}"'
            headers = {"ETag": tag, "Accept-Ranges": "bytes", "Content-Length": str(asset["size"])}
            if request.method == "HEAD":
                return Response(headers=headers)
            if request.headers.get("if-match") != tag:
                raise HTTPException(412, "Versão do disco obrigatória")
            match = re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers.get("range", ""))
            if not match:
                raise HTTPException(416, "Intervalo explícito obrigatório")
            start, end = map(int, match.groups())
            if not 0 <= start <= end < asset["size"] or end - start + 1 > 1024 * 1024:
                raise HTTPException(416, "Intervalo inválido ou maior que 1 MiB")
            stream.seek(start)
            data = stream.read(end - start + 1)
            after = os.fstat(stream.fileno())
            if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != signature or len(
                data
            ) != end - start + 1:
                raise HTTPException(409, "Disco mudou durante leitura")
        headers.update(
            {
                "Content-Range": f"bytes {start}-{end}/{asset['size']}",
                "Content-Length": str(len(data)),
            }
        )
        return Response(
            data, status_code=206, media_type="application/octet-stream", headers=headers
        )

    @router.get("/bios")
    def bios(request: Request):
        authorize(request)
        if not library.bios:
            raise HTTPException(404, "BIOS PS1 legítima não reconhecida")
        name, data, digest = library.bios
        return Response(
            data,
            media_type="application/octet-stream",
            headers={"X-Bios-Name": name, "X-Save-SHA256": digest},
        )

    @router.put("/archives/{digest}")
    async def archive(digest: str, request: Request):
        authorize(request)
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise HTTPException(422, "Checksum inválido")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 32 * 1024 * 1024:
                raise HTTPException(413, "Backup excede limite")
        if hashlib.sha256(data).hexdigest() != digest:
            raise HTTPException(422, "Checksum do backup inválido")
        folder = confined(root, library.storage / "archives")
        folder.mkdir(exist_ok=True)
        path = confined(root, folder / (digest + ".bin"))
        with FileLock(str(path.with_suffix(".lock")), timeout=5):
            if path.exists():
                if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise HTTPException(409, "Backup existente corrompido")
            else:
                SaveStore.atomic(path, data)
        return Response(headers={"ETag": f'"{digest}"'})

    def save_file(game, build, name):
        if game not in library.games or not re.fullmatch(r"[a-z0-9_-]{1,160}", build):
            raise HTTPException(422, "Namespace inválido")
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,150}\.(srm|state\d*|mcr)", name):
            raise HTTPException(422, "Arquivo de progresso inválido")
        folder = confined(root, library.storage / "saves" / game / build)
        folder.mkdir(parents=True, exist_ok=True)
        return confined(root, folder / (name + ".json"))

    @router.get("/saves/{game}/{build}/{name}")
    def read_save(game: str, build: str, name: str, request: Request):
        authorize(request)
        path = save_file(game, build, name)
        if not path.exists():
            raise HTTPException(404, "Sem progresso nativo")
        envelope = json.loads(path.read_bytes())
        data = base64.b64decode(envelope["data"], validate=True)
        digest = hashlib.sha256(data).hexdigest()
        if digest != envelope["sha256"]:
            raise HTTPException(500, "Progresso corrompido; preserve backup")
        return Response(
            data,
            media_type="application/octet-stream",
            headers={"ETag": f'"{digest}"', "X-Save-SHA256": digest},
        )

    @router.get("/saves/{game}/{build}")
    def list_saves(game: str, build: str, request: Request):
        authorize(request)
        folder = save_file(game, build, "probe.srm").parent
        result = []
        for path in sorted(folder.glob("*.json")):
            confined(root, path)
            name = path.name.removesuffix(".json")
            save_file(game, build, name)
            envelope = json.loads(path.read_bytes())
            result.append({"name": name, "sha256": envelope["sha256"]})
        return {"files": result}

    @router.put("/saves/{game}/{build}/{name}")
    async def write_save(game: str, build: str, name: str, request: Request):
        authorize(request)
        path = save_file(game, build, name)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 16 * 1024 * 1024:
                raise HTTPException(413, "Progresso excede limite")
        digest = hashlib.sha256(data).hexdigest()
        if not data or digest != request.headers.get("x-save-sha256"):
            raise HTTPException(422, "Checksum do progresso inválido")
        with FileLock(str(path.with_suffix(".lock")), timeout=5):
            old = json.loads(path.read_bytes()) if path.exists() else None
            current = f'"{old["sha256"]}"' if old else '"0"'
            if request.headers.get("if-match") != current:
                if old and old["sha256"] == digest:
                    return Response(headers={"ETag": current})
                raise HTTPException(409, "Conflito: progresso local preservado")
            if old:
                SaveStore.atomic(
                    path.with_name(path.stem + "." + old["sha256"] + ".backup"), path.read_bytes()
                )
            SaveStore.atomic(
                path,
                json.dumps({"sha256": digest, "data": base64.b64encode(data).decode()}).encode(),
            )
        return Response(headers={"ETag": f'"{digest}"'})

    return router
