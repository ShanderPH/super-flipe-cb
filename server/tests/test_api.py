import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.saves import SaveStore


@pytest.fixture
def env(tmp_path):
    settings = Settings(data=tmp_path, hosts=["testserver", "localhost"])
    rom = tmp_path / "roms/snes/test_fixture.sfc"
    rom.write_bytes(b"synthetic-not-executable-rom" * 64)
    with TestClient(create_app(settings)) as client:
        game = client.get("/api/games").json()["items"][0]
        yield client, game, tmp_path, rom


def headers(version='"0"'):
    return {
        "x-super-flip": "1",
        "content-type": "application/octet-stream",
        "if-match": version,
        "x-core-version": "emulatorjs-4.2.3",
    }


def test_catalog_stable_private_and_filterable(env):
    client, game, root, rom = env
    assert game["id"] == "snes-" + hashlib.sha256(rom.read_bytes()).hexdigest()
    assert game["title"] == "test fixture"
    assert str(root) not in json.dumps(game)
    assert client.get("/api/games?search=unknown").json()["total"] == 0
    assert client.get("/api/games?search=TEST&pageSize=1").json()["total"] == 1
    assert client.get("/api/games?page=0").status_code == 422
    assert client.get("/api/games?pageSize=101").status_code == 422
    assert client.get("/api/games?system=ps1").status_code == 422
    assert client.get("/api/games/nope").status_code == 404
    assert client.get("/api/capabilities").json()["hardwareValidated"] is False


def test_rom_range_head_and_missing(env):
    client, game, _, rom = env
    url = game["media"]["url"]
    response = client.get(url)
    assert response.content == rom.read_bytes()
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["etag"]
    head = client.head(url)
    assert not head.content
    assert int(head.headers["content-length"]) == len(rom.read_bytes())
    partial = client.get(url, headers={"range": "bytes=2-5"})
    assert partial.status_code == 206 and partial.content == rom.read_bytes()[2:6]
    assert client.get(url, headers={"range": "bytes=999999-"}).status_code == 416
    rom.unlink()
    assert client.get(url).status_code == 404


def test_save_conflict_backup_and_restore(env):
    client, game, root, _ = env
    url = f"/api/games/{game['id']}/saves/1"
    assert client.get(url).status_code == 404
    first = client.put(url, content=b"first", headers=headers())
    assert first.status_code == 200
    assert first.json()["sha256"] == hashlib.sha256(b"first").hexdigest()
    version = first.headers["etag"]
    assert client.get(url).headers["etag"] == version
    assert client.put(url, content=b"stale", headers=headers()).status_code == 409
    second = client.put(url, content=b"second", headers=headers(version))
    assert second.status_code == 200
    assert client.get(url).content == b"second"
    backups = list((root / "backups").glob("*.json"))
    assert len(backups) == 1
    assert SaveStore(root).read(backups[0])[1] == b"first"
    with TestClient(create_app(Settings(data=root, hosts=["testserver"]))) as reopened:
        assert reopened.get(url).content == b"second"


def test_save_boundaries(env):
    client, game, _, _ = env
    url = f"/api/games/{game['id']}/saves/1"
    assert client.put(url, content=b"a", headers={}).status_code == 403
    assert (
        client.put(
            url, content=b"a", headers={**headers(), "origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert (
        client.put(
            url, content=b"a", headers={**headers(), "sec-fetch-site": "cross-site"}
        ).status_code
        == 403
    )
    assert (
        client.put(url, content=b"a", headers={**headers(), "host": "evil.test"}).status_code == 400
    )
    assert (
        client.put(url, content=b"a", headers={**headers(), "x-core-version": "other"}).status_code
        == 409
    )
    without_version = headers()
    without_version.pop("if-match")
    assert client.put(url, content=b"a", headers=without_version).status_code == 428
    assert client.put(url, content=b"", headers=headers()).status_code == 422
    assert (
        client.put(url, content=b"a" * (2 * 1024 * 1024 + 1), headers=headers()).status_code == 413
    )
    assert client.put(url + "../bad", content=b"a", headers=headers()).status_code == 404
    assert client.put(url.replace("/1", "/BAD"), content=b"a", headers=headers()).status_code == 422
    assert client.get("/api/games/..%5C..%5Csecret/rom").status_code == 404


def test_concurrent_writers_have_one_winner(env):
    _, game, root, _ = env
    store = SaveStore(root)

    def write(value):
        from fastapi import HTTPException

        try:
            store.write(game["id"], "sram", "race", value, '"0"')
            return 200
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(write, [b"one", b"two"])) == [200, 409]


def test_corruption_is_detected(env):
    client, game, root, _ = env
    url = f"/api/games/{game['id']}/saves/1"
    client.put(url, content=b"good", headers=headers())
    path = SaveStore(root).path(game["id"], "sram", "1")
    envelope = json.loads(path.read_text())
    envelope["data"] = "YmFk"
    path.write_text(json.dumps(envelope))
    assert client.get(url).status_code == 500
    assert client.put(url, content=b"overwrite", headers=headers()).status_code == 500


def test_atomic_failure_preserves_previous(env, monkeypatch):
    client, game, root, _ = env
    url = f"/api/games/{game['id']}/saves/1"
    result = client.put(url, content=b"old", headers=headers())
    import app.saves

    def fail(*args):
        raise OSError("simulated disk full")

    monkeypatch.setattr(app.saves.os, "replace", fail)
    assert (
        client.put(url, content=b"new", headers=headers(result.headers["etag"])).status_code == 500
    )
    assert client.get(url).content == b"old"
    assert not list((root / "saves").glob(".save-*"))


def test_symlink_rom_is_never_indexed(env):
    _, _, root, _ = env
    outside = root / "secret.sfc"
    outside.write_bytes(b"private")
    link = root / "roms/snes/link.sfc"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("Creating symlinks requires Windows Developer Mode or privilege")
    with TestClient(create_app(Settings(data=root, hosts=["testserver"]))) as client:
        assert client.get("/api/games").json()["total"] == 1


def test_changed_rom_invalidates_content_identity(env):
    client, game, _, rom = env
    rom.write_bytes(b"different-content")
    assert client.get(game["media"]["url"]).status_code == 409


def test_openapi_contract(env):
    client, _, _, _ = env
    schema = client.get("/openapi.json").json()
    assert set(schema["components"]["schemas"]["Game"]["required"]) >= {"id", "title", "media"}
    assert "head" in schema["paths"]["/api/games/{game_id}/rom"]
    assert schema["components"]["schemas"]["Media"]["required"] == ["url", "format", "sizeBytes"]


def test_save_cannot_be_swapped_between_games_or_slots(env):
    client, game, root, _ = env
    url = f"/api/games/{game['id']}/saves/1"
    result = client.put(url, content=b"good", headers=headers())
    path = SaveStore(root).path(game["id"], "sram", "1")
    envelope = json.loads(path.read_bytes())
    envelope["metadata"]["slot"] = "other"
    path.write_text(json.dumps(envelope))
    assert client.get(url).status_code == 409
    assert (
        client.put(url, content=b"new", headers=headers(result.headers["etag"])).status_code == 409
    )


def test_build_identity_and_legacy_saves_are_compatible_without_rewriting(env):
    from app.runtime import CORE_BUILD

    client, game, root, _ = env
    url = f"/api/games/{game['id']}/saves/1"
    result = client.put(url, content=b"original", headers=headers())
    assert result.json()["coreBuild"] == CORE_BUILD
    assert client.get(url).headers["x-core-build"] == CORE_BUILD
    path = SaveStore(root).path(game["id"], "sram", "1")
    envelope = json.loads(path.read_bytes())
    envelope["metadata"].pop("coreBuild")
    path.write_text(json.dumps(envelope))
    original = path.read_bytes()
    assert client.get(url).content == b"original"
    assert path.read_bytes() == original
    assert (
        client.put(
            url,
            content=b"bad",
            headers={**headers(result.headers["etag"]), "x-core-build": "other"},
        ).status_code
        == 409
    )
    envelope["metadata"]["coreBuild"] = "other"
    path.write_text(json.dumps(envelope))
    assert client.get(url).status_code == 409


def test_runtime_cache_revalidates_but_rom_and_api_never_cache(env):
    client, game, root, _ = env
    runtime = root / "cache-runtime"
    runtime.mkdir()
    (runtime / "loader.js").write_text("// fixture")
    cfg = Settings(data=root, runtime=runtime, hosts=["testserver"])
    with TestClient(create_app(cfg)) as cache_client:
        response = cache_client.get("/emulatorjs/data/loader.js")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "public, no-cache"
        repeated = cache_client.get(
            "/emulatorjs/data/loader.js", headers={"if-none-match": response.headers["etag"]}
        )
        assert repeated.status_code == 304
    assert client.get("/api/health").headers["cache-control"] == "no-store"
    assert client.get(game["media"]["url"]).headers["cache-control"] == "no-store"


def test_runtime_requires_verified_production_bundle(tmp_path):
    cfg = Settings(data=tmp_path, runtime=tmp_path / "runtime", hosts=["testserver"])
    cfg.runtime.mkdir()
    (cfg.runtime / "loader.js").write_text("legacy loader")
    with TestClient(create_app(cfg)) as client:
        assert client.get("/api/capabilities").json()["runtimeInstalled"] is False
        assert client.get("/api/runtime").status_code == 503
