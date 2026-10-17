import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
from app.config import Settings
from app.main import create_app

target = Path(__file__).resolve().parents[2] / "docs/api/openapi.json"
target.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    schema = create_app(Settings(data=Path(directory))).openapi()
    text = json.dumps(schema, ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        if target.read_text("utf-8") != text:
            raise SystemExit("OpenAPI changed: regenerate contracts")
    else:
        target.write_text(text, encoding="utf-8")
