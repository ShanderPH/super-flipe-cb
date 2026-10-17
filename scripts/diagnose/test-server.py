"""Desktop E2E API with synthetic, non-playable bytes, isolated from private data."""
import tempfile
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))

from app.config import Settings
from app.main import create_app

with tempfile.TemporaryDirectory(prefix="superflip-e2e-") as directory:
    cfg = Settings(data=Path(directory))
    (cfg.data / "roms/snes/Synthetic fixture.sfc").write_bytes(b"not-a-playable-game" * 32)
    uvicorn.run(create_app(cfg), host="127.0.0.1", port=8788)
