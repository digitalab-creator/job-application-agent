#!/usr/bin/env python3
"""CLI wrapper — see manual_apply_queue.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from manual_apply_queue import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
