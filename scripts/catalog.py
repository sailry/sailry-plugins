"""Generate the official v1 index from package manifests and their public resources."""

import argparse
import json
from pathlib import Path
import sys

from history import LOCALES, notes, precedence, runtime_requirements, section, versions

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


def withdrawn(root):
    text = read(root / "catalog-withdrawn.json")
    if text is None:
        return {}
    entries = json.loads(text)
    if not isinstance(entries, dict):
        raise ValueError("Catalog withdrawals must name packages")
    result = {}
    for name, requested in entries.items():
        if (not isinstance(requested, list)
                or any(not isinstance(version, str) for version in requested)
                or len(requested) != len(set(requested))):
            raise ValueError(f"Invalid catalog withdrawal for {name}")
        result[name] = set(requested)
    return result


def legacy_requirements(root, version_history):
    text = read(root / "catalog-requirements.json")
    declarations = json.loads(text) if text is not None else {}
    if not isinstance(declarations, dict):
        raise ValueError("Legacy catalog requirements must name packages")
    result = {}
    for name, groups in declarations.items():
        if isinstance(groups, dict):
            groups = [groups]
        if name not in version_history or not isinstance(groups, list) or not groups:
            raise ValueError(f"Invalid legacy catalog requirements for {name}")
        available = {record["version"] for record in version_history[name]}
        by_version = result[name] = {}
        for declaration in groups:
            if not isinstance(declaration, dict) or set(declaration) - {"versions", "products", "requires_modules"}:
                raise ValueError(f"Invalid legacy catalog requirements for {name}")
            selected = declaration.get("versions")
            if (not isinstance(selected, list) or not selected
                    or any(not isinstance(version, str) for version in selected)
                    or len(selected) != len(set(selected)) or not set(selected) <= available
                    or not set(selected).isdisjoint(by_version)):
                raise ValueError(f"Invalid legacy catalog requirements for {name}")
            requirements = runtime_requirements(declaration)
            if not requirements:
                raise ValueError(f"Missing legacy catalog requirements for {name}")
            by_version.update((version, requirements) for version in selected)
    return result


def catalog(root=ROOT, version_history=None):
    manifests = {path.parent.name: path for path in root.glob("*/plugin.json")}
    withdrawals = withdrawn(root)
    archived = {}
    if version_history is None:
        version_history, archived = versions(root, manifests, withdrawals)
    supplemental = legacy_requirements(root, version_history)
    packages = []
    entries = []
    for name in sorted(manifests.keys() | archived.keys()):
        if name in manifests:
            path = manifests[name]
            data = json.loads(path.read_text(encoding="utf-8"))
            if data["name"] != name:
                raise ValueError("Package name must match its directory")
            release_notes = notes(lambda filename: read(path.parent / filename), data.get("version"))
            entries.extend(skills(path.parent, name))
        else:
            data, record = archived[name]
            release_notes = record.get("release_notes")
        extension = data.get("extensions", {}).get("dev.sailry.platform", {})
        requirements = runtime_requirements(extension)
        for field in requirements:
            del extension[field]
        history = version_history.get(name, [])
        minimum = extension.get("min_sailry_version")
        include_requirements = bool(requirements) or minimum is not None and precedence(minimum) >= precedence("0.2.14")
        by_version = {}
        records = []
        for record in history:
            declared = runtime_requirements(record)
            legacy = supplemental.get(name, {}).get(record["version"], {})
            if any(field in declared and declared[field] != value for field, value in legacy.items()):
                raise ValueError(f"Legacy requirements conflict with {name} {record['version']}")
            minimum = record.get("min_sailry_version")
            include_requirements = (include_requirements or bool(declared or legacy)
                                    or minimum is not None and precedence(minimum) >= precedence("0.2.14"))
            by_version[record["version"]] = {**legacy, **declared}
            records.append({key: value for key, value in record.items()
                            if key not in declared})
        by_version[data["version"]] = {**by_version.get(data["version"], {}), **requirements}
        entry = {
            "id": name,
            "manifest": data,
            "provides_models": bool(extension.get("model_providers") or extension.get("model_adapters")),
            "permissions": extension.get("actions", []),
            "versions": records,
        }
        if include_requirements:
            entry["version_requirements"] = by_version
        if release_notes:
            entry["release_notes"] = release_notes
        packages.append(entry)
    names = {package["id"] for package in packages}
    for name, requested in withdrawals.items():
        available = {record["version"] for record in version_history.get(name, [])}
        if name not in names or not requested <= available:
            raise ValueError(f"Invalid catalog withdrawal for {name}")
    for package in packages:
        package["versions"] = [{**record, "withdrawn": True}
                               if record["version"] in withdrawals.get(package["id"], ()) else record
                               for record in package["versions"]]
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
