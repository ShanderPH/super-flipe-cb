"""Install only the pinned engine and SNES cores; never download user game content."""
import hashlib
import io
import subprocess
from datetime import datetime, UTC
import urllib.request
import zipfile
from pathlib import Path
from patch_runtime import apply

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "e150dc0491ae747028919fb82d6598954976ede6"
CORES = {
    "snes9x-wasm.data": "eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee",
    "snes9x-legacy-wasm.data": "7d427a575cefad98ff400493fa1d7e892da63fe7bab68979babd9cea0bfaaf3b",
    "reports/snes9x.json": "dc7ac963eb7935a7ac78956235ac0b8912ec785c57026336825aa2ed8031b3ad",
}


def download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SuperFlipCB/0.0.1"}), timeout=60) as response:
        return response.read()


def main():
    target = ROOT / "vendor/emulatorjs"
    target.parent.mkdir(parents=True, exist_ok=True)
    # Stage installation so interrupted downloads never replace a working runtime.
    import tempfile
    with tempfile.TemporaryDirectory(dir=ROOT / "vendor") as folder:
        stage = Path(folder) / "runtime"
        stage.mkdir()
        archive = zipfile.ZipFile(io.BytesIO(download(
            f"https://codeload.github.com/EmulatorJS/EmulatorJS/zip/{COMMIT}"
        )))
        for item in archive.infolist():
            relative = Path(*Path(item.filename).parts[1:])
            if not relative.parts or ".." in relative.parts:
                continue
            if relative.parts[0] != "data" and relative.name != "LICENSE":
                continue
            path = stage / relative
            if item.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read(item))
        for name, expected in CORES.items():
            data = download(f"https://cdn.emulatorjs.org/4.2.3/data/cores/{name}")
            if hashlib.sha256(data).hexdigest() != expected:
                raise RuntimeError(f"Checksum mismatch: {name}; installed runtime unchanged")
            path = stage / "data/cores" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        apply(stage / "data")
        subprocess.run(["node", str(ROOT / "apps/tv-client/scripts/build-runtime.mjs"), str(stage / "data")], check=True)
        # Server must be stopped. Retain the previous whole tree for rollback.
        backup = target.with_name("emulatorjs-backup-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f"))
        if target.is_symlink() or target.is_junction() or target.resolve().parent != (ROOT / "vendor").resolve():
            raise RuntimeError("Runtime target must be a direct directory inside workspace/vendor")
        if target.exists():
            target.rename(backup)
        try:
            stage.rename(target)
        except OSError:
            if backup.exists():
                backup.rename(target)
            raise
    print("EmulatorJS 4.2.3 + SNES verified, patched and built. Previous tree retained for rollback.")


if __name__ == "__main__":
    main()
