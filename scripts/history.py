"""Read immutable package versions and release notes from committed Git history."""

from io import BytesIO
import json
import re
import subprocess


LOCALES = ("en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es", "pt-BR", "ru")
NUMBER = r"(?:0|[1-9][0-9]*)"
PREVIEW = r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
VERSION = re.compile(
    rf"({NUMBER})\.({NUMBER})\.({NUMBER})(?:-({PREVIEW}(?:\.{PREVIEW})*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)


def precedence(version):
    match = VERSION.fullmatch(version) if isinstance(version, str) else None
    if match is None:
        raise ValueError("Package versions must be semantic versions")
    major, minor, patch, preview = match.groups()
    identifiers = tuple((0, int(part)) if part.isascii() and part.isdigit() else (1, part)
                        for part in preview.split(".")) if preview else ()
    return int(major), int(minor), int(patch), preview is None, identifiers


def section(text, version):
    if text is None:
        return None
    selected = False
    lines = []
    for line in text.splitlines(keepends=True):
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


def notes(read, version):
    text = section(read("CHANGELOG.md"), version)
    if text is None:
        return None
    locales = {}
    for locale in LOCALES:
        localized = section(read(f"CHANGELOG.{locale}.md"), version)
        if localized is not None:
            locales[locale] = localized
    result = {"text": text}
    if locales:
        result["locales"] = locales
    return result


def git(root, *arguments):
    return subprocess.check_output(["git", *arguments], cwd=root, text=True).strip()


def objects(root, names):
    if not names:
        return {}
    result = subprocess.run(["git", "cat-file", "--batch"], cwd=root, check=True,
                            input=("\n".join(names) + "\n").encode(), capture_output=True)
    output = BytesIO(result.stdout)
    contents = {}
    for name in names:
        header = output.readline().split()
        if len(header) == 2 and header[1] == b"missing":
            contents[name] = None
            continue
        if len(header) != 3 or header[1] != b"blob":
            raise ValueError("Catalog history requires file objects")
        size = int(header[2])
        content = output.read(size)
        if len(content) != size or output.read(1) != b"\n":
            raise ValueError("Incomplete package history object")
        contents[name] = content.decode("utf-8")
    return contents


def lineage(history, manifests, name):
    graph = {row[0]: row[1:] for row in history}
    parsed = {}

    def manifest(commit):
        if commit not in parsed:
            text = manifests.get(f"{commit}:{name}/plugin.json")
            data = json.loads(text) if text is not None else None
            if isinstance(data, dict) and data.get("name") == name:
                try:
                    parsed[commit] = data, precedence(data.get("version"))
                except ValueError:
                    parsed[commit] = None
            else:
                parsed[commit] = None
        return parsed[commit]

    if not history or manifest(history[0][0]) is None:
        raise ValueError("Current package history requires a valid manifest")
    pending = [history[0][0]]
    selected = set()
    while pending:
        commit = pending.pop()
        if commit in selected:
            continue
        _, current = manifest(commit)
        selected.add(commit)
        for parent in graph[commit]:
            previous = manifest(parent)
            # A version reset starts a new package lineage, including on merged branches.
            if previous is not None and previous[1] <= current:
                pending.append(parent)
    return [(commit, manifest(commit)[0]) for commit in graph if commit in selected]


def versions(root, packages):
    if git(root, "rev-parse", "--is-shallow-repository") == "true":
        raise ValueError("Catalog history requires a complete Git checkout")
    if git(root, "status", "--porcelain", "--untracked-files=all", "--", *packages):
        raise ValueError("Commit package changes before generating catalog history")
    commits = {name: [line.split() for line in git(
        root, "rev-list", "--full-history", "--simplify-merges", "--topo-order", "--parents",
        "HEAD", "--", name + "/").splitlines()]
               for name in packages}
    manifests = objects(root, [f"{row[0]}:{name}/plugin.json"
                               for name, history in commits.items() for row in history])
    result = {}
    for name, history in commits.items():
        selected = {}
        for commit, manifest in lineage(history, manifests, name):
            version = manifest["version"]
            if version in selected:
                continue
            record = {"version": version, "commit": commit}
            extension = manifest.get("extensions", {}).get("dev.sailry.platform", {})
            if "min_sailry_version" in extension:
                minimum = extension["min_sailry_version"]
                precedence(minimum)
                record["min_sailry_version"] = minimum
            selected[version] = record
        result[name] = sorted(selected.values(), key=lambda record: precedence(record["version"]),
                              reverse=True)
    filenames = ["CHANGELOG.md", *(f"CHANGELOG.{locale}.md" for locale in LOCALES)]
    snapshots = objects(root, [f"{record['commit']}:{name}/{filename}"
                               for name, records in result.items() for record in records
                               for filename in filenames])
    for name, records in result.items():
        for record in records:
            prefix = f"{record['commit']}:{name}/"
            release_notes = notes(lambda filename: snapshots[prefix + filename], record["version"])
            if release_notes:
                record["release_notes"] = release_notes
    return result
