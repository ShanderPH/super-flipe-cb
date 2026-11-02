"""Package on Linux, preserving executable modes that the Windows CLI lost."""

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from build import LOCK, ROOT, fetch
from verify import inspect


def package(build, output):
    if os.name == "nt":
        raise ValueError("Use package.ps1 with WSL or run on Linux")
    if output.exists():
        raise ValueError("Refusing to overwrite packages; use a new --output")
    report = json.loads((build / "build.json").read_text())
    inputs = ROOT / "artifacts/native/downloads"
    inputs.mkdir(parents=True, exist_ok=True)
    archive = fetch(LOCK["packager"], inputs)
    with tempfile.TemporaryDirectory(prefix="superflip-package-") as temporary:
        work = Path(temporary)
        subprocess.run(
            ["dpkg-deb", "-x", str(archive), str(work / "tools")], check=True
        )
        stage = work / "app"
        shutil.copytree(build / "app", stage)
        (stage / "package.properties").unlink(missing_ok=True)
        for path in stage.rglob("*"):
            if path.is_symlink():
                raise ValueError("App staging may not contain symlinks")
            path.chmod(0o755 if path.is_dir() else 0o644)
        for name in ["superflip-native", "retroarch", "native-probe"]:
            (stage / name).chmod(0o755)
        output.mkdir(parents=True)
        with (output / "package.log").open("w") as log:
            subprocess.run(
                [
                    str(work / "tools/usr/bin/ares-package"),
                    str(stage),
                    "-o",
                    str(output),
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
            )
    packages = list(output.glob("*.ipk"))
    if len(packages) != 1:
        raise ValueError("Expected exactly one native IPK")
    verified = inspect(packages[0], report)
    verified["packager"] = LOCK["packager"]
    packages[0].with_suffix(".verified.json").write_text(
        json.dumps(verified, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                key: verified[key]
                for key in ["package", "sha256", "bytes", "physicalValidation"]
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    package(args.build.resolve(), (args.output or args.build / "ipk").resolve())
