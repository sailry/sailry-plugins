"""The official index preserves package metadata for installs and update checks."""

import importlib.util
from pathlib import Path
import json
import os
import tempfile
import subprocess
import sys
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "catalog.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("catalog", SCRIPT)
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


def manifest(root, name, **metadata):
    directory = root / name
    directory.mkdir()
    data = {"name": name, "version": "1.10.0", **metadata}
    (directory / "plugin.json").write_text(json.dumps(data), encoding="utf-8")
    return data


class Catalog(unittest.TestCase):
    def test_runtime_requirements(self):
        self.assertEqual(catalog.runtime_requirements({}), {})
        declaration = {"products": ["harness", "code"], "requires_modules": ["files", "git"]}
        self.assertEqual(catalog.runtime_requirements(declaration), declaration)
        self.assertEqual(catalog.runtime_requirements({"requires_modules": []}), {"requires_modules": []})
        for invalid in [{"products": []}, {"products": None}, {"products": ["harness", "harness"]},
                        {"products": ["Harness"]}, {"requires_modules": None}, {"requires_modules": "files"},
                        {"requires_modules": ["files", "files"]}, {"requires_modules": ["files/host"]}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                catalog.runtime_requirements(invalid)

    def test_runtime_requirements_survive_immutable_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            declaration = {"api_version": "v1", "products": ["harness"], "requires_modules": ["files"]}
            manifest(root, "sample", version="1.0.0", extensions={"dev.sailry.platform": declaration})
            revision = commit(root, "Add product requirements")
            records = catalog.versions(root, ["sample"])["sample"]
            self.assertEqual(records, [{"version": "1.0.0", "commit": revision, **declaration}])

    def test_projects_requirements_outside_strict_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            requirements = {"products": ["harness", "code"], "requires_modules": ["files"]}
            data = manifest(root, "sample", extensions={"dev.sailry.platform": {
                "api_version": "v1", "min_sailry_version": "0.2.14", **requirements,
            }})
            record = {"version": data["version"], "commit": "a" * 40, "api_version": "v1",
                      "min_sailry_version": "0.2.14", **requirements}
            entry = catalog.catalog(root, version_history={"sample": [record]})["packages"][0]
            self.assertEqual(entry["version_requirements"], {data["version"]: requirements})
            self.assertEqual(entry["versions"], [{key: value for key, value in record.items()
                                                  if key not in requirements}])
            projected = entry["manifest"]["extensions"]["dev.sailry.platform"]
            self.assertEqual(projected, {"api_version": "v1", "min_sailry_version": "0.2.14"})
            self.assertEqual(json.loads((root / "sample" / "plugin.json").read_text()), data)
            self.assertEqual(record["products"], requirements["products"])
            empty = catalog.catalog(root, version_history={})["packages"][0]
            self.assertEqual(empty["version_requirements"], {data["version"]: requirements})

    def test_supplements_only_selected_legacy_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample", extensions={"dev.sailry.platform": {
                "api_version": "v1", "actions": ["git.read"],
            }})
            history = {"sample": [
                {"version": "1.10.0", "commit": "a" * 40},
                {"version": "1.9.0", "commit": "b" * 40},
                {"version": "1.8.0", "commit": "c" * 40},
            ]}
            requirements = {"requires_modules": ["files"]}
            (root / "catalog-requirements.json").write_text(json.dumps({
                "sample": {**requirements, "versions": ["1.10.0", "1.9.0"]},
            }))
            entry = catalog.catalog(root, version_history=history)["packages"][0]
            self.assertEqual(entry["version_requirements"], {
                "1.10.0": requirements, "1.9.0": requirements, "1.8.0": {},
            })
            self.assertEqual(entry["versions"], history["sample"])
            projected = entry["manifest"]["extensions"]["dev.sailry.platform"]
            self.assertEqual(projected, {"api_version": "v1", "actions": ["git.read"]})

    def test_marks_unrestricted_capability_era_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample", extensions={"dev.sailry.platform": {
                "api_version": "v1", "min_sailry_version": "0.2.14",
            }})
            path = root / "sample" / "plugin.json"
            for current, historical in [("0.2.14", "0.1.0"), ("0.1.0", "0.2.14"), ("0.1.0", "0.1.0")]:
                with self.subTest(current=current, historical=historical):
                    data = json.loads(path.read_text())
                    data["extensions"]["dev.sailry.platform"]["min_sailry_version"] = current
                    path.write_text(json.dumps(data))
                    history = {"sample": [
                        {"version": "1.10.0", "commit": "a" * 40, "min_sailry_version": current},
                        {"version": "1.9.0", "commit": "b" * 40, "min_sailry_version": historical},
                    ]}
                    entry = catalog.catalog(root, version_history=history)["packages"][0]
                    if current == "0.2.14" or historical == "0.2.14":
                        self.assertEqual(entry["version_requirements"], {"1.10.0": {}, "1.9.0": {}})
                    else:
                        self.assertNotIn("version_requirements", entry)

    def test_rejects_invalid_legacy_supplements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            history = {"sample": [{"version": "1.0.0", "requires_modules": ["git"]}]}
            path = root / "catalog-requirements.json"
            for invalid in [[], {"other": {"versions": ["1.0.0"], "requires_modules": ["files"]}},
                            {"sample": {"versions": ["2.0.0"], "requires_modules": ["files"]}},
                            {"sample": {"versions": ["1.0.0", "1.0.0"], "requires_modules": ["git"]}},
                            {"sample": {"versions": ["1.0.0"]}},
                            {"sample": {"versions": ["1.0.0"], "requires_modules": ["files"]}},
                            {"sample": {"versions": ["1.0.0"], "requires_modules": ["git"], "unknown": True}}]:
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    path.write_text(json.dumps(invalid))
                    catalog.catalog(root, version_history=history)

    def test_official_legacy_modules_are_feature_scoped(self):
        declarations = json.loads((SCRIPT.parents[1] / "catalog-requirements.json").read_text())
        self.assertEqual(set(declarations), {"files", "git", "databases", "ssh", "worktrees"})
        for name, declaration in declarations.items():
            self.assertEqual(declaration["requires_modules"], [name])
        self.assertIn("0.1.40", declarations["git"]["versions"])
        self.assertIn("0.1.32", declarations["files"]["versions"])

    def test_preserves_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = manifest(root, "sample", description="Package description", extensions={
                "dev.sailry.platform": {"description": {
                    "label": "Package description", "locales": {"zh-CN": "插件描述"},
                }},
            })
            self.assertEqual(catalog.catalog(root, version_history={}), {
                "version": 1, "packages": [{"id": "sample", "manifest": data,
                                          "provides_models": False, "permissions": [], "versions": []}], "skills": [],
            })

    def test_derives_model_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = manifest(root, "sample", extensions={
                "dev.sailry.platform": {
                    "model_providers": [{"id": "models"}],
                    "actions": ["models.provide", "credentials.inspect"],
                },
            })
            entry = catalog.catalog(root, version_history={})["packages"][0]
            self.assertEqual(entry["manifest"], data)
            self.assertTrue(entry["provides_models"])
            self.assertEqual(entry["permissions"], ["models.provide", "credentials.inspect"])

    def test_orders_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "second")
            manifest(root, "first")
            nested = root / "examples"
            nested.mkdir()
            manifest(nested, "optional")
            self.assertEqual(
                [package["id"] for package in catalog.catalog(root, version_history={})["packages"]],
                ["first", "second"],
            )

    def test_selects_exact_release_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            package = root / "sample"
            (package / "CHANGELOG.md").write_text("## 2.0.0\n- Future\n\n## 1.10.0\n- Current\n\n## 1.9.0\n- Previous\n")
            (package / "CHANGELOG.zh-CN.md").write_text("## 1.10.0\n- 本次变更\n", encoding="utf-8")
            self.assertEqual(catalog.catalog(root, version_history={})["packages"][0]["release_notes"],
                             {"text": "- Current", "locales": {"zh-CN": "- 本次变更"}})
            (package / "CHANGELOG.md").write_text("## 1.9.0\n- Previous\n")
            self.assertNotIn("release_notes", catalog.catalog(root, version_history={})["packages"][0])

    def test_reports_stale_existing_translations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            package = root / "sample"
            (package / "CHANGELOG.md").write_text("## 1.10.0\n- Current\n")
            (package / "CHANGELOG.zh-CN.md").write_text("## 1.9.0\n- 旧版说明\n", encoding="utf-8")
            (package / "CHANGELOG.ja.md").write_text("## 1.10.0\n- 現在の変更\n", encoding="utf-8")
            self.assertEqual(catalog.stale_notes(root), ["sample 1.10.0: zh-CN"])
            self.assertEqual(catalog.catalog(root, version_history={})["packages"][0]["release_notes"],
                             {"text": "- Current", "locales": {"ja": "- 現在の変更"}})

    def test_preserves_real_skill_frontmatter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            skill = root / "sample" / "skills" / "research"
            skill.mkdir(parents=True)
            frontmatter = "---\nname: research\ndescription: Research a topic\nmetadata:\n  display-name.zh-CN: 研究\n---\n"
            (skill / "SKILL.md").write_text(frontmatter + "Private body is not a catalog field\n", encoding="utf-8")
            self.assertEqual(catalog.catalog(root, version_history={})["skills"], [{"package": "sample",
                "path": "skills/research/SKILL.md", "frontmatter": frontmatter}])

    def test_rejects_directory_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            path = root / "sample" / "plugin.json"
            path.write_text(json.dumps({"name": "different"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "name must match"):
                catalog.catalog(root, version_history={})


def git(root, *arguments):
    return subprocess.check_output(["git", *arguments], cwd=root, text=True,
                                   stderr=subprocess.PIPE, env={**os.environ,
                                       "GIT_AUTHOR_DATE": "2000-01-01T00:00:00+00:00",
                                       "GIT_COMMITTER_DATE": "2000-01-01T00:00:00+00:00",
                                   }).strip()


def repository(root):
    git(root, "init", "--quiet", "--initial-branch=main")
    git(root, "config", "user.name", "Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "config", "commit.gpgsign", "false")
    git(root, "config", "core.hooksPath", os.devnull)


def commit(root, message):
    git(root, "add", ".")
    git(root, "commit", "--quiet", "-m", message)
    return git(root, "rev-parse", "HEAD")


def release(root, version, minimum=None, text=None, localized=None, api="v1", platform=True):
    package = root / "sample"
    package.mkdir(exist_ok=True)
    extension = {"api_version": api} if api is not None else {}
    if minimum is not None:
        extension["min_sailry_version"] = minimum
    data = {"name": "sample", "version": version}
    if platform:
        data["extensions"] = {"dev.sailry.platform": extension}
    (package / "plugin.json").write_text(json.dumps(data), encoding="utf-8")
    if text is not None:
        (package / "CHANGELOG.md").write_text(text, encoding="utf-8")
    if localized is not None:
        (package / "CHANGELOG.zh-CN.md").write_text(localized, encoding="utf-8")
    return commit(root, f"Release {version}")


def publish(root, records=None):
    data = catalog.catalog(root) if records is None else {
        "version": 1, "packages": [{"id": "sample", "versions": records}],
    }
    (root / "catalog.json").write_text(json.dumps(data), encoding="utf-8")
    commit(root, "Publish catalog")
    return data


class History(unittest.TestCase):
    def test_preserves_requirements_for_each_immutable_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            first_requirements = {"products": ["harness"], "requires_modules": ["files"]}
            manifest(root, "sample", version="1.0.0", extensions={"dev.sailry.platform": {
                "api_version": "v1", "min_sailry_version": "0.2.14", **first_requirements,
            }})
            first = commit(root, "Release first product declaration")
            publish(root)
            latest_requirements = {"products": ["code"], "requires_modules": []}
            path = root / "sample" / "plugin.json"
            data = json.loads(path.read_text())
            data["version"] = "1.1.0"
            data["extensions"]["dev.sailry.platform"].update(latest_requirements)
            path.write_text(json.dumps(data))
            latest = commit(root, "Release another product declaration")
            (root / "catalog-withdrawn.json").write_text('{"sample":["1.0.0"]}')
            before = catalog.catalog(root)
            entry = before["packages"][0]
            self.assertEqual(entry["version_requirements"], {
                "1.1.0": latest_requirements, "1.0.0": first_requirements,
            })
            self.assertEqual([(record["version"], record["commit"]) for record in entry["versions"]],
                             [("1.1.0", latest), ("1.0.0", first)])
            self.assertTrue(entry["versions"][1]["withdrawn"])
            publish(root)
            self.assertEqual(catalog.catalog(root), before)

    def test_withdraws_bad_floor_without_rewriting_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0", "0.1.6")
            path = root / "sample" / "plugin.json"
            data = json.loads(path.read_text())
            data["version"] = "1.0.1"
            requirements = {"products": ["harness", "code"], "requires_modules": ["git"]}
            data["extensions"]["dev.sailry.platform"].update({"min_sailry_version": "0.2.13", **requirements})
            path.write_text(json.dumps(data))
            incorrect = commit(root, "Record the unsupported declaration floor")
            publish(root)
            data["version"] = "1.0.2"
            data["extensions"]["dev.sailry.platform"]["min_sailry_version"] = "0.2.14"
            path.write_text(json.dumps(data))
            corrected = commit(root, "Correct the declaration floor in a new patch")
            (root / "catalog-withdrawn.json").write_text('{"sample":["1.0.1"]}')
            before = catalog.catalog(root)
            entry = before["packages"][0]
            self.assertEqual(entry["versions"][1], {
                "version": "1.0.1", "commit": incorrect, "api_version": "v1",
                "min_sailry_version": "0.2.13", "withdrawn": True,
            })
            self.assertEqual(entry["versions"][0]["commit"], corrected)
            self.assertEqual(entry["version_requirements"], {
                "1.0.2": requirements, "1.0.1": requirements, "1.0.0": {},
            })
            publish(root)
            self.assertEqual(catalog.catalog(root), before)

    def test_keeps_legacy_packages_compatible_on_v0213(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            compatible = release(root, "0.1.0", "0.1.6")
            legacy = release(root, "0.1.1", "0.1.6")
            publish(root)
            data = {"name": "sample", "version": "0.1.2", "extensions": {"dev.sailry.platform": {
                "api_version": "v1", "min_sailry_version": "0.2.14",
                "products": ["harness", "code"], "requires_modules": ["files"],
            }}}
            (root / "sample" / "plugin.json").write_text(json.dumps(data))
            latest = commit(root, "Require the native module platform")
            (root / "catalog-requirements.json").write_text(json.dumps({
                "sample": {"versions": ["0.1.1", "0.1.0"], "requires_modules": ["files"]},
            }))
            feed = json.loads(json.dumps(catalog.catalog(root)))
            entry = feed["packages"][0]
            allowed = {"version", "commit", "api_version", "min_sailry_version", "release_notes",
                       "withdrawn", "compatibility"}
            for record in entry["versions"]:
                self.assertFalse(set(record) - allowed)
            self.assertEqual(entry["versions"], [
                {"version": "0.1.2", "commit": latest, "api_version": "v1", "min_sailry_version": "0.2.14"},
                {"version": "0.1.1", "commit": legacy, "api_version": "v1", "min_sailry_version": "0.1.6"},
                {"version": "0.1.0", "commit": compatible, "api_version": "v1", "min_sailry_version": "0.1.6"},
            ])
            self.assertEqual(entry["version_requirements"], {
                "0.1.2": {"products": ["harness", "code"], "requires_modules": ["files"]},
                "0.1.1": {"requires_modules": ["files"]}, "0.1.0": {"requires_modules": ["files"]},
            })
            minimum = catalog.precedence("0.2.13")
            candidates = [record for record in entry["versions"]
                          if not record.get("withdrawn")
                          and catalog.precedence(record.get("min_sailry_version", "0.0.0")) <= minimum]
            self.assertEqual([record["version"] for record in candidates], ["0.1.1", "0.1.0"])
            projected = entry["manifest"]["extensions"]["dev.sailry.platform"]
            self.assertNotIn("products", projected)
            self.assertNotIn("requires_modules", projected)

    def test_uses_first_matching_content_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            first = release(root, "1.0.0")
            second = release(root, "1.1.0")
            git(root, "checkout", first, "--", "sample")
            restored = commit(root, "Restore the original package tree")
            self.assertNotEqual(first, restored)
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual([(record["version"], record["commit"]) for record in records],
                             [("1.1.0", second), ("1.0.0", first)])

    def test_preserves_recorded_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            publish(root)
            (root / "sample" / "main.js").write_text("export const value = 1;\n")
            final = commit(root, "Record legacy same-version content")
            publish(root, [{"version": "1.0.0", "commit": final}])
            before = catalog.catalog(root)
            (root / "README.md").write_text("Repository documentation\n")
            commit(root, "Update repository documentation")
            self.assertEqual(catalog.catalog(root), before)
            self.assertEqual(before["packages"][0]["versions"],
                             [{"version": "1.0.0", "commit": final, "api_version": "v1"}])
            (root / "catalog.json").write_text("{}")
            self.assertEqual(catalog.catalog(root), before)

    def test_rejects_unpublished_content_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            (root / "sample" / "main.js").write_text("export const value = 1;\n")
            commit(root, "Change content without increasing version")
            with self.assertRaisesRegex(ValueError, "sample 1.0.0 changed content"):
                catalog.catalog(root)
            release(root, "1.1.0")
            with self.assertRaisesRegex(ValueError, "sample 1.0.0 changed content"):
                catalog.catalog(root)

    def test_rejects_published_content_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            publish(root)
            (root / "sample" / "main.js").write_text("export const value = 1;\n")
            commit(root, "Change published content")
            with self.assertRaisesRegex(ValueError, "sample 1.0.0 changed content"):
                catalog.catalog(root)
            release(root, "1.1.0")
            with self.assertRaisesRegex(ValueError, "sample 1.0.0 changed content"):
                catalog.catalog(root)

    def test_preserves_immutable_notes_and_minimums(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            first = release(root, "0.1.0-alpha.4", "0.1.0-alpha.4",
                            "## 0.1.0-alpha.4\n- Preview\n",
                            "## 0.1.0-alpha.4\n- 预览\n")
            latest = release(root, "0.1.0", "0.1.0-alpha.5",
                             "## 0.1.0\n- Stable\n\n## 0.1.0-alpha.4\n- Rewritten later\n")
            entry = catalog.catalog(root)["packages"][0]
            self.assertEqual(entry["manifest"]["version"], "0.1.0")
            self.assertEqual(entry["release_notes"], {"text": "- Stable"})
            self.assertEqual(entry["versions"], [
                {"version": "0.1.0", "commit": latest, "api_version": "v1", "min_sailry_version": "0.1.0-alpha.5",
                 "release_notes": {"text": "- Stable"}},
                {"version": "0.1.0-alpha.4", "commit": first, "api_version": "v1",
                 "min_sailry_version": "0.1.0-alpha.4",
                 "release_notes": {"text": "- Preview", "locales": {"zh-CN": "- 预览"}}},
            ])

    def test_preserves_unknown_and_absent_api(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            plain = release(root, "1.0.0", platform=False)
            future = release(root, "2.0.0", "0.2.0-alpha.1", "## 2.0.0\n- Future API\n", api="v99")
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual(records, [
                {"version": "2.0.0", "commit": future, "api_version": "v99",
                 "min_sailry_version": "0.2.0-alpha.1", "release_notes": {"text": "- Future API"}},
                {"version": "1.0.0", "commit": plain},
            ])

    def test_requires_string_api(self):
        with tempfile.TemporaryDirectory() as directory:
            for index, api in enumerate((None, 1)):
                with self.subTest(api=api):
                    root = Path(directory) / str(index)
                    root.mkdir()
                    repository(root)
                    release(root, "1.0.0", api=api)
                    with self.assertRaisesRegex(ValueError, "API versions must be strings"):
                        catalog.catalog(root)

    def test_orders_recorded_build_ties(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            versions = ["0.1.0-alpha.4", "0.1.0-alpha.5", "0.1.0", "0.1.0+build.1",
                        "0.1.0+build.2", "0.2.0-alpha.1"]
            releases = [{"version": version, "commit": release(root, version)} for version in versions]
            publish(root, releases)
            self.assertEqual([item["version"] for item in catalog.catalog(root)["packages"][0]["versions"]],
                             list(reversed(versions)))

    def test_rejects_new_build_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            for original in ("1.0.0", "1.0.0+build.1"):
                for published in (False, True):
                    with self.subTest(original=original, published=published):
                        root = Path(directory) / f"{original}-{published}"
                        root.mkdir()
                        repository(root)
                        release(root, original)
                        if published:
                            publish(root)
                        (root / "sample" / "main.js").write_text("export const changed = true;\n")
                        release(root, "1.0.0+build.2")
                        with self.assertRaisesRegex(ValueError, "reuses SemVer precedence"):
                            catalog.catalog(root)

    def test_accepts_new_precedence_with_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "0.9.0")
            publish(root)
            latest = release(root, "1.0.0+build.2")
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual(records[0], {"version": "1.0.0+build.2", "commit": latest, "api_version": "v1"})

    def test_keeps_merged_version_commits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            git(root, "switch", "--quiet", "-c", "feature")
            second = release(root, "2.0.0")
            git(root, "switch", "--quiet", "main")
            first = release(root, "1.1.0")
            result = subprocess.run(["git", "merge", "--no-ff", "feature"], cwd=root,
                                    capture_output=True)
            self.assertEqual(result.returncode, 1)
            merged = release(root, "3.0.0")
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual([(item["version"], item["commit"]) for item in records[:3]],
                             [("3.0.0", merged), ("2.0.0", second), ("1.1.0", first)])

    def test_preserves_same_tree_merge_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            publish(root)
            git(root, "switch", "--quiet", "-c", "feature")
            (root / "README.md").write_text("Feature documentation\n")
            commit(root, "Document feature")
            alternative = release(root, "1.1.0")
            git(root, "switch", "--quiet", "main")
            canonical = release(root, "1.1.0")
            self.assertNotEqual(canonical, alternative)
            before = publish(root)
            git(root, "merge", "--no-ff", "--no-edit", "feature")
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual(records, before["packages"][0]["versions"])
            self.assertEqual(records[0]["commit"], canonical)

    def test_rejects_merged_version_collisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            publish(root)
            git(root, "switch", "--quiet", "-c", "feature")
            release(root, "1.1.0", text="## 1.1.0\n- Branch content\n")
            git(root, "switch", "--quiet", "main")
            release(root, "1.1.0", text="## 1.1.0\n- Published content\n")
            publish(root)
            result = subprocess.run(["git", "merge", "--no-ff", "--no-edit", "feature"], cwd=root,
                                    capture_output=True)
            self.assertEqual(result.returncode, 1)
            release(root, "1.2.0", text="## 1.2.0\n- Combined changes\n")
            with self.assertRaisesRegex(ValueError, "sample 1.1.0 changed content"):
                catalog.catalog(root)

    def test_rejects_uncommitted_package_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            (root / "sample" / "main.js").write_text("export const pending = true;\n")
            with self.assertRaisesRegex(ValueError, "Commit package changes"):
                catalog.catalog(root)

    def test_preserves_recorded_version_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "0.1.0", text="## 0.1.0\n- Retired content\n")
            release(root, "0.3.2")
            reset = release(root, "0.1.0", text="## 0.1.0\n- Current lineage\n")
            latest = release(root, "0.1.1")
            publish(root, [{"version": "0.1.1", "commit": latest}, {"version": "0.1.0", "commit": reset}])
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual([(item["version"], item["commit"]) for item in records],
                             [("0.1.1", latest), ("0.1.0", reset)])
            self.assertEqual(records[1]["release_notes"], {"text": "- Current lineage"})

    def test_rejects_new_version_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "0.1.0", text="## 0.1.0\n- Published content\n")
            publish(root)
            release(root, "0.3.2")
            release(root, "0.1.0", text="## 0.1.0\n- Reset content\n")
            with self.assertRaisesRegex(ValueError, "sample 0.1.0 changed content"):
                catalog.catalog(root)

    def test_withdraws_incompatible_historical_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            compatible = release(root, "0.1.25", "0.1.2")
            withdrawn = release(root, "0.1.26", "0.1.2")
            latest = release(root, "0.1.27", "0.1.3")
            (root / "catalog-withdrawn.json").write_text('{"sample":["0.1.26"]}')
            commit(root, "Withdraw incompatible release")
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual([(record["version"], record["commit"]) for record in records],
                             [("0.1.27", latest), ("0.1.26", withdrawn), ("0.1.25", compatible)])
            self.assertEqual([record["min_sailry_version"] for record in records],
                             ["0.1.3", "0.1.2", "0.1.2"])
            self.assertNotIn("withdrawn", records[0])
            self.assertTrue(records[1]["withdrawn"])
            self.assertNotIn("withdrawn", records[2])
            (root / "catalog-withdrawn.json").write_text('{"sample":["0.1.26","0.1.27"]}')
            latest_withdrawn = catalog.catalog(root)["packages"][0]["versions"]
            self.assertTrue(latest_withdrawn[0]["withdrawn"])
            self.assertEqual(latest_withdrawn[0]["commit"], latest)
            for invalid in ('{"sample":["0.1.26","0.1.26"]}', '{"sample":[1]}',
                            '{"sample":["0.1.24"]}', '{"other":["0.1.26"]}'):
                (root / "catalog-withdrawn.json").write_text(invalid)
                with self.assertRaisesRegex(ValueError, "Invalid catalog withdrawal"):
                    catalog.catalog(root)

    def test_recovers_withdrawn_recorded_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            first = release(root, "1.0.0", "0.1.0", "## 1.0.0\n- Original notes\n")
            publish(root)
            release(root, "1.0.0", "0.1.1", "## 1.0.0\n- Legacy changed notes\n")
            latest = release(root, "1.1.0")
            (root / "catalog-withdrawn.json").write_text('{"sample":["1.0.0"]}')
            publish(root, [{"version": "1.1.0", "commit": latest}])
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual(records[1], {
                "version": "1.0.0", "commit": first, "api_version": "v1",
                "min_sailry_version": "0.1.0", "release_notes": {"text": "- Original notes"},
                "withdrawn": True,
            })
            publish(root)
            self.assertEqual(catalog.catalog(root)["packages"][0]["versions"], records)

    def test_rejects_incomplete_checkouts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            root.mkdir()
            repository(root)
            release(root, "1.0.0")
            release(root, "2.0.0")
            checkout = Path(directory) / "checkout"
            git(root, "clone", "--quiet", "--depth", "1", root.resolve().as_uri(), str(checkout))
            with self.assertRaisesRegex(ValueError, "complete Git checkout"):
                catalog.catalog(checkout)


class PublishedCatalog(unittest.TestCase):
    def test_keeps_v0213_strict_version_shape(self):
        feed = json.loads((SCRIPT.parents[1] / "catalog.json").read_text())
        allowed = {"version", "commit", "api_version", "min_sailry_version", "release_notes",
                   "withdrawn", "compatibility"}
        for entry in feed["packages"]:
            with self.subTest(package=entry["id"]):
                extension = entry["manifest"].get("extensions", {}).get("dev.sailry.platform", {})
                self.assertNotIn("products", extension)
                self.assertNotIn("requires_modules", extension)
                if "version_requirements" in entry:
                    self.assertEqual(set(entry["version_requirements"]),
                                     {record["version"] for record in entry["versions"]})
                for record in entry["versions"]:
                    self.assertFalse(set(record) - allowed)
                    if catalog.precedence(record.get("min_sailry_version", "0.0.0")) >= catalog.precedence("0.2.14"):
                        self.assertIn("version_requirements", entry)

    def test_preserves_real_v0213_fallbacks(self):
        root = SCRIPT.parents[1]
        feed = json.loads((root / "catalog.json").read_text())
        history = {entry["id"]: entry["versions"] for entry in feed["packages"]}
        supplemental = catalog.legacy_requirements(root, history)
        withdrawals = catalog.withdrawn(root)
        expected = {"databases": "0.1.24", "files": "0.1.32", "git": "0.1.40",
                    "ssh": "0.1.31", "worktrees": "0.1.20"}
        for name, version in expected.items():
            with self.subTest(package=name):
                self.assertNotIn(version, withdrawals.get(name, ()))
                candidates = [record for record in history[name]
                              if record["version"] not in withdrawals.get(name, ())
                              and not record.get("withdrawn")
                              and catalog.precedence(record.get("min_sailry_version", "0.0.0")) <= catalog.precedence("0.2.13")]
                selected = max(candidates, key=lambda record: catalog.precedence(record["version"]))
                self.assertEqual(selected["version"], version)
                self.assertEqual(supplemental[name][version], {"requires_modules": [name]})
                self.assertEqual(set(supplemental[name]),
                                 {record["version"] for record in history[name]
                                  if catalog.precedence(record["version"]) <= catalog.precedence(version)})


if __name__ == "__main__":
    unittest.main()
