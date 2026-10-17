"""Inspect the packaged ar/tar manifest, not only the source JSON."""
import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path


def verify(path, resolution):
    raw = Path(path).read_bytes()
    if raw[:8] != b"!<arch>\n":
        raise ValueError("Invalid IPK archive")
    offset = 8
    manifests = []
    while offset + 60 <= len(raw):
        header = raw[offset:offset + 60]
        size = int(header[48:58])
        name = header[:16].decode().strip().rstrip("/")
        body = raw[offset + 60:offset + 60 + size]
        if name.startswith("data.tar"):
            with tarfile.open(fileobj=io.BytesIO(body), mode="r:*") as archive:
                for item in archive.getmembers():
                    if item.name.endswith("/appinfo.json") and item.isfile():
                        manifests.append(json.load(archive.extractfile(item)))
        offset += 60 + size + size % 2
    if len(manifests) != 1:
        raise ValueError("Expected exactly one app manifest")
    manifest = manifests[0]
    if not (manifest["id"] == "com.superflipcb.app" and manifest["version"] == "0.0.2"
            and manifest["cloudgame_active"] is True and manifest["resolution"] == resolution):
        raise ValueError("Packaged manifest does not match expected input/version/resolution")
    result = {"package": Path(path).name, "sha256": hashlib.sha256(raw).hexdigest(), "manifest": manifest}
    Path(path).with_suffix(".verified.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    verify(sys.argv[1], sys.argv[2])
