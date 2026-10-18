"""The official index preserves package metadata for installs and update checks."""

import importlib.util
from pathlib import Path
import json
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "catalog.py"
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
            self.assertEqual(catalog.catalog(root), {
                "version": 1, "packages": [{"id": "sample", "manifest": data,
                                          "provides_models": False, "permissions": []}], "skills": [],
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
            entry = catalog.catalog(root)["packages"][0]
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
                [package["id"] for package in catalog.catalog(root)["packages"]],
                ["first", "second"],
            )

    def test_selects_exact_release_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            package = root / "sample"
            (package / "CHANGELOG.md").write_text("## 2.0.0\n- Future\n\n## 1.10.0\n- Current\n\n## 1.9.0\n- Previous\n")
            (package / "CHANGELOG.zh-CN.md").write_text("## 1.10.0\n- 本次变更\n", encoding="utf-8")
            self.assertEqual(catalog.catalog(root)["packages"][0]["release_notes"],
                             {"text": "- Current", "locales": {"zh-CN": "- 本次变更"}})
            (package / "CHANGELOG.md").write_text("## 1.9.0\n- Previous\n")
            self.assertNotIn("release_notes", catalog.catalog(root)["packages"][0])

    def test_preserves_real_skill_frontmatter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            skill = root / "sample" / "skills" / "research"
            skill.mkdir(parents=True)
            frontmatter = "---\nname: research\ndescription: Research a topic\nmetadata:\n  display-name.zh-CN: 研究\n---\n"
            (skill / "SKILL.md").write_text(frontmatter + "Private body is not a catalog field\n", encoding="utf-8")
            self.assertEqual(catalog.catalog(root)["skills"], [{"package": "sample",
                "path": "skills/research/SKILL.md", "frontmatter": frontmatter}])

    def test_rejects_directory_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest(root, "sample")
            path = root / "sample" / "plugin.json"
            path.write_text(json.dumps({"name": "different"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "name must match"):
                catalog.catalog(root)


if __name__ == "__main__":
    unittest.main()
