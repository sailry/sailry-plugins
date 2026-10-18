"""Generate the official v1 index from package manifests and their public resources."""

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCALES = ("en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es", "pt-BR", "ru")


def section(path, version):
    if not path.is_file():
        return None
    selected = False
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines(keepends=True):
        if line.rstrip().startswith("## "):
            if selected:
                break
            selected = line.rstrip()[3:].strip() == version
        elif selected:
            lines.append(line)
    text = "".join(lines).strip()
    if not text:
        return None
    if any((ord(char) < 32 and char not in "\n\r\t") or 127 <= ord(char) <= 159
           for char in text):
        raise ValueError("Release notes contain control characters")
    return text


def notes(directory, version):
    text = section(directory / "CHANGELOG.md", version)
    if text is None:
        return None
    locales = {}
    for locale in LOCALES:
        localized = section(directory / f"CHANGELOG.{locale}.md", version)
        if localized is not None:
            locales[locale] = localized
    result = {"text": text}
    if locales:
        result["locales"] = locales
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


def catalog(root=ROOT):
    packages = []
    entries = []
    for manifest in sorted(root.glob("*/plugin.json")):
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
        }
        release_notes = notes(manifest.parent, data.get("version"))
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
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            raise SystemExit("Catalog is stale; run python3 scripts/catalog.py")
    else:
        target.write_text(text, encoding="utf-8")
