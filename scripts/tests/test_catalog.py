"""The official index preserves package metadata for installs and update checks."""

import importlib.util
from pathlib import Path
import json
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
                                   stderr=subprocess.PIPE).strip()


def repository(root):
    git(root, "init", "--quiet", "--initial-branch=main")
    git(root, "config", "user.name", "Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")


def commit(root, message):
    git(root, "add", ".")
    git(root, "commit", "--quiet", "-m", message)
    return git(root, "rev-parse", "HEAD")


def release(root, version, minimum=None, text=None, localized=None):
    package = root / "sample"
    package.mkdir(exist_ok=True)
    extension = {"api_version": "v1"}
    if minimum is not None:
        extension["min_sailry_version"] = minimum
    data = {"name": "sample", "version": version,
            "extensions": {"dev.sailry.platform": extension}}
    (package / "plugin.json").write_text(json.dumps(data), encoding="utf-8")
    if text is not None:
        (package / "CHANGELOG.md").write_text(text, encoding="utf-8")
    if localized is not None:
        (package / "CHANGELOG.zh-CN.md").write_text(localized, encoding="utf-8")
    return commit(root, f"Release {version}")


class History(unittest.TestCase):
    def test_selects_final_package_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            first = release(root, "1.0.0")
            (root / "sample" / "main.js").write_text("export const value = 1;\n")
            final = commit(root, "Complete package content")
            self.assertNotEqual(first, final)
            before = catalog.catalog(root)
            (root / "catalog.json").write_text(json.dumps(before))
            commit(root, "Publish catalog")
            (root / "README.md").write_text("Repository documentation\n")
            commit(root, "Update repository documentation")
            self.assertEqual(catalog.catalog(root), before)
            self.assertEqual(before["packages"][0]["versions"],
                             [{"version": "1.0.0", "commit": final}])

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
                {"version": "0.1.0", "commit": latest, "min_sailry_version": "0.1.0-alpha.5",
                 "release_notes": {"text": "- Stable"}},
                {"version": "0.1.0-alpha.4", "commit": first,
                 "min_sailry_version": "0.1.0-alpha.4",
                 "release_notes": {"text": "- Preview", "locales": {"zh-CN": "- 预览"}}},
            ])

    def test_orders_semver_with_build_ties(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            versions = ["0.1.0-alpha.4", "0.1.0-alpha.5", "0.1.0", "0.1.0+build.1",
                        "0.1.0+build.2", "0.2.0-alpha.1"]
            for version in versions:
                release(root, version)
            self.assertEqual([item["version"] for item in catalog.catalog(root)["packages"][0]["versions"]],
                             list(reversed(versions)))

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

    def test_rejects_uncommitted_package_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "1.0.0")
            (root / "sample" / "main.js").write_text("export const pending = true;\n")
            with self.assertRaisesRegex(ValueError, "Commit package changes"):
                catalog.catalog(root)

    def test_excludes_retired_version_lineages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository(root)
            release(root, "0.1.0", text="## 0.1.0\n- Retired content\n")
            release(root, "0.3.2")
            reset = release(root, "0.1.0", text="## 0.1.0\n- Current lineage\n")
            latest = release(root, "0.1.1")
            records = catalog.catalog(root)["packages"][0]["versions"]
            self.assertEqual([(item["version"], item["commit"]) for item in records],
                             [("0.1.1", latest), ("0.1.0", reset)])
            self.assertEqual(records[1]["release_notes"], {"text": "- Current lineage"})

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


if __name__ == "__main__":
    unittest.main()
