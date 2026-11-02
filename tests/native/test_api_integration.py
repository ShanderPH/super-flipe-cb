"""Actual FastAPI -> native C++ preparation on loopback, with disposable data only."""

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from app.config import Settings
from app.saves import SaveStore


def check(binary):
    with tempfile.TemporaryDirectory(prefix="superflip-api-native-") as temporary:
        root = Path(temporary)
        # app.main constructs a default app at import time; isolate it too.
        with patch.dict(os.environ, {"SFCB_DATA": str(root / "module-default")}):
            from app.main import create_app
        settings = Settings(
            data=root / "data",
            ui=root / "no-ui",
            runtime=root / "no-runtime",
            hosts=["127.0.0.1"],
        )
        rom = b"synthetic-transfer-fixture-not-executed" * 512
        game = "snes-" + hashlib.sha256(rom).hexdigest()
        (settings.data / "roms/snes/fixture.sfc").write_bytes(rom)
        store = SaveStore(settings.data)
        store.write(game, "sram", "1", b"legacy-fixture-unchanged", '"0"')
        envelope = store.path(game, "sram", "1")
        previous = envelope.read_bytes()
        app = root / "app"
        app.mkdir()
        shutil.copy2(binary, app / "superflip-native")
        shutil.copyfile(ROOT / "apps/tv-native/retroarch.cfg", app / "retroarch.cfg")
        (app / "cores").mkdir()
        (app / "cores/snes9x_libretro.so").write_bytes(
            b"prepare-only-fixture-not-loaded"
        )
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            server = uvicorn.Server(
                uvicorn.Config(create_app(settings), log_level="error")
            )
            thread = threading.Thread(
                target=server.run, kwargs={"sockets": [listener]}, daemon=True
            )
            thread.start()
            try:
                deadline = time.monotonic() + 5
                while (
                    not server.started
                    and thread.is_alive()
                    and time.monotonic() < deadline
                ):
                    time.sleep(0.01)
                if not server.started:
                    raise RuntimeError("Disposable FastAPI fixture did not start")
                (app / "session.json").write_text(
                    json.dumps({"server": f"http://127.0.0.1:{port}", "gameId": game})
                )
                result = subprocess.run(
                    [
                        str(app / "superflip-native"),
                        "--prepare-only",
                        "--state-dir",
                        str(root / "state"),
                        "--cache-dir",
                        str(root / "cache"),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=True,
                )
                assert (root / "cache" / (game + ".sfc")).read_bytes() == rom
                assert envelope.read_bytes() == previous
                assert "preparationMs=" in result.stdout
            finally:
                server.should_exit = True
                thread.join(5)
                if thread.is_alive():
                    raise RuntimeError("Disposable API server did not stop")
        return {
            "scope": "FastAPI and compiled native C++ on desktop loopback; no TV execution",
            "romIntegrity": True,
            "legacyEnvelopeUnchanged": True,
            "nativePreparation": True,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = check(args.binary.resolve())
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
