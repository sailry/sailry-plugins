"""Generate the official v1 index from package manifests."""

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def catalog():
    packages = []
    for manifest in sorted(ROOT.glob("*/plugin.json")):
        data = json.loads(manifest.read_text(encoding="utf-8"))
        name = data["name"]
        if name != manifest.parent.name:
            raise ValueError("Package name must match its directory")
        packages.append({"id": name, "manifest": data})
    return {"version": 1, "packages": packages}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = json.dumps(catalog(), ensure_ascii=False, indent=2) + "\n"
    target = ROOT / "catalog.json"
    if args.check:
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            raise SystemExit("Catalog is stale; run python3 scripts/catalog.py")
    else:
        target.write_text(text, encoding="utf-8")
