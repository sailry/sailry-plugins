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
                "version": 1, "packages": [{"id": "sample", "manifest": data}],
            })

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
