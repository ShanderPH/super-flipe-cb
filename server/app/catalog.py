import hashlib
import json
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel


class Media(BaseModel):
    url: str
    format: str
    sizeBytes: int


class Game(BaseModel):
    id: str
    title: str
    system: str = "snes"
    core: str = "snes9x"
    media: Media
    coverUrl: str | None = None


def confined(root: Path, path: Path) -> Path:
    """Reject links/junctions at every level, including configured storage roots."""
    root = root.absolute()
    path = path.absolute()
    if not path.is_relative_to(root):
        raise HTTPException(404, "Arquivo indisponível")
    for part in (path, *path.parents):
        if part.is_symlink() or part.is_junction():
            raise HTTPException(404, "Arquivo indisponível")
    if not path.resolve().is_relative_to(root.resolve()):
        raise HTTPException(404, "Arquivo indisponível")
    return path


class Catalog:
    def __init__(self, data: Path):
        self.data = data
        self.games: dict[str, Game] = {}
        self.paths: dict[str, Path] = {}
        manifest = confined(data, data / "catalog.json")
        titles = json.loads(manifest.read_text("utf-8")) if manifest.is_file() else {}
        root = confined(data, data / "roms/snes")
        for path in sorted(root.rglob("*")):
            if path.suffix.lower() not in (".sfc", ".smc") or not path.is_file():
                continue
            try:
                confined(data, path)
            except HTTPException:
                continue
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            game_id = "snes-" + digest
            if game_id in self.games:
                continue
            cover = confined(data, data / "covers" / f"{game_id}.png")
            self.games[game_id] = Game(
                id=game_id,
                title=str(titles.get(game_id, {}).get("title", path.stem.replace("_", " ")))[:200],
                media=Media(
                    url=f"/api/games/{game_id}/rom",
                    format=path.suffix.lower()[1:],
                    sizeBytes=path.stat().st_size,
                ),
                coverUrl=f"/api/games/{game_id}/cover" if cover.is_file() else None,
            )
            self.paths[game_id] = path

    def get(self, game_id: str) -> Game:
        if game_id not in self.games:
            raise HTTPException(404, "Jogo indisponível")
        return self.games[game_id]

    def rom(self, game_id: str) -> Path:
        self.get(game_id)
        path = confined(self.data, self.paths[game_id])
        if not path.is_file():
            raise HTTPException(404, "ROM indisponível; reinicie o índice")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if game_id != "snes-" + digest:
            raise HTTPException(409, "ROM alterada; reinicie o servidor para atualizar o catálogo")
        return path
