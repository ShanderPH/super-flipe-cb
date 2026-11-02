"""Exercise the compiled VFS through its ABI and real HTTP, without a core mock."""

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PARSER = argparse.ArgumentParser()
PARSER.add_argument("--probe", type=Path, required=True)
ARGS, REST = PARSER.parse_known_args()
PROBE = ARGS.probe.resolve()
BLOCK = 128 * 1024


class DiscTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = bytes((x * 31 + x // BLOCK) % 256 for x in range(BLOCK * 140 + 271))
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.requests = []
        self.failure = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def do_GET(self):
                start, end = map(
                    int, self.headers["Range"].removeprefix("bytes=").split("-")
                )
                owner.requests.append((start, end))
                body = owner.data[start : end + 1]
                self.send_response(200 if owner.failure == "status" else 206)
                self.send_header("Content-Length", str(len(body)))
                self.send_header(
                    "Content-Range",
                    f"bytes {start}-{end}/{len(owner.data)}"
                    if owner.failure != "range"
                    else "bytes 0-0/1",
                )
                self.send_header(
                    "ETag",
                    '"bad"' if owner.failure == "etag" else '"' + owner.digest + '"',
                )
                self.end_headers()
                if owner.failure == "hash":
                    body = bytes(len(body))
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "server": f"http://127.0.0.1:{self.server.server_port}",
                    "token": "a" * 64,
                    "directory": str(self.root),
                    "files": [
                        {
                            "name": "file01.bin",
                            "url": "/api/native/discs/ps1-"
                            + "b" * 64
                            + "/files/file01.bin",
                            "sha256": self.digest,
                            "size": len(self.data),
                            "blocks": [
                                hashlib.sha256(self.data[i : i + BLOCK]).hexdigest()
                                for i in range(0, len(self.data), BLOCK)
                            ],
                        }
                    ],
                }
            )
        )

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def probe(self, reads):
        args = [str(PROBE), str(self.manifest), str(self.root / "file01.bin")]
        for offset, size in reads:
            args.extend([str(offset), str(size)])
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=30,
            env=os.environ,
            check=False,
        )

    def test_random_reads_cross_block_eof_and_cache_reuse(self):
        reads = [
            (BLOCK - 50, 200),
            (BLOCK - 50, 200),
            (BLOCK * 120 + 5, 1000),
            (len(self.data) - 80, 80),
        ]
        result = self.probe(reads)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.splitlines(),
            [hashlib.sha256(self.data[o : o + n]).hexdigest() for o, n in reads],
        )
        self.assertEqual(len([r for r in self.requests if r[0] == 0]), 1)
        self.assertTrue(all(end - start < BLOCK for start, end in self.requests))

    def test_cache_remains_bounded_after_full_rotation(self):
        result = self.probe([(i * BLOCK, 100) for i in range(140)])
        self.assertEqual(result.returncode, 0, result.stderr)
        metrics = json.loads((self.root / "disc-metrics.json").read_text())
        self.assertLessEqual(metrics["cachePeakBytes"], 16 * 1024 * 1024)
        self.assertGreater(metrics["requests"], 128)

    def test_unexpected_status_range_etag_and_corruption_fail_closed(self):
        for failure in ("status", "range", "etag", "hash"):
            self.failure = failure
            result = self.probe([(0, 100)])
            self.assertNotEqual(result.returncode, 0, failure)
            self.assertTrue((self.root / "io-error.txt").exists())


if __name__ == "__main__":
    unittest.main(argv=[__file__, *REST])
