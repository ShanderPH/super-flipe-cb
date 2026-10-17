import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    data: Path = field(default_factory=lambda: Path(os.getenv("SFCB_DATA", ROOT / "data")))
    ui: Path = ROOT / "apps/tv-client/dist"
    runtime: Path = ROOT / "vendor/emulatorjs/data"
    hosts: list[str] = field(
        default_factory=lambda: os.getenv("SFCB_HOSTS", "localhost,127.0.0.1,[::1]").split(",")
    )
    max_save: int = 2 * 1024 * 1024

    def __post_init__(self):
        self.data = self.data.absolute()
        for name in ("roms/snes", "covers", "saves", "backups"):
            (self.data / name).mkdir(parents=True, exist_ok=True)
