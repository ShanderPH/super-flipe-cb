"""Export local build/source evidence and verify production cores/saves unchanged."""

import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from app.runtime import CORE_HASHES


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def collect():
    before = json.loads(
        (ROOT / "artifacts/performance-overhaul/saves-before.json").read_text()
    )
    after = {
        str(p.relative_to(ROOT)): digest(p)
        for p in (ROOT / "data/saves").rglob("*")
        if p.is_file()
    }
    if before != after:
        raise ValueError("Real save files changed; investigate without overwriting")
    cores = {
        name: digest(ROOT / "vendor/emulatorjs/data/cores" / name)
        for name in CORE_HASHES
    }
    if cores != CORE_HASHES:
        raise ValueError("Production core changed")
    baseline = ROOT / "vendor/experiments/snes9x2005-lab1-o3-heap64"
    repeated = ROOT / "vendor/experiments/snes9x2005-lab1-o3-heap64-repeat"
    reproducible = {
        name: digest(baseline / name) == digest(repeated / name)
        for name in ("core.js", "core.wasm")
    }
    if not all(reproducible.values()):
        raise ValueError("Rebuild differs")
    builds = {}
    for folder in sorted((ROOT / "vendor/experiments").glob("snes9x2005-lab1-*")):
        builds[folder.name] = {
            "manifest": json.loads((folder / "build.json").read_text()),
            "artifacts": {
                name: {
                    "bytes": (folder / name).stat().st_size,
                    "sha256": digest(folder / name),
                }
                for name in ("core.js", "core.wasm", "build.log", "COPYING.core")
            },
        }
    source_files = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=ROOT,
        )
        .decode()
        .split("\0")
    )
    sources = {
        name.replace("\\", "/"): digest(ROOT / name)
        for name in source_files
        if name
        and (ROOT / name).is_file()
        and Path(name).suffix in (".js", ".mjs", ".ts", ".tsx", ".c", ".py")
    }
    raw = [
        "desktop-snes9x2005-2026-10-17.json",
        "desktop-engines-followup-2026-10-17.json",
        "core-build-equivalence-2026-10-17.json",
        "ps1-desktop-memory-2026-10-17.json",
        "ps1-desktop-memory-owned-2026-10-17.json",
        "host-preflight-2026-10-17.json",
    ]
    result = {
        "date": datetime.now(UTC).isoformat(),
        "sourceBaseSha": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "workingTreeChanges": True,
        "environment": "local-only-continuation",
        "newCompletedPhysicalTrials": 0,
        "tvAuthorization": "required before any access; none granted for this continuation",
        "physicalAttempt": "interrupted by operator instruction; no completed result; inspector/tunnel/runners stopped on PC; no subsequent TV navigation",
        "realSaveFiles": len(after),
        "realSaveHashesUnchanged": before == after,
        "productionCoreHashes": cores,
        "independentRebuildByteIdentical": reproducible,
        "builds": builds,
        "sourceHashesAtFinalization": sources,
        "sourceHashLimit": "Final source snapshot, not a claim that formatting and all concurrent development stayed frozen throughout desktop smoke trials. Build manifests retain exact compiler commands and binary hashes.",
        "rawResultsSha256": {
            name: digest(ROOT / "docs/research/data" / name) for name in raw
        },
    }
    output = ROOT / "docs/research/data/overhaul-local-manifest-2026-10-17.json"
    with output.open("x", encoding="utf-8") as file:
        json.dump(result, file, indent=2)
    print(
        "Verified: real saves unchanged; production cores unchanged; independent build byte-identical"
    )


if __name__ == "__main__":
    collect()
