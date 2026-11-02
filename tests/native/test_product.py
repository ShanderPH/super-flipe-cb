"""Native UI -> real API -> child handoff -> backup/restore. The child is a fixture,
so this proves product lifecycle and persistence, never PS1 emulation or TV speed.
"""

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

import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from app.config import Settings


def check(binary):
    with tempfile.TemporaryDirectory(prefix="sfcb-product-") as temporary:
        root = Path(temporary)
        os.environ["SFCB_DATA"] = str(root / "module-default")
        from app.main import create_app

        cfg = Settings(data=root / "data", hosts=["127.0.0.1"])
        rom = b"synthetic-game-not-emulated" * 1024
        (cfg.data / "roms/snes/Fixture.sfc").write_bytes(rom)
        game = "snes-" + hashlib.sha256(rom).hexdigest()
        server_app = create_app(cfg)
        token = (cfg.data / "native/pairing-token").read_text().strip()
        app = root / "app"
        app.mkdir()
        shutil.copy2(binary, app / "superflip-native")
        shutil.copytree(ROOT / "apps/tv-native/assets", app / "assets")
        shutil.copyfile(ROOT / "apps/tv-native/retroarch.cfg", app / "retroarch.cfg")
        (app / "cores").mkdir()
        (app / "cores/snes9x_libretro.so").write_bytes(b"not-a-loaded-core")
        child = app / "retroarch"
        child.write_text(
            "#!/usr/bin/python3\n"
            "import pathlib,re,sys,os,time\n"
            "cfg=pathlib.Path(sys.argv[sys.argv.index('--config')+1]).read_text()\n"
            'folder=pathlib.Path(re.search(r\'savefile_directory = "([^"]+)"\',cfg)[1])\n'
            "rom=pathlib.Path(sys.argv[sys.argv.index('-L')+2])\n"
            "card=folder/(rom.stem+'.srm')\n"
            "if os.environ.get('SFCB_EXPECT_STATE_ABSENT'): assert not (folder/(rom.stem+'.state1')).exists()\n"
            "if card.exists():\n"
            " assert card.read_bytes()==b'native-progress'\n"
            "else: card.write_bytes(b'native-progress')\n"
            "(folder/(rom.stem+'.state1')).write_bytes(b'native-state')\n"
            "if os.environ.get('SFCB_CHILD_PID_FILE'):\n"
            " pathlib.Path(os.environ['SFCB_CHILD_PID_FILE']).write_text(str(os.getpid()))\n"
            " time.sleep(30)\n"
            "os.environ['SFCB_RUNTIME_RESULT']='0'\n"
            "exe=os.environ['SFCB_UI_EXEC']\n"
            "os.execv(exe,[exe,'--state-dir',os.environ['SFCB_STATE_DIR'],'--cache-dir',os.environ['SFCB_CACHE_DIR']])\n"
        )
        child.chmod(0o755)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(server_app, log_level="error"))
            thread = threading.Thread(
                target=server.run, kwargs={"sockets": [listener]}, daemon=True
            )
            thread.start()
            try:
                for _ in range(100):
                    if server.started:
                        break
                    time.sleep(0.02)
                session = app / "session.json"
                session.write_text(
                    json.dumps({"server": f"http://127.0.0.1:{port}", "token": token})
                )
                env = dict(
                    os.environ,
                    SDL_VIDEODRIVER="dummy",
                    SFCB_START_GAME=game,
                    SFCB_TEST_FRAMES="1",
                    SFCB_UI_CAPTURE=str(root / "returned.bmp"),
                )
                state = root / "state"

                def run():
                    return subprocess.run(
                        [
                            str(app / "superflip-native"),
                            "--state-dir",
                            str(state),
                            "--cache-dir",
                            str(root / "cache"),
                        ],
                        env=env,
                        text=True,
                        capture_output=True,
                        check=True,
                        timeout=30,
                    )

                run()
                assert (root / "returned.bmp").is_file()
                assert (state / "session.json").is_file() and not session.exists()
                assert list((cfg.data / "native/saves").rglob("*.srm.json"))
                assert list((cfg.data / "native/saves").rglob("*.state1.json"))
                assert list((cfg.data / "native/archives").glob("*.bin"))
                # Simulate reinstall/recovery by removing only the disposable local
                # save namespace. The real server must restore both SRAM and state.
                shutil.rmtree(state / "s")
                run()
                assert (
                    next((state / "s").rglob("*.srm")).read_bytes()
                    == b"native-progress"
                )
                assert (
                    next((state / "s").rglob("*.state1")).read_bytes()
                    == b"native-state"
                )
                (app / "cores/snes9x_libretro.so").write_bytes(
                    b"new-binary-same-pinned-source"
                )
                env["SFCB_EXPECT_STATE_ABSENT"] = "1"
                run()
                env.pop("SFCB_EXPECT_STATE_ABSENT")
                assert len(list((state / "s").rglob("*.srm"))) == 2
                marker = root / "child.pid"
                for hard in (False, True):
                    marker.unlink(missing_ok=True)
                    live_env = {**env, "SFCB_CHILD_PID_FILE": str(marker)}
                    owner = subprocess.Popen(
                        [
                            str(app / "superflip-native"),
                            "--state-dir",
                            str(state),
                            "--cache-dir",
                            str(root / "cache"),
                        ],
                        env=live_env,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    try:
                        for _ in range(100):
                            if marker.exists():
                                break
                            time.sleep(0.05)
                        assert marker.exists(), "Runtime child did not start"
                        child_pid = int(marker.read_text())
                        assert child_pid == owner.pid, "Gameplay must reuse the app PID"
                        if hard:
                            owner.kill()
                        else:
                            owner.terminate()
                        owner.wait(timeout=10)
                        for _ in range(100):
                            stat = Path(f"/proc/{child_pid}/stat")
                            if not stat.exists() or stat.read_text().split(") ", 1)[
                                1
                            ].startswith("Z"):
                                break
                            time.sleep(0.05)
                        else:
                            raise AssertionError("Orphan runtime remained active")
                    finally:
                        if owner.poll() is None:
                            owner.kill()
                            owner.wait(timeout=5)
                print(
                    json.dumps(
                        {
                            "nativeUi": True,
                            "returnedToCatalog": True,
                            "sramAndStateRestored": True,
                            "backupArchived": True,
                        }
                    )
                )
            finally:
                server.should_exit = True
                thread.join(5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    check(parser.parse_args().binary.resolve())
