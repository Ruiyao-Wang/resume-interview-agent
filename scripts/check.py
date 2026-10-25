"""One command: Python/API tests, JS checks and real-browser E2E, all isolated."""
from __future__ import annotations

import argparse
import ast
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unit", action="store_true", help="Explicitly skip browser E2E (not full acceptance)")
    args = parser.parse_args()
    venv = ROOT / "backend" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    python = os.getenv("TEST_PYTHON") or (str(venv) if venv.is_file() else sys.executable)
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js 20+ is required for existing extension tests. Install Node then rerun.")
    env = {**os.environ, "AGENT_PROVIDER": "mock", "LLM_API_KEY": "", "LLM_MODEL": "", "APP_ACCESS_TOKEN": "",
           "APP_ALLOWED_HOSTS": "127.0.0.1,localhost,testserver", "APP_ALLOWED_ORIGINS": "", "TEST_PYTHON": python,
           "PYTHONUTF8": "1"}
    # A bundled Node runtime may keep dependencies beside bin/. Standard npm local resolution remains first.
    bundled = Path(node).parent.parent / "node_modules"
    if not env.get("NODE_PATH") and (bundled / "playwright").is_dir():
        env["NODE_PATH"] = str(bundled)
    if os.name == "nt" and not env.get("TEST_BROWSER"):
        for location in ("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"):
            if Path(location).is_file():
                env["TEST_BROWSER"] = location
                break

    def run(*command):
        print("\n> " + " ".join(map(str, command)), flush=True)
        subprocess.run(list(map(str, command)), cwd=ROOT, env=env, check=True)

    python_files = [*ROOT.joinpath("backend").glob("*.py"), *ROOT.joinpath("backend/interview").glob("*.py"), *ROOT.joinpath("scripts").glob("*.py"), *ROOT.joinpath("tests").glob("test_*.py")]
    for path in python_files:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for item in ast.walk(tree):
            if isinstance(item, ast.ExceptHandler) and all(isinstance(child, ast.Pass) for child in item.body):
                raise SystemExit(f"Silent except block: {path}:{item.lineno}")
    print(f"PASS Python AST/static validation: {len(python_files)} source files", flush=True)
    run(python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v")
    run(python, "backend/test_matcher.py")
    for script in [*ROOT.glob("*.js"), *ROOT.joinpath("backend/dashboard").glob("*.js"), *ROOT.joinpath("tests").glob("*.cjs")]:
        run(node, "--check", script.relative_to(ROOT))
    for script in sorted(ROOT.joinpath("tests").glob("*.test.js")):
        run(node, script.relative_to(ROOT))
    if not args.unit:
        run(node, "-e", "require('playwright'); console.log('Playwright dependency ready')")
        for script in ("tests/e2e.cjs", "tests/dropdowns.e2e.cjs", "tests/interview.e2e.cjs"):
            run(node, script)
    print("\nPASS " + ("unit/static checks; browser E2E explicitly skipped" if args.unit else "all unit, API, static and browser E2E checks"), flush=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(f"\nFAIL command exited with status {error.returncode}. See error above.", file=sys.stderr)
        sys.exit(error.returncode)
