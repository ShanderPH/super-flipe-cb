import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.native import BLOCK


@pytest.fixture
def native(tmp_path):
    cfg = Settings(data=tmp_path, hosts=["testserver"])
    folder = tmp_path / "roms/psx"
    folder.mkdir(parents=True)
    data = bytes(range(256)) * (BLOCK // 256 * 3)
    (folder / "Track.bin").write_bytes(data)
    cue = 'FILE "C:\\OLD\\Track.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\n'
    (folder / "Game.cue").write_text(cue)
    client = TestClient(create_app(cfg))
    token = (tmp_path / "native/pairing-token").read_text().strip()
    headers = {"x-native-token": token}
    catalog = client.get("/api/native/catalog", headers=headers).json()
    game = catalog["items"][0]["id"]
    manifest = client.get(f"/api/native/discs/{game}/manifest", headers=headers).json()
    yield client, headers, manifest, folder, data, tmp_path
    assert (folder / "Game.cue").read_text() == cue


def test_native_pairing_and_legacy_boundary(native):
    client, headers, _, _, _, _ = native
    assert client.get("/api/native/catalog").status_code == 401
    assert client.get("/api/native/catalog", headers=headers).status_code == 200
    assert client.get("/api/games?system=ps1").status_code == 422
    assert client.get("/api/games").json()["items"] == []


def test_manifest_rewrites_only_file_references_and_hashes_blocks(native):
    _, _, manifest, _, data, root = native
    assert len(manifest["files"]) == 1
    assert manifest["files"][0]["blocks"][1] == hashlib.sha256(data[BLOCK : 2 * BLOCK]).hexdigest()
    assert 'FILE "file01.bin" BINARY' in manifest["texts"]["file00.cue"]
    assert "TRACK 01 MODE2/2352" in manifest["texts"]["file00.cue"]
    assert str(root) not in json.dumps(manifest)


def test_strict_ranges_head_and_version(native):
    client, auth, manifest, _, data, _ = native
    f = manifest["files"][0]
    tag = '"' + f["sha256"] + '"'
    head = client.head(f["url"], headers=auth)
    assert head.status_code == 200 and not head.content
    assert head.headers["etag"] == tag and int(head.headers["content-length"]) == len(data)
    headers = {**auth, "if-match": tag, "range": f"bytes={BLOCK}-{2 * BLOCK - 1}"}
    response = client.get(f["url"], headers=headers)
    assert response.status_code == 206 and response.content == data[BLOCK : 2 * BLOCK]
    assert response.headers["content-range"] == f"bytes {BLOCK}-{2 * BLOCK - 1}/{len(data)}"
    assert client.get(f["url"], headers=auth).status_code == 412
    assert client.get(f["url"], headers={**auth, "if-match": tag}).status_code == 416
    for value in ("bytes=0-9999999", "bytes=8-3", "bytes=0-1,4-5", "bytes=-10"):
        assert client.get(f["url"], headers={**headers, "range": value}).status_code == 416


def test_changed_disc_is_never_mixed(native):
    client, auth, manifest, folder, _, _ = native
    f = manifest["files"][0]
    (folder / "Track.bin").write_bytes(b"changed")
    assert (
        client.get(
            f["url"], headers={**auth, "if-match": '"' + f["sha256"] + '"', "range": "bytes=0-3"}
        ).status_code
        == 409
    )


def test_native_save_conflicts_backups_and_legacy_preserved(native):
    client, auth, manifest, _, _, root = native
    legacy = root / "saves/legacy.json"
    legacy.write_bytes(b"preserve")
    url = f"/api/native/saves/{manifest['id']}/pcsx-build/file00.srm"
    headers = {
        **auth,
        "x-super-flip": "1",
        "if-match": '"0"',
        "x-save-sha256": hashlib.sha256(b"first").hexdigest(),
    }
    first = client.put(url, headers=headers, content=b"first")
    assert first.status_code == 200
    assert client.get(url, headers=auth).content == b"first"
    second_headers = {**headers, "x-save-sha256": hashlib.sha256(b"second").hexdigest()}
    assert client.put(url, headers=second_headers, content=b"second").status_code == 409
    assert (
        client.put(
            url, headers={**second_headers, "if-match": first.headers["etag"]}, content=b"second"
        ).status_code
        == 200
    )
    assert list((root / "native/saves").rglob("*.backup"))
    assert legacy.read_bytes() == b"preserve"
    assert client.put(url, headers=second_headers, content=b"wrong hash").status_code == 422


def test_unrecognized_bios_is_reported(native):
    client, auth, _, _, _, _ = native
    assert client.get("/api/native/bios", headers=auth).status_code == 404


def test_traversal_and_missing_files_are_rejected(tmp_path):
    cfg = Settings(data=tmp_path, hosts=["testserver"])
    folder = tmp_path / "roms/psx"
    folder.mkdir(parents=True)
    (folder / "Bad.cue").write_text('FILE "../../outside.bin" BINARY\n TRACK 01 AUDIO\n')
    client = TestClient(create_app(cfg))
    auth = {"x-native-token": (tmp_path / "native/pairing-token").read_text()}
    result = client.get("/api/native/catalog", headers=auth).json()
    assert result["items"] == [] and len(result["errors"]) == 1


def test_multitrack_and_multidisc_descriptors_preserve_layout(native):
    _, _, _, folder, _, root = native
    (folder / "Audio.bin").write_bytes(bytes(2352 * 30))
    (folder / "Game.cue").write_text(
        'FILE "Track.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\n'
        'FILE "Audio.bin" BINARY\n TRACK 02 AUDIO\n PREGAP 00:02:00\n INDEX 01 00:00:00\n'
    )
    (folder / "Both.m3u").write_text("Game.cue\nGame.cue\n")
    client = TestClient(create_app(Settings(data=root, hosts=["testserver"])))
    auth = {"x-native-token": (root / "native/pairing-token").read_text()}
    games = client.get("/api/native/catalog", headers=auth).json()["items"]
    game = next(g for g in games if g["media"]["format"] == "m3u")
    manifest = client.get(f"/api/native/discs/{game['id']}/manifest", headers=auth).json()
    assert len(manifest["files"]) == 2
    cue = next(v for k, v in manifest["texts"].items() if k.endswith(".cue"))
    assert "PREGAP 00:02:00" in cue and "TRACK 02 AUDIO" in cue
    # Fixture intentionally replaces the descriptor; the standard fixture finalizer
    # verifies source immutability in all the other transport/save scenarios.
    (folder / "Game.cue").write_text(
        'FILE "C:\\OLD\\Track.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\n'
    )
