"""Offline restore of one envelope. Never overwrite an existing slot."""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("envelope", type=Path)
parser.add_argument("data", type=Path)
args = parser.parse_args()
envelope = json.loads(args.envelope.read_bytes())
meta = envelope["metadata"]
if not re.fullmatch(r"snes-[a-f0-9]{64}", meta["gameId"]):
    raise ValueError("Invalid game ID")
if not re.fullmatch(r"[a-z0-9_-]{1,32}", meta["slot"]):
    raise ValueError("Invalid slot")
if meta["kind"] not in ("sram", "state"):
    raise ValueError("Invalid kind")
if hashlib.sha256(base64.b64decode(envelope["data"], validate=True)).hexdigest() != meta["sha256"]:
    raise ValueError("Invalid checksum")
root = (args.data / "saves").resolve(strict=True)
target = root / f"{meta['gameId']}.{meta['kind']}.{meta['slot']}.json"
with target.open("xb") as stream:
    stream.write(args.envelope.read_bytes())
print(f"Restored {target.name}. Restart the server to use it.")
