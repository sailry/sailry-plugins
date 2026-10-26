"""Generate the official v1 index from package manifests and their public resources."""

import argparse
import json
from pathlib import Path
import sys

from history import LOCALES, notes, section, versions

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return path.read_text(encoding="utf-8") if path.is_file() else None


def stale_notes(root=ROOT):
    result = []
    for path in sorted(root.glob("*/plugin.json")):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        version = manifest.get("version")
        locales = [locale for locale in LOCALES
                   if (path.parent / f"CHANGELOG.{locale}.md").is_file()
                   and section(read(path.parent / f"CHANGELOG.{locale}.md"), version) is None]
        if locales:
            result.append(f"{manifest['name']} {version}: {', '.join(locales)}")
    return result


def skills(directory, package):
    result = []
    for path in sorted(directory.glob("skills/*/SKILL.md")):
        if path.is_symlink() or path.parent.is_symlink():
            raise ValueError("Skill sources cannot use symbolic links")
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        if not lines or lines[0].strip() != "---":
            raise ValueError("Skill frontmatter is required")
        end = next((index for index, line in enumerate(lines[1:], 1)
                    if line.strip() == "---"), None)
        if end is None:
            raise ValueError("Skill frontmatter is incomplete")
        # Preserve the authoritative YAML; Node's existing skill parser owns its semantics.
        result.append({"package": package, "path": path.relative_to(directory).as_posix(),
                       "frontmatter": "".join(lines[:end + 1])})
    return result


def catalog(root=ROOT, version_history=None):
    manifests = sorted(root.glob("*/plugin.json"))
    if version_history is None:
        version_history = versions(root, [path.parent.name for path in manifests])
    packages = []
    entries = []
    for manifest in manifests:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        name = data["name"]
        if name != manifest.parent.name:
            raise ValueError("Package name must match its directory")
        extension = data.get("extensions", {}).get("dev.sailry.platform", {})
        entry = {
            "id": name,
            "manifest": data,
            "provides_models": bool(extension.get("model_providers") or extension.get("model_adapters")),
            "permissions": extension.get("actions", []),
            "versions": version_history.get(name, []),
        }
        release_notes = notes(lambda filename: read(manifest.parent / filename), data.get("version"))
        if release_notes:
            entry["release_notes"] = release_notes
        packages.append(entry)
        entries.extend(skills(manifest.parent, name))
    return {"version": 1, "packages": packages, "skills": entries}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = json.dumps(catalog(), ensure_ascii=False, indent=2) + "\n"
    target = ROOT / "catalog.json"
    if args.check:
        for entry in stale_notes():
            print(f"Release note translations need an update: {entry}", file=sys.stderr)
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            raise SystemExit("Catalog is stale; run python3 scripts/catalog.py")
    else:
        target.write_text(text, encoding="utf-8")
