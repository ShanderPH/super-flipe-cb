import base64
import hashlib
import json
import os
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException
from filelock import FileLock

from .catalog import confined
from .runtime import CORE_BUILD
from .schemas import SaveMetadata


class SaveStore:
    """One atomic envelope owns bytes + metadata; lock also works across processes."""

    def __init__(self, root: Path):
        self.root = root

    def path(self, game: str, kind: str, slot: str) -> Path:
        return confined(self.root, self.root / "saves" / f"{game}.{kind}.{slot}.json")

    def read(self, path: Path) -> tuple[dict, bytes]:
        if not path.exists():
            raise HTTPException(404, "Nenhum progresso neste slot")
        envelope = json.loads(path.read_bytes())
        if not isinstance(envelope, dict):
            raise HTTPException(500, "Save inválido; recupere um backup")
        SaveMetadata.model_validate(envelope.get("metadata", {}))
        if not isinstance(envelope.get("data"), str):
            raise HTTPException(500, "Save inválido; recupere um backup")
        content = base64.b64decode(envelope["data"], validate=True)
        if (
            hashlib.sha256(content).hexdigest() != envelope["metadata"]["sha256"]
            or len(content) != envelope["metadata"]["sizeBytes"]
        ):
            raise HTTPException(500, "Save corrompido; recupere um backup")
        if (
            envelope["metadata"]["coreVersion"] != "emulatorjs-4.2.3"
            or envelope["metadata"]["coreId"] != "snes9x"
            or envelope["metadata"].get("coreBuild", CORE_BUILD) != CORE_BUILD
        ):
            raise HTTPException(409, "Versão de save incompatível")
        return envelope["metadata"], content

    @staticmethod
    def atomic(path: Path, content: bytes):
        fd, name = tempfile.mkstemp(prefix=".save-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)

    def write(self, game: str, kind: str, slot: str, data: bytes, expected: str | None):
        path = self.path(game, kind, slot)
        lock = confined(self.root, path.with_suffix(".lock"))
        with FileLock(str(lock), timeout=10):
            previous = self.read(path)[0] if path.exists() else None
            if previous and (previous["gameId"], previous["kind"], previous["slot"]) != (
                game,
                kind,
                slot,
            ):
                raise HTTPException(409, "Save incompatível com o jogo ou slot")
            current = f'"{previous["version"]}"' if previous else '"0"'
            if expected != current:
                raise HTTPException(409, "Progresso alterado; exporte antes de recuperar")
            if previous:
                backup = confined(
                    self.root,
                    self.root / "backups" / f"{path.stem}.{previous['version']}.json",
                )
                self.atomic(backup, path.read_bytes())
            metadata = {
                "gameId": game,
                "slot": slot,
                "kind": kind,
                "coreId": "snes9x",
                "coreVersion": "emulatorjs-4.2.3",
                "coreBuild": CORE_BUILD,
                "updatedAt": datetime.now(UTC).isoformat(),
                "sha256": hashlib.sha256(data).hexdigest(),
                "sizeBytes": len(data),
                "version": uuid.uuid4().hex,
            }
            envelope = {"metadata": metadata, "data": base64.b64encode(data).decode("ascii")}
            self.atomic(path, json.dumps(envelope).encode("utf-8"))
            return metadata
