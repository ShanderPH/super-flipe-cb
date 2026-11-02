"""Exercise the compiled C++ launcher against isolated HTTP fixtures, never real saves/ROMs."""

import argparse
import fcntl
import hashlib
import json
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PARSER = argparse.ArgumentParser()
PARSER.add_argument("--binary", type=Path, required=True)
ARGS, REST = PARSER.parse_known_args()
BINARY = ARGS.binary.resolve()
ROOT = Path(__file__).resolve().parents[2]


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "app"
        self.app.mkdir()
        shutil.copy2(BINARY, self.app / "superflip-native")
        shutil.copy2(ROOT / "apps/tv-native/retroarch.cfg", self.app / "retroarch.cfg")
        (self.app / "cores").mkdir()
        (self.app / "cores/snes9x_libretro.so").write_bytes(
            b"fixture-never-loaded-or-executed"
        )
        self.data = b"synthetic-not-executable-snes-content" * 1024
        self.game = "snes-" + hashlib.sha256(self.data).hexdigest()
        self.catalog = {
            "id": self.game,
            "system": "snes",
            "core": "snes9x",
            "title": "Synthetic fixture",
            "media": {
                "url": f"/api/games/{self.game}/rom",
                "format": "sfc",
                "sizeBytes": len(self.data),
            },
        }
        self.status = 200
        self.rom = self.data
        self.json_override = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                body = (
                    owner.rom
                    if self.path.endswith("/rom")
                    else (
                        owner.json_override
                        if owner.json_override is not None
                        else json.dumps(owner.catalog).encode()
                    )
                )
                self.send_response(owner.status)
                self.send_header("Content-Length", str(len(body)))
                self.send_header(
                    "Location", "http://203.0.113.1/should-never-be-followed"
                )
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.session = self.app / "session.json"
        self.settings = {
            "server": f"http://127.0.0.1:{self.server.server_port}",
            "gameId": self.game,
        }
        self.state = self.root / "state"
        self.cache = self.root / "cache"

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def run_launcher(self, expected=0, *, raw=None, more=(), prepare_only=True):
        self.session.write_text(
            raw if raw is not None else json.dumps(self.settings), encoding="utf-8"
        )
        result = subprocess.run(
            [
                str(self.app / "superflip-native"),
                *(["--prepare-only"] if prepare_only else []),
                "--state-dir",
                str(self.state),
                "--cache-dir",
                str(self.cache),
                *more,
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=10,
        )
        if expected == 0:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def test_valid_content_config_and_legacy_save_are_preserved(self):
        legacy = self.root / "legacy-save.json"
        legacy.write_bytes(b"legacy-envelope-do-not-touch")
        self.run_launcher()
        self.assertEqual((self.cache / (self.game + ".sfc")).read_bytes(), self.data)
        self.assertEqual(legacy.read_bytes(), b"legacy-envelope-do-not-touch")
        config = (self.cache / "session.cfg").read_text()
        self.assertIn("snes9x-fae2fea08f74180759ef540ee94259213f503480", config)
        self.assertIn(self.game, config)
        self.assertNotIn("emulatorjs", config.lower())
        self.assertEqual(list(self.cache.glob(".download-*")), [])

    def test_verified_cache_is_reused(self):
        self.run_launcher()
        self.rom = b"would-fail-if-redownloaded"
        self.run_launcher()

    def test_recovery_prunes_old_completed_roms_before_reusing_cache(self):
        self.run_launcher()
        old = self.cache / ("snes-" + "0" * 64 + ".sfc")
        old.write_bytes(b"previous-completed-cache-after-interrupted-replacement")
        self.run_launcher()
        self.assertFalse(old.exists())
        self.assertEqual(len(list(self.cache.glob("*.sfc"))), 1)

    def test_corrupt_existing_cache_is_never_overwritten(self):
        self.run_launcher()
        cached = self.cache / (self.game + ".sfc")
        cached.write_bytes(b"preserve-corrupt-cache-for-inspection")
        self.run_launcher(1)
        self.assertEqual(cached.read_bytes(), b"preserve-corrupt-cache-for-inspection")

    def test_bad_hash_discards_download(self):
        self.rom = b"x" * len(self.data)
        self.run_launcher(1)
        self.assertFalse((self.cache / (self.game + ".sfc")).exists())
        self.assertEqual(list(self.cache.glob(".download-*")), [])

    def test_short_or_oversized_transfer_fails(self):
        for body in [self.data[:-1], self.data + b"x"]:
            self.rom = body
            self.run_launcher(1)
        self.assertEqual(list(self.cache.glob(".download-*")), [])

    def test_http_errors_and_redirects_are_rejected(self):
        for status in [302, 404, 409, 500]:
            self.status = status
            self.run_launcher(1)

    def test_catalog_identity_and_capabilities_are_validated(self):
        for field, value in [
            ("id", "snes-" + "0" * 64),
            ("system", "ps1"),
            ("core", "pcsx_rearmed"),
        ]:
            old = self.catalog[field]
            self.catalog[field] = value
            self.run_launcher(1)
            self.catalog[field] = old

    def test_media_size_type_format_and_origin_are_validated(self):
        for field, value in [
            ("sizeBytes", -1),
            ("sizeBytes", 16 * 1024 * 1024 + 1),
            ("sizeBytes", "1000"),
            ("format", "chd"),
            ("url", "http://127.0.0.1/other"),
            ("url", "/../../private"),
        ]:
            old = self.catalog["media"][field]
            self.catalog["media"][field] = value
            self.run_launcher(1)
            self.catalog["media"][field] = old

    def test_malformed_or_excessive_json_is_rejected(self):
        for body in [b"not-json", b"{} garbage", b"[]", b"x" * (64 * 1024 + 1)]:
            self.json_override = body
            self.run_launcher(1)

    def test_session_configuration_size_and_type_are_bounded(self):
        for raw in ["x" * 4097, "[]", "{} trailing", '{"server":12,"gameId":"bad"}']:
            self.run_launcher(1, raw=raw)

    def test_public_urls_credentials_paths_and_ipv6_are_rejected(self):
        for url in [
            "http://8.8.8.8",
            "http://127.0.0.1@8.8.8.8",
            "https://127.0.0.1",
            "http://localhost",
            "http://127.0.0.1/api",
            "http://127.0.0.1:99999",
            "http://[::1]",
            "file:///etc/passwd",
            "http://127.0.0.1:0",
        ]:
            self.settings["server"] = url
            self.run_launcher(1)

    def test_path_in_game_id_and_nul_are_rejected(self):
        for game in [
            "../save",
            "snes-" + "a" * 63,
            self.game + "\u0000",
            self.game.upper(),
        ]:
            self.settings["gameId"] = game
            self.run_launcher(1)

    def test_cache_and_state_symlinks_are_rejected(self):
        real = self.root / "real"
        real.mkdir()
        self.cache.symlink_to(real, target_is_directory=True)
        self.run_launcher(1)
        self.cache.unlink()
        self.state.rmdir()
        self.state.symlink_to(real, target_is_directory=True)
        self.run_launcher(1)

    def test_update_permissions_are_hardened_without_changing_progress(self):
        self.cache.mkdir(mode=0o775)
        self.state.mkdir(mode=0o775)
        self.cache.chmod(0o775)
        self.state.chmod(0o775)
        preserved = self.state / "preserved.srm"
        preserved.write_bytes(b"existing-native-progress")
        preserved.chmod(0o775)
        self.run_launcher()
        self.assertEqual(preserved.read_bytes(), b"existing-native-progress")
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.cache.stat().st_mode & 0o777, 0o700)
        self.assertEqual(preserved.stat().st_mode & 0o777, 0o600)

    def test_session_symlink_is_rejected(self):
        other = self.root / "other.json"
        other.write_text(json.dumps(self.settings))
        self.session.symlink_to(other)
        # write_text follows the link but the launcher must reject it.
        self.run_launcher(1)

    def test_concurrent_session_is_rejected(self):
        self.cache.mkdir(mode=0o700)
        with (self.cache / "session.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.run_launcher(1)

    def test_interrupted_download_is_cleaned_without_following_links(self):
        self.cache.mkdir(mode=0o700)
        (self.cache / ".download-AbCd12").write_bytes(b"interrupted")
        protected = self.root / "protected"
        protected.write_bytes(b"keep")
        (self.cache / ".download-ZzZz12").symlink_to(protected)
        self.run_launcher()
        self.assertFalse((self.cache / ".download-AbCd12").exists())
        self.assertEqual(protected.read_bytes(), b"keep")

    def test_launch_parameters_do_not_override_session(self):
        self.run_launcher(more=())
        for payload in [
            {"server": "http://8.8.8.8"},
            {
                "interfaceVersion": 2,
                "parameters": {
                    "server": "http://8.8.8.8",
                    "gameId": self.game,
                    "testFrames": 1,
                },
            },
        ]:
            result = subprocess.run(
                [
                    str(self.app / "superflip-native"),
                    json.dumps(payload),
                    "--prepare-only",
                    "--state-dir",
                    str(self.state),
                    "--cache-dir",
                    str(self.cache),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_launch_envelope_is_validated(self):
        self.run_launcher()
        for parameters in ["invalid", {"gameId": "../arbitrary"}, {"testFrames": -1}]:
            result = subprocess.run(
                [
                    str(self.app / "superflip-native"),
                    json.dumps({"interfaceVersion": 2, "parameters": parameters}),
                    "--prepare-only",
                    "--state-dir",
                    str(self.state),
                    "--cache-dir",
                    str(self.cache),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)

    def test_game_handoff_uses_fixed_argv_isolated_config_and_inherited_lock(self):
        runtime = self.app / "retroarch"
        runtime.write_text(
            "#!/usr/bin/python3\n"
            "import fcntl,json,os,pathlib,sys\n"
            "config=pathlib.Path(sys.argv[sys.argv.index('--config')+1])\n"
            "with (config.parent/'session.lock').open('r') as lock:\n"
            " try:\n"
            "  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); held=False\n"
            " except BlockingIOError: held=True\n"
            "print(json.dumps({'argv':sys.argv[1:],'lockHeld':held,"
            "'configHome':os.environ.get('XDG_CONFIG_HOME')}))\n"
        )
        runtime.chmod(0o755)
        result = self.run_launcher(prepare_only=False)
        handoff = json.loads(result.stdout.splitlines()[-1])
        self.assertTrue(handoff["lockHeld"])
        self.assertEqual(handoff["configHome"], str(self.state / "config"))
        self.assertEqual(
            handoff["argv"],
            [
                "--verbose",
                "--config",
                str(self.cache / "session.cfg"),
                "-L",
                str(self.app / "cores/snes9x_libretro.so"),
                str(self.cache / (self.game + ".sfc")),
            ],
        )


if __name__ == "__main__":
    unittest.main(argv=[__file__, *REST])
