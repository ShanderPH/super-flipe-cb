"""Fetch fixed experimental runtimes only. Never fetch games, BIOS or user saves."""

import argparse
import hashlib
import io
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALTERNATIVE_URL = "https://github.com/wasm-gaming/snes9x-wasm/releases/download/v0.1.1/snes9x-wasm.zip"
ALTERNATIVE_SHA = "3093d10374d3c73d30b375868ca703b7cdd81dc82a0ffbf24b28191ec2fb1027"
PS1 = {
    "pcsx_rearmed-wasm.data": "fe5515f6c29f093f0e8c01824b213804f1f76eb9cb4c97c72fe2cc17606bfbc2",
    "pcsx_rearmed-legacy-wasm.data": "88faee73d06c597a68a8b78e5621d97feefca134c64b623e65f0a900037456da",
    "reports/pcsx_rearmed.json": "93b99266955ab16e9aa0faa0d6338f4a29b50c197764dd48be945573a5b449c1",
}


def download(url, digest):
    request = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 SuperFlipCB/0.0.1"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Checksum mismatch: {url}")
    return data


def prepare(alternative=False, ps1=False):
    root = ROOT / "vendor/experiments"
    root.mkdir(parents=True, exist_ok=True)
    for name, enabled in (
        ("snes9x-wasm-0.1.1", alternative),
        ("pcsx-rearmed-ejs-4.2.3", ps1),
    ):
        if not enabled:
            continue
        target = root / name
        if target.exists():
            raise FileExistsError(
                f"Preserve existing runtime; move it aside explicitly first: {target}"
            )
        with tempfile.TemporaryDirectory(dir=root) as temporary:
            stage = Path(temporary) / "runtime"
            stage.mkdir()
            if alternative:
                archive = zipfile.ZipFile(
                    io.BytesIO(download(ALTERNATIVE_URL, ALTERNATIVE_SHA))
                )
                for item in archive.infolist():
                    relative = Path(*Path(item.filename).parts[1:])
                    if not relative.parts:
                        continue
                    if (
                        relative.is_absolute()
                        or ".." in relative.parts
                        or item.external_attr >> 16 & 0o170000 == 0o120000
                    ):
                        raise ValueError("Unsafe archive member")
                    path = stage / relative
                    if item.is_dir():
                        path.mkdir(parents=True, exist_ok=True)
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(archive.read(item))
            else:
                for file, digest in PS1.items():
                    path = stage / file
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(
                        download(
                            "https://cdn.emulatorjs.org/4.2.3/data/cores/" + file,
                            digest,
                        )
                    )
            hashes = {
                str(p.relative_to(stage)).replace("\\", "/"): hashlib.sha256(
                    p.read_bytes()
                ).hexdigest()
                for p in stage.rglob("*")
                if p.is_file()
            }
            (stage / "verified.json").write_text(
                json.dumps(hashes, indent=2), encoding="utf-8"
            )
            stage.rename(target)
        print(target)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--alternative", action="store_true")
    parser.add_argument("--ps1", action="store_true")
    args = parser.parse_args()
    # Separate calls prevent the alternative flag from selecting the wrong payload.
    if args.alternative:
        prepare(alternative=True)
    if args.ps1:
        prepare(ps1=True)
