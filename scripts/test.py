"""Run all deterministic plugin and example tests."""

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    tests = sorted(path for path in ROOT.rglob("*.test.mjs")
                   if "node_modules" not in path.parts)
    if not tests:
        raise SystemExit("No plugin tests found")
    raise SystemExit(subprocess.run(
        ["node", "--experimental-vm-modules", "--test", "--test-reporter=spec",
         *(str(path.relative_to(ROOT)) for path in tests)], cwd=ROOT,
    ).returncode)
