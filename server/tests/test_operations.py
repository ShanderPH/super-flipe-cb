import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.catalog import confined
from app.saves import SaveStore


def test_backup_envelope_can_restore_without_overwriting(tmp_path):
    for name in ("saves", "backups"):
        (tmp_path / name).mkdir()
    game = "snes-" + "a" * 64
    store = SaveStore(tmp_path)
    first = store.write(game, "sram", "1", b"first", '"0"')
    store.write(game, "sram", "1", b"second", f'"{first["version"]}"')
    backup = next((tmp_path / "backups").glob("*.json"))
    recovered = tmp_path / "recovered"
    (recovered / "saves").mkdir(parents=True)
    script = Path(__file__).resolve().parents[2] / "scripts/backup/restore.py"
    command = [sys.executable, str(script), str(backup), str(recovered)]
    assert subprocess.run(command, capture_output=True).returncode == 0
    restored = next((recovered / "saves").glob("*.json"))
    assert store.read(restored)[1] == b"first"
    assert subprocess.run(command, capture_output=True).returncode != 0
    envelope = json.loads(backup.read_bytes())
    envelope["metadata"]["sha256"] = "0" * 64
    backup.write_text(json.dumps(envelope))
    assert subprocess.run(command, capture_output=True).returncode != 0


@pytest.mark.skipif(os.name != "nt", reason="Windows junction-specific")
def test_windows_junction_is_rejected(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    root = tmp_path / "storage"
    root.mkdir()
    link = root / "junction"
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True
    )
    assert result.returncode == 0
    with pytest.raises(HTTPException) as exc:
        confined(root, link / "private.sfc")
    assert exc.value.status_code == 404
