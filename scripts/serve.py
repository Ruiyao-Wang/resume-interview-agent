"""Run from the project root: python scripts/serve.py [--port 8765]."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(root / ".env", override=False)
    if args.host not in {"127.0.0.1", "localhost", "::1"} and not os.getenv("APP_ACCESS_TOKEN"):
        parser.error("Non-loopback serving requires APP_ACCESS_TOKEN; use localhost for unauthenticated demos.")
    print(f"Interview: http://{args.host}:{args.port}/interview", flush=True)
    print("Single worker; Ctrl+C to stop. Private data is stored locally.", flush=True)
    try:
        subprocess.run([sys.executable, "-m", "uvicorn", "app:app", "--host", args.host, "--port", str(args.port), "--workers", "1"],
                       cwd=root / "backend", check=True)
    except KeyboardInterrupt:
        print("Server stopped.")


if __name__ == "__main__":
    main()
