"""The lab is separate from production and never mutates user saves."""

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "benchmark_serve", ROOT / "scripts/benchmark/serve.py"
)
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


def test_lab_copies_only_selected_rom_and_rejects_writes(tmp_path):
    source = tmp_path / "owned.sfc"
    source.write_bytes(b"synthetic-not-a-game")
    isolated = tmp_path / "lab"
    app = lab.lab_app(isolated, rom=source)
    client = TestClient(app, base_url="http://127.0.0.1")
    config = client.get("/lab/config").json()
    assert config["realSaves"] is False
    game = config["gameId"]
    assert client.get(f"/api/games/{game}/rom").content == source.read_bytes()
    assert client.get(f"/api/games/{game}/saves/1").status_code == 404
    assert client.put(f"/api/games/{game}/saves/1", content=b"forbidden").status_code == 405
    assert not list((isolated / "saves").iterdir())
    assert client.get("/lab/config", headers={"host": "evil.example"}).status_code == 400
    assert source.read_bytes() == b"synthetic-not-a-game"


def test_ps1_requires_both_media_and_valid_sized_bios(tmp_path):
    image = tmp_path / "disc.pbp"
    image.write_bytes(b"synthetic")
    with pytest.raises(ValueError, match="both"):
        lab.lab_app(tmp_path / "one", ps1_image=image)
    bios = tmp_path / "bios.bin"
    bios.write_bytes(b"invalid")
    with pytest.raises(ValueError, match="512 KiB"):
        lab.lab_app(tmp_path / "two", ps1_image=image, bios=bios)
    bios.write_bytes(bytes(512 * 1024))
    with pytest.raises(ValueError, match="model filename"):
        lab.lab_app(tmp_path / "three", ps1_image=image, bios=bios)


def test_alternative_manifest_cannot_escape_runtime_directory(tmp_path):
    runtime = tmp_path / "alternative"
    runtime.mkdir()
    (runtime / "verified.json").write_text('{"../secret": "not-a-hash"}')
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        lab.lab_app(tmp_path / "lab", alternative=runtime)


def test_experimental_core_manifest_is_verified_and_never_mounts_saves(tmp_path):
    runtime = tmp_path / "core"
    runtime.mkdir()
    module = runtime / "core.js"
    module.write_bytes(b"synthetic module")
    (runtime / "verified.json").write_text(
        json.dumps({"core.js": hashlib.sha256(module.read_bytes()).hexdigest()})
    )
    data = tmp_path / "lab"
    client = TestClient(lab.lab_app(data, core=runtime), base_url="http://127.0.0.1")
    assert client.get("/experimental-core/core.js").content == module.read_bytes()
    assert client.put("/experimental-core/core.js", content=b"overwrite").status_code == 405
    assert not list((data / "saves").iterdir())
    module.write_bytes(b"tampered")
    with pytest.raises(ValueError, match="Changed alternative runtime"):
        lab.lab_app(tmp_path / "tampered-lab", core=runtime)


def test_ps1_preserves_bios_filename_and_serves_media_read_only(tmp_path, monkeypatch):
    # Synthetic bytes prove transport/configuration, never PS1 emulation.
    monkeypatch.setattr(lab, "ROOT", tmp_path)
    (tmp_path / "scripts/benchmark/web").mkdir(parents=True)
    cores = tmp_path / "vendor/experiments/pcsx-rearmed-ejs-4.2.3"
    cores.mkdir(parents=True)
    (cores / "fake.data").write_bytes(b"synthetic")
    (cores / "verified.json").write_text(
        json.dumps({"fake.data": hashlib.sha256(b"synthetic").hexdigest()})
    )
    bios = tmp_path / "SCPH7001.BIN"
    bios.write_bytes(bytes(512 * 1024))
    image = tmp_path / "disc.pbp"
    image.write_bytes(b"synthetic disc")
    client = TestClient(
        lab.lab_app(tmp_path / "data", ps1_image=image, bios=bios), base_url="http://127.0.0.1"
    )
    cfg = client.get("/lab/ps1-config").json()
    assert cfg["biosName"] == "scph7001.bin"
    assert cfg["biosSha256"] == hashlib.sha256(bios.read_bytes()).hexdigest()
    assert client.head("/lab/bios/scph7001.bin").status_code == 200
    assert client.get("/lab/bios/scph7001.bin").content == bios.read_bytes()
    assert client.get("/lab/bios/scph5501.bin").status_code == 404
    assert client.get("/lab/disc").content == image.read_bytes()
    assert cfg["gameUrl"] == "/lab/game.pbp"
    assert client.get(cfg["gameUrl"]).content == image.read_bytes()
    assert client.put("/lab/disc", content=b"no").status_code == 405
    # A legacy absolute CUE reference is mapped to a sibling, never followed.
    binary = tmp_path / "Disc.bin"
    binary.write_bytes(b"synthetic track")
    cue = tmp_path / "Disc.cue"
    original = 'FILE "C:\\OLD\\Disc.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n'
    cue.write_text(original)
    cue_client = TestClient(
        lab.lab_app(tmp_path / "cue-data", ps1_image=cue, bios=bios), base_url="http://127.0.0.1"
    )
    assert cue_client.get("/lab/ps1-config").json()["externalFiles"] == {"/disc.bin": "/lab/disc"}
    assert cue_client.get("/lab/game.cue").text.startswith('FILE "disc.bin" BINARY')
    assert cue_client.get("/lab/disc").content == binary.read_bytes()
    assert cue.read_text() == original
    cue.write_text(original + 'FILE "Other.bin" BINARY\n')
    with pytest.raises(ValueError, match="exactly one"):
        lab.lab_app(tmp_path / "multiple", ps1_image=cue, bios=bios)
